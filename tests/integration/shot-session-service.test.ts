import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { ShotZone } from "@/types/db";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

// Every mechanical-breakdown issue template maps to one of these 3 unique
// drill slugs (two templates share "form-shooting-close-range") - seeding
// all 3 means finalizeSession's drill lookup succeeds regardless of which
// template the deterministic hash picks for a given session/zone.
const BREAKDOWN_DRILL_SLUGS = [
  "form-shooting-close-range",
  "one-dribble-pull-up",
  "hesitation-pull-up-signature",
];

async function seedShootingDrills() {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  await collection.insertMany(
    BREAKDOWN_DRILL_SLUGS.map((slug) => ({
      slug,
      name: slug,
      description: "d",
      skillTags: ["shooting"],
      difficulty: "beginner",
      coachingCues: ["cue"],
      equipmentNeeded: [],
      createdAt: new Date(),
    })) as never,
  );
}

async function seedProcessingSession(userId: ObjectId) {
  const { shotSessionsCollection } = await import("@/server/db/collections");
  const collection = await shotSessionsCollection();
  const _id = new ObjectId();
  await collection.insertOne({
    _id,
    userId,
    videoAssetId: new ObjectId(),
    recordedAt: new Date(),
    status: "processing",
    shots: [],
    totalAttempts: 0,
    totalMakes: 0,
    fgPercent: 0,
    zoneBreakdown: {},
    trendCallouts: [],
    createdAt: new Date(),
  } as never);
  return _id;
}

function shotInput(zone: ShotZone, made: boolean, timestampInVideoSeconds = 10) {
  return {
    zone,
    xPct: 50,
    yPct: 50,
    made,
    timestampInVideoSeconds,
  };
}

describe("shotSessionService: log -> finalize", () => {
  it("logs a real, tap-entered shot with a replay window derived from its timestamp", async () => {
    const { logShot } = await import("@/server/services/shotSessionService");
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    const updated = await logShot(userId, sessionId, shotInput("paint", true, 42));

    expect(updated.shots).toHaveLength(1);
    const shot = updated.shots[0];
    expect(shot.zone).toBe("paint");
    expect(shot.made).toBe(true);
    expect(shot.timestampInVideoSeconds).toBe(42);
    expect(shot.replayStartSeconds).toBe(39);
    expect(shot.replayEndSeconds).toBe(44);
    expect(shot.feedbackText).toBeTruthy();
  });

  it("clamps the replay window start at 0 for an early shot", async () => {
    const { logShot } = await import("@/server/services/shotSessionService");
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    const updated = await logShot(userId, sessionId, shotInput("paint", false, 1));
    expect(updated.shots[0].replayStartSeconds).toBe(0);
  });

  it("rejects logging a shot on a session that doesn't belong to the user", async () => {
    const { logShot } = await import("@/server/services/shotSessionService");
    const owner = new ObjectId();
    const otherUser = new ObjectId();
    const sessionId = await seedProcessingSession(owner);

    await expect(logShot(otherUser, sessionId, shotInput("paint", true))).rejects.toThrow();
  });

  it("removes a logged shot by its id", async () => {
    const { logShot, removeShot } = await import("@/server/services/shotSessionService");
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    const afterLog = await logShot(userId, sessionId, shotInput("paint", true));
    const shotId = afterLog.shots[0].id;

    const afterRemove = await removeShot(userId, sessionId, shotId);
    expect(afterRemove.shots).toHaveLength(0);
  });

  it("rejects finalizing a session with zero logged shots", async () => {
    const { finalizeSession } = await import("@/server/services/shotSessionService");
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    await expect(finalizeSession(userId, sessionId)).rejects.toThrow();
  });

  it("computes real attempts/makes/FG% and zone stats, generates a labeled mechanical breakdown, and creates a real recommended workout", async () => {
    await seedShootingDrills();
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const { findWorkoutByIdForUser } = await import(
      "@/server/repositories/workoutRepository"
    );

    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    // 2/2 in the paint (best), 0/2 from the left corner (weakest) - a real,
    // computed gap, not a randomly chosen one.
    await logShot(userId, sessionId, shotInput("paint", true, 1));
    await logShot(userId, sessionId, shotInput("paint", true, 2));
    await logShot(userId, sessionId, shotInput("left_corner_3", false, 3));
    await logShot(userId, sessionId, shotInput("left_corner_3", false, 4));

    const { session: result } = await finalizeSession(userId, sessionId);

    expect(result.status).toBe("completed");
    expect(result.totalAttempts).toBe(4);
    expect(result.totalMakes).toBe(2);
    expect(result.fgPercent).toBe(50);
    expect(result.zoneBreakdown.paint).toEqual({ attempts: 2, makes: 2 });
    expect(result.zoneBreakdown.left_corner_3).toEqual({ attempts: 2, makes: 0 });
    expect(result.bestZone).toBe("paint");
    expect(result.weakestZone).toBe("left_corner_3");

    // The narrative is generated, but must say so and must target the real
    // weakest zone - never presented as measured.
    expect(result.mechanicalBreakdown?.isSimulated).toBe(true);
    expect(result.mechanicalBreakdown?.targetZone).toBe("left_corner_3");
    expect(result.mechanicalBreakdown?.observation).toContain("Left Corner 3");

    expect(result.recommendedWorkoutId).toBeDefined();
    const workout = await findWorkoutByIdForUser(userId, result.recommendedWorkoutId!);
    expect(workout).not.toBeNull();
    expect(workout?.source.type).toBe("shot_session");
    expect(workout?.source.refId?.equals(sessionId)).toBe(true);
  });

  it("still finalizes with real stats when no drill exists at all", async () => {
    // Explicitly empty the drills collection (other tests in this file seed
    // it, and all tests share one in-memory mongod) so neither the drill
    // lookup nor the recommended workout can succeed - finalize must not
    // blow up either way; the session's own real numbers still land.
    const { drillsCollection } = await import("@/server/db/collections");
    await (await drillsCollection()).deleteMany({});

    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    await logShot(userId, sessionId, shotInput("paint", true, 1));
    await logShot(userId, sessionId, shotInput("left_corner_3", false, 2));

    const { session: result } = await finalizeSession(userId, sessionId);
    expect(result.status).toBe("completed");
    // Mongo serializes the explicit `undefined` from `drill?._id` as BSON
    // null on write, not as an absent key - every consumer treats null and
    // undefined the same way (truthy checks), so assert absence, not a
    // specific JS sentinel.
    expect(result.mechanicalBreakdown?.drillId).toBeFalsy();
    expect(result.recommendedWorkoutId).toBeUndefined();
  });

  it("is idempotent-safe against re-finalizing: a second call is rejected, not double-processed", async () => {
    await seedShootingDrills();
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);
    await logShot(userId, sessionId, shotInput("paint", true));

    await finalizeSession(userId, sessionId);
    await expect(finalizeSession(userId, sessionId)).rejects.toThrow();
  });

  it("produces a breakdown without an invented comparison when only one zone was logged", async () => {
    await seedShootingDrills();
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    await logShot(userId, sessionId, shotInput("right_wing_3", true, 1));
    await logShot(userId, sessionId, shotInput("right_wing_3", false, 2));

    const { session: result } = await finalizeSession(userId, sessionId);

    // One zone can't be both the strength and the weakness.
    expect(result.weakestZone).toBe("right_wing_3");
    expect(result.bestZone).toBeFalsy();

    // The player still gets a real breakdown, and it must not claim they
    // were "steadier" at some other zone they never shot from.
    expect(result.mechanicalBreakdown?.targetZone).toBe("right_wing_3");
    expect(result.mechanicalBreakdown?.observation).toContain("only zone you logged");
    expect(result.mechanicalBreakdown?.observation).not.toContain("steadier at");
  });
});

