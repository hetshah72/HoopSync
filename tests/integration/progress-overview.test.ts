import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { ShotZone } from "@/types/db";

/**
 * BRD 7.11: Progress must display real activity, and completing a workout or
 * shot session must move it.
 *
 * These assert the *read* side end to end - that `getProgressOverview` reports
 * what the player actually did - plus the guarantee that the Feed and Progress
 * can never name different zones for the same player.
 */

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

async function seedCompletedSession(
  userId: ObjectId,
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>,
  recordedAt = new Date(),
) {
  const { shotSessionsCollection } = await import("@/server/db/collections");
  const collection = await shotSessionsCollection();
  const _id = new ObjectId();

  const totals = Object.values(zoneBreakdown).reduce(
    (acc, stats) => ({
      attempts: acc.attempts + (stats?.attempts ?? 0),
      makes: acc.makes + (stats?.makes ?? 0),
    }),
    { attempts: 0, makes: 0 },
  );

  await collection.insertOne({
    _id,
    userId,
    videoAssetId: new ObjectId(),
    recordedAt,
    status: "completed",
    shots: [],
    totalAttempts: totals.attempts,
    totalMakes: totals.makes,
    fgPercent:
      totals.attempts > 0
        ? Math.round((totals.makes / totals.attempts) * 1000) / 10
        : 0,
    zoneBreakdown,
    trendCallouts: [],
    createdAt: recordedAt,
  } as never);

  return _id;
}

async function seedCompletedWorkout(
  userId: ObjectId,
  label: string,
  completedAt: Date,
) {
  const { workoutsCollection } = await import("@/server/db/collections");
  const collection = await workoutsCollection();
  const _id = new ObjectId();
  await collection.insertOne({
    _id,
    userId,
    source: { type: "daily_feed", label },
    drills: [],
    status: "completed",
    estimatedDurationMinutes: 20,
    actualDurationSeconds: 1200,
    completedAt,
    createdAt: completedAt,
  } as never);
  return _id;
}

