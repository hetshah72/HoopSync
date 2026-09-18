import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

async function seedCompletedSession(userId: ObjectId) {
  const { shotSessionsCollection } = await import("@/server/db/collections");
  const collection = await shotSessionsCollection();
  const sessionId = new ObjectId();
  await collection.insertOne({
    _id: sessionId,
    userId,
    videoAssetId: new ObjectId(),
    recordedAt: new Date(),
    status: "completed",
    shots: [],
    totalAttempts: 20,
    totalMakes: 5,
    fgPercent: 25,
    zoneBreakdown: {
      paint: { attempts: 6, makes: 4 },
      right_wing_3: { attempts: 8, makes: 1 },
    },
    bestZone: "paint",
    weakestZone: "right_wing_3",
    trendCallouts: [],
    createdAt: new Date(),
  } as never);
  return sessionId;
}

describe("confidenceService pre-game check-in (BRD 7.10)", () => {
  it("stores the feeling with the routine the player was actually given", async () => {
    const { recordPreGameCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();

    const checkin = await recordPreGameCheckin(userId, "nervous");

    expect(checkin.type).toBe("pre_game");
    expect(checkin.feeling).toBe("nervous");
    // Snapshotted, so the record shows what was given even if the routine
    // text is later edited.
    expect(checkin.routine?.toLowerCase()).toContain("box breathing");
    expect(checkin.routine?.toLowerCase()).toContain("free throw");
  });

  it("returns the latest check-in for the player", async () => {
    const { recordPreGameCheckin, getLatestPreGameCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();

    await recordPreGameCheckin(userId, "confident");
    await recordPreGameCheckin(userId, "overthinking");

    const latest = await getLatestPreGameCheckin(userId);
    expect(latest?.feeling).toBe("overthinking");
  });

  it("revises today's check-in in place instead of appending a row per tap", async () => {
    const { recordPreGameCheckin, listCheckinsForUser } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();

    // A player picking a feeling, changing their mind, and changing it back.
    await recordPreGameCheckin(userId, "confident");
    await recordPreGameCheckin(userId, "nervous");
    await recordPreGameCheckin(userId, "confident");

    const all = await listCheckinsForUser(userId);
    expect(all).toHaveLength(1);
    expect(all[0].feeling).toBe("confident");
    // The routine is re-snapshotted alongside the revised feeling.
    expect(all[0].routine?.toLowerCase()).toContain("form shots");
  });

  it("starts a new row on a new day", async () => {
    const { recordPreGameCheckin, listCheckinsForUser } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await recordPreGameCheckin(userId, "nervous", yesterday);
    await recordPreGameCheckin(userId, "confident");

    expect(await listCheckinsForUser(userId)).toHaveLength(2);
  });

  it("scopes check-ins to their owner", async () => {
    const { recordPreGameCheckin, getLatestPreGameCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const owner = new ObjectId();
    await recordPreGameCheckin(owner, "nervous");

    expect(await getLatestPreGameCheckin(new ObjectId())).toBeNull();
  });
});

describe("confidenceService recovery plan (BRD 7.10)", () => {
  it("builds the plan from the player's real session and workout data", async () => {
    const { createRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();
    const sessionId = await seedCompletedSession(userId);

    const { checkin, plan } = await createRecoveryCheckin(userId);

    // The BRD's success criterion: references real data from that session.
    expect(plan.isDataBacked).toBe(true);
    const text = [...plan.positives, ...plan.areasToImprove].join(" ");
    expect(text).toContain("Right Wing 3");
    expect(text).toContain("5 of 20");

    expect(checkin.type).toBe("post_game");
    expect(checkin.recoveryPlan?.planSteps.length).toBeGreaterThan(0);
    // Stored rather than re-derived on read, so the page and the lib can't drift.
    expect(checkin.recoveryPlan?.isDataBacked).toBe(true);
    // "Can recommend reviewing the last session" - linked to the real one.
    expect(checkin.relatedSessionId?.toString()).toBe(sessionId.toString());
  });

  it("says it has no data rather than inventing encouragement", async () => {
    const { createRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const userId = new ObjectId();

    const { checkin, plan } = await createRecoveryCheckin(userId);

    expect(plan.isDataBacked).toBe(false);
    expect(plan.planSteps.join(" ")).toContain("Analyze");
    expect(checkin.recoveryPlan?.isDataBacked).toBe(false);
    expect(checkin.relatedSessionId).toBeUndefined();
  });

  it("survives a run of pre-game check-ins burying it", async () => {
    // The page used to read the 20 newest check-ins of any type and pick the
    // post-game one out in JS, so a player tapping through feelings pushed
    // their recovery plan off the end of the window and it vanished.
    const { createRecoveryCheckin, getLatestRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const { createCheckin } = await import(
      "@/server/repositories/confidenceRepository"
    );
    const userId = new ObjectId();
    await seedCompletedSession(userId);

    await createRecoveryCheckin(userId);

    for (let i = 0; i < 25; i++) {
      await createCheckin({
        userId,
        type: "pre_game",
        feeling: "nervous",
        routine: "…",
        createdAt: new Date(),
      });
    }

    const latest = await getLatestRecoveryCheckin(userId);
    expect(latest?.recoveryPlan?.planSteps.length).toBeGreaterThan(0);
  });

  it("links the workout that session already generated", async () => {
    const { createRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const { shotSessionsCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();
    const sessionId = await seedCompletedSession(userId);
    const workoutId = new ObjectId();
    await (
      await shotSessionsCollection()
    ).updateOne(
      { _id: sessionId },
      { $set: { recommendedWorkoutId: workoutId } },
    );

    const { checkin, plan } = await createRecoveryCheckin(userId);

    expect(checkin.relatedWorkoutId?.toString()).toBe(workoutId.toString());
    // And the step telling them to run it only appears alongside the link.
    expect(plan.planSteps.join(" ")).toContain("Run the workout");
  });

  it("credits completed workouts from the last week", async () => {
    const { createRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const { workoutsCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();

    await (
      await workoutsCollection()
    ).insertOne({
      _id: new ObjectId(),
      userId,
      source: { type: "skill", label: "Test" },
      difficulty: "beginner",
      estimatedDurationMinutes: 20,
      status: "completed",
      completedAt: new Date(),
      drills: [],
      createdAt: new Date(),
    } as never);

    const { plan } = await createRecoveryCheckin(userId);
    expect(plan.positives.join(" ")).toContain("1 workout");
  });
});