/**
 * BRD 7.5 lists "add a correction drill to a workout, directly from the shot"
 * as a per-shot capability of the replay dialog. It had no coverage at all,
 * which mattered: it is one of only two buttons on that dialog, and the
 * failure mode - a drill slug with no matching drill - is silent until a
 * player taps it.
 */
describe("shotSessionService: add a correction drill from one shot (BRD 7.5)", () => {
  async function finalizedSessionWithOneShot(userId: ObjectId) {
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const sessionId = await seedProcessingSession(userId);
    await logShot(userId, sessionId, shotInput("right_wing_3", false, 5));
    const { session } = await finalizeSession(userId, sessionId);
    return { sessionId, shotId: session.shots[0].id };
  }

  it("puts a real drill into the player's workout and reports which one", async () => {
    await seedShootingDrills();
    const { addCorrectionDrillForShot } = await import(
      "@/server/services/shotSessionService"
    );
    const { findWorkoutByIdForUser } = await import(
      "@/server/repositories/workoutRepository"
    );

    const userId = new ObjectId();
    const { sessionId, shotId } = await finalizedSessionWithOneShot(userId);

    const { workoutId, drillName } = await addCorrectionDrillForShot(
      userId,
      sessionId,
      shotId,
    );

    // The name is what the UI toasts back ("Added X to your workout"), so an
    // empty one would show the player a lie about work they can't find.
    expect(drillName).toBeTruthy();

    const workout = await findWorkoutByIdForUser(userId, workoutId);
    expect(workout).not.toBeNull();
    expect(workout?.drills.some((d) => d.name === drillName)).toBe(true);
  });

  it("adds the same drill the session's own breakdown points at for that zone", async () => {
    await seedShootingDrills();
    const { addCorrectionDrillForShot } = await import(
      "@/server/services/shotSessionService"
    );
    const { drillSlugForBreakdown } = await import(
      "@/server/services/shotMechanicalAnalysisProvider"
    );
    const { findDrillBySlug } = await import(
      "@/server/repositories/drillRepository"
    );

    const userId = new ObjectId();
    const { sessionId, shotId } = await finalizedSessionWithOneShot(userId);

    const { drillName } = await addCorrectionDrillForShot(userId, sessionId, shotId);

    // Not just "a" drill: the fix the analysis already told them about, so
    // the button doesn't hand them something unrelated to what they read.
    const expected = await findDrillBySlug(
      drillSlugForBreakdown("right_wing_3", sessionId),
    );
    expect(drillName).toBe(expected?.name);
  });

  it("rejects a shot id that isn't in the session", async () => {
    await seedShootingDrills();
    const { addCorrectionDrillForShot } = await import(
      "@/server/services/shotSessionService"
    );
    const userId = new ObjectId();
    const { sessionId } = await finalizedSessionWithOneShot(userId);

    await expect(
      addCorrectionDrillForShot(userId, sessionId, "not-a-real-shot-id"),
    ).rejects.toThrow();
  });

  it("rejects a session belonging to another player", async () => {
    await seedShootingDrills();
    const { addCorrectionDrillForShot } = await import(
      "@/server/services/shotSessionService"
    );
    const owner = new ObjectId();
    const intruder = new ObjectId();
    const { sessionId, shotId } = await finalizedSessionWithOneShot(owner);

    await expect(
      addCorrectionDrillForShot(intruder, sessionId, shotId),
    ).rejects.toThrow();
  });

  it("fails loudly, not silently, when the library has no drill for that zone", async () => {
    await seedShootingDrills();
    const { addCorrectionDrillForShot } = await import(
      "@/server/services/shotSessionService"
    );
    const userId = new ObjectId();
    const { sessionId, shotId } = await finalizedSessionWithOneShot(userId);

    // Finalize needed the drills; the tap happens after they've gone.
    const { drillsCollection } = await import("@/server/db/collections");
    await (await drillsCollection()).deleteMany({});

    await expect(
      addCorrectionDrillForShot(userId, sessionId, shotId),
    ).rejects.toThrow(/correction drill/i);
  });
});