describe("getProgressOverview: what the player actually did", () => {
  it("is empty and claims nothing for a brand-new account", async () => {
    const { getProgressOverview } = await import(
      "@/server/services/progressService"
    );

    const overview = await getProgressOverview(new ObjectId());

    expect(overview.stats).toBeNull();
    expect(overview.lifetimeFgPercent).toBeUndefined();
    expect(overview.strength).toBeNull();
    expect(overview.weakness).toBeNull();
    expect(overview.history).toEqual([]);
    expect(overview.workoutsThisWeek).toBe(0);
  });

  it("reports lifetime shooting totals written by a finalized session", async () => {
    const { finalizeSession, logShot } = await import(
      "@/server/services/shotSessionService"
    );
    const { getProgressOverview } = await import(
      "@/server/services/progressService"
    );
    const { shotSessionsCollection, drillsCollection } = await import(
      "@/server/db/collections"
    );

    // finalizeSession looks up a correction drill by slug; seed the ones the
    // deterministic template picker can land on.
    const drills = await drillsCollection();
    await drills.insertMany(
      [
        "form-shooting-close-range",
        "one-dribble-pull-up",
        "hesitation-pull-up-signature",
      ].map((slug) => ({
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

    const userId = new ObjectId();
    const sessions = await shotSessionsCollection();
    const sessionId = new ObjectId();
    await sessions.insertOne({
      _id: sessionId,
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

    // Three real tap-logged shots: 2 of 3 from the paint.
    await logShot(userId, sessionId, {
      zone: "paint",
      xPct: 50,
      yPct: 20,
      made: true,
      timestampInVideoSeconds: 5,
    });
    await logShot(userId, sessionId, {
      zone: "paint",
      xPct: 50,
      yPct: 20,
      made: true,
      timestampInVideoSeconds: 10,
    });
    await logShot(userId, sessionId, {
      zone: "paint",
      xPct: 50,
      yPct: 20,
      made: false,
      timestampInVideoSeconds: 15,
    });

    await finalizeSession(userId, sessionId);

    const overview = await getProgressOverview(userId);

    expect(overview.stats?.totalShotSessions).toBe(1);
    expect(overview.stats?.totalShotAttempts).toBe(3);
    expect(overview.stats?.totalShotMakes).toBe(2);
    expect(overview.lifetimeFgPercent).toBe(66.7);

    // The session shows up in history, linking back to its own report.
    const sessionRow = overview.history.find((e) => e.kind === "shot_session");
    expect(sessionRow?.id).toBe(sessionId.toString());
    expect(sessionRow?.href).toBe(`/analyze/shooting/${sessionId.toString()}`);
    expect(sessionRow?.detail).toBe("2/3 - 66.7%");
  });

  it("refuses to name a weakness on a thin sample, then names one once the evidence is there", async () => {
    const { getProgressOverview } = await import(
      "@/server/services/progressService"
    );
    const userId = new ObjectId();

    // Two attempts from one zone is not a standing weakness.
    await seedCompletedSession(userId, {
      left_corner_3: { attempts: 2, makes: 0 },
      paint: { attempts: 2, makes: 2 },
    });

    let overview = await getProgressOverview(userId);
    expect(overview.weakness).toBeNull();
    expect(overview.strength).toBeNull();
    expect(overview.totalAttemptsInSample).toBe(4);

    // A second session pushes both zones past the evidence bar.
    await seedCompletedSession(userId, {
      left_corner_3: { attempts: 8, makes: 1 },
      paint: { attempts: 8, makes: 7 },
    });

    overview = await getProgressOverview(userId);
    expect(overview.weakness?.zone).toBe("left_corner_3");
    expect(overview.weakness?.attempts).toBe(10);
    expect(overview.strength?.zone).toBe("paint");
    expect(overview.sessionsInSample).toBe(2);
  });

  it("orders workouts, sessions and game film into one history newest-first", async () => {
    const { getProgressOverview } = await import(
      "@/server/services/progressService"
    );
    const { gameFootageAnalysesCollection } = await import(
      "@/server/db/collections"
    );
    const userId = new ObjectId();

    const workoutId = await seedCompletedWorkout(
      userId,
      "Shooting tune-up",
      new Date("2026-09-10T10:00:00Z"),
    );
    await seedCompletedSession(
      userId,
      { paint: { attempts: 6, makes: 3 } },
      new Date("2026-09-12T10:00:00Z"),
    );
    const films = await gameFootageAnalysesCollection();
    const filmId = new ObjectId();
    await films.insertOne({
      _id: filmId,
      userId,
      videoAssetId: new ObjectId(),
      uploadedAt: new Date("2026-09-11T10:00:00Z"),
      status: "completed",
      events: [],
      strengths: [],
      weaknesses: [],
      recommendedWorkoutIds: [],
      isSimulated: true,
    } as never);

    const overview = await getProgressOverview(userId);

    expect(overview.history.map((e) => e.kind)).toEqual([
      "shot_session",
      "game_film",
      "workout",
    ]);

    const workoutRow = overview.history.find((e) => e.kind === "workout");
    expect(workoutRow?.label).toBe("Shooting tune-up");
    expect(workoutRow?.href).toBe(`/train/${workoutId.toString()}`);

    // Game film is listed as a real activity, with none of its simulated
    // findings pulled onto the Progress page.
    const filmRow = overview.history.find((e) => e.kind === "game_film");
    expect(filmRow?.label).toBe("Game film review");
    expect(filmRow?.detail).toBeUndefined();
  });

  it("agrees with the Feed about the player's strength and weakness", async () => {
    // The regression this guards: if Progress re-derived call-outs with its
    // own thresholds, the Feed could name one zone and Progress another for
    // the same player on the same data.
    const { getProgressOverview } = await import(
      "@/server/services/progressService"
    );
    const { loadFeedSignals } = await import(
      "@/server/services/feedSignalsService"
    );
    const userId = new ObjectId();

    await seedCompletedSession(userId, {
      left_wing_3: { attempts: 12, makes: 2 },
      paint: { attempts: 12, makes: 10 },
      right_mid: { attempts: 3, makes: 1 },
    });

    const overview = await getProgressOverview(userId);
    const signals = await loadFeedSignals(userId, "2026-09-14");

    expect(overview.weakness?.zone).toBe(signals.weakestZone?.zone);
    expect(overview.strength?.zone).toBe(signals.bestZone?.zone);
    expect(overview.totalAttemptsInSample).toBe(signals.totalAttemptsInSample);
  });
});