describe("shotSessionService -> Progress (BRD v1.1 §7 Shot Session -> Shooting Stats)", () => {
  it("updates shooting stats and the streak when a session is finalized", async () => {
    await seedShootingDrills();
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const { getStatsForUser } = await import("@/server/services/progressService");

    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    expect(await getStatsForUser(userId)).toBeNull();

    await logShot(userId, sessionId, shotInput("paint", true, 1));
    await logShot(userId, sessionId, shotInput("paint", true, 2));
    await logShot(userId, sessionId, shotInput("left_corner_3", false, 3));

    await finalizeSession(userId, sessionId);

    const stats = await getStatsForUser(userId);
    expect(stats).not.toBeNull();
    expect(stats?.totalShotSessions).toBe(1);
    expect(stats?.totalShotAttempts).toBe(3);
    expect(stats?.totalShotMakes).toBe(2);
    // Shooting counts as training activity, so it starts the streak.
    expect(stats?.currentStreak).toBe(1);
    // ...and must not invent workout activity that never happened.
    expect(stats?.totalWorkoutsCompleted).toBe(0);
  });

  it("accumulates across sessions instead of overwriting", async () => {
    await seedShootingDrills();
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const { getStatsForUser } = await import("@/server/services/progressService");

    const userId = new ObjectId();

    const first = await seedProcessingSession(userId);
    await logShot(userId, first, shotInput("paint", true, 1));
    await logShot(userId, first, shotInput("paint", false, 2));
    await finalizeSession(userId, first);

    const second = await seedProcessingSession(userId);
    await logShot(userId, second, shotInput("right_mid", true, 1));
    await finalizeSession(userId, second);

    const stats = await getStatsForUser(userId);
    expect(stats?.totalShotSessions).toBe(2);
    expect(stats?.totalShotAttempts).toBe(3);
    expect(stats?.totalShotMakes).toBe(2);
  });
});

describe("shotSessionService -> Achievements (BRD 7.13)", () => {
  it("stamps the first-session milestone on finalize, and only once", async () => {
    const { logShot, finalizeSession } = await import(
      "@/server/services/shotSessionService"
    );
    const { listAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    await seedShootingDrills();
    const userId = new ObjectId();
    const sessionId = await seedProcessingSession(userId);

    await logShot(userId, sessionId, shotInput("left_corner_3", true));
    const { newlyUnlockedAchievements } = await finalizeSession(userId, sessionId);

    const rows = await listAchievementsForUser(userId);
    const keys = rows.map((row) => row.key);
    expect(keys).toContain("first_session_analyzed");
    // This account had no prior stamps, so the milestone is backfilled and
    // deliberately not announced - the toast must not claim it just happened.
    expect(rows.every((row) => row.backfilled)).toBe(true);
    expect(newlyUnlockedAchievements).toEqual([]);

    // A second session must not duplicate the row.
    const second = await seedProcessingSession(userId);
    await logShot(userId, second, shotInput("left_corner_3", true));
    await finalizeSession(userId, second);
    const after = await listAchievementsForUser(userId);
    expect(after.filter((r) => r.key === "first_session_analyzed")).toHaveLength(1);
  });
});
