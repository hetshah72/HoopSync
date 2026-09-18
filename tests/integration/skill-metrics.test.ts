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

async function seedWorkout(
  userId: ObjectId,
  drills: Array<{
    skillTags: string[];
    completed: boolean;
    skipped?: boolean;
    elapsedSeconds?: number;
  }>,
) {
  const { workoutsCollection } = await import("@/server/db/collections");
  const collection = await workoutsCollection();
  const workoutId = new ObjectId();
  await collection.insertOne({
    _id: workoutId,
    userId,
    source: { type: "skill", label: "Test" },
    difficulty: "beginner",
    estimatedDurationMinutes: 10,
    status: "in_progress",
    startedAt: new Date(),
    drills: drills.map((d, i) => ({
      drillId: new ObjectId(),
      order: i + 1,
      name: `drill-${i + 1}`,
      coachingCues: [],
      ...d,
    })),
    createdAt: new Date(),
  } as never);
  return workoutId;
}

describe("skill metrics (BRD 7.3: completion updates the relevant skill metrics)", () => {
  it("credits only the skills whose drills were actually completed", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");
    const { getStatsForUser } = await import("@/server/services/progressService");

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: true, elapsedSeconds: 120 },
      { skillTags: ["defense"], completed: false, skipped: true },
    ]);

    await completeWorkout(userId, workoutId);
    const stats = await getStatsForUser(userId);

    expect(stats?.skillMetrics?.shooting).toMatchObject({
      workoutsCompleted: 1,
      drillsCompleted: 1,
      secondsTrained: 120,
    });
    // The skipped drill must not appear at all - claiming it would overstate
    // what the player did.
    expect(stats?.skillMetrics?.defense).toBeUndefined();
  });

  it("matches a from-scratch rebuild, so the counters can't silently drift", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");
    const { getStatsForUser, recomputeSkillMetricsForUser } = await import(
      "@/server/services/progressService"
    );

    const userId = new ObjectId();
    for (const tags of [["shooting"], ["shooting", "footwork"], ["defense"]]) {
      const id = await seedWorkout(userId, [
        { skillTags: tags, completed: true, elapsedSeconds: 60 },
      ]);
      await completeWorkout(userId, id);
    }

    const incremental = (await getStatsForUser(userId))?.skillMetrics;
    const rebuilt = (await recomputeSkillMetricsForUser(userId)).skillMetrics;

    expect(rebuilt).toEqual(incremental);
    expect(rebuilt?.shooting?.drillsCompleted).toBe(2);
    expect(rebuilt?.footwork?.drillsCompleted).toBe(1);
    expect(rebuilt?.defense?.drillsCompleted).toBe(1);
  });

  it("records the real time spent as the workout's actual duration", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: true, elapsedSeconds: 90 },
      { skillTags: ["shooting"], completed: true, elapsedSeconds: 30 },
    ]);

    const { workout: completed } = await completeWorkout(userId, workoutId);
    expect(completed.actualDurationSeconds).toBe(120);
  });

  it("does not let a shooting session zero the workout-side counters", async () => {
    // saveStats patches rather than replaces; before that, each writer had to
    // re-carry every field and forgetting one silently reset it.
    const { completeWorkout } = await import("@/server/services/workoutService");
    const { recordShotSessionCompletion, getStatsForUser } = await import(
      "@/server/services/progressService"
    );

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: true, elapsedSeconds: 60 },
    ]);
    await completeWorkout(userId, workoutId);

    await recordShotSessionCompletion(userId, {
      totalAttempts: 10,
      totalMakes: 4,
    });

    const stats = await getStatsForUser(userId);
    expect(stats?.totalWorkoutsCompleted).toBe(1);
    expect(stats?.skillMetrics?.shooting?.drillsCompleted).toBe(1);
    expect(stats?.totalShotAttempts).toBe(10);
  });

  it("seeds a complete stats document when a shot session is the first activity", async () => {
    const { recordShotSessionCompletion } = await import(
      "@/server/services/progressService"
    );

    const userId = new ObjectId();
    const stats = await recordShotSessionCompletion(userId, {
      totalAttempts: 5,
      totalMakes: 2,
    });

    // Required counters must exist even when the writer doesn't own them.
    expect(stats.totalWorkoutsCompleted).toBe(0);
    expect(stats.longestStreak).toBeGreaterThanOrEqual(1);
  });
});

describe("per-drill record integrity", () => {
  it("preserves what was actually done instead of force-marking on completion", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: true },
      { skillTags: ["defense"], completed: false },
    ]);

    const { workout: completed } = await completeWorkout(userId, workoutId);
    expect(completed.drills[0].completed).toBe(true);
    expect(completed.drills[1].completed).toBe(false);
  });

  it("refuses to edit a drill once the workout is complete", async () => {
    const { completeWorkout, setDrillCompletion } = await import(
      "@/server/services/workoutService"
    );

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: false },
    ]);
    await completeWorkout(userId, workoutId);

    // Editing afterwards would desync the workout from the Progress and skill
    // numbers already written from it.
    await expect(
      setDrillCompletion(userId, workoutId, 1, true),
    ).rejects.toThrow(/already complete/i);
  });

  it("treats completing and skipping as mutually exclusive", async () => {
    const { setDrillCompletion, setDrillSkipped } = await import(
      "@/server/services/workoutService"
    );

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: false },
    ]);

    const skipped = await setDrillSkipped(userId, workoutId, 1, true);
    expect(skipped.drills[0].skipped).toBe(true);

    const done = await setDrillCompletion(userId, workoutId, 1, true);
    expect(done.drills[0].completed).toBe(true);
    expect(done.drills[0].skipped).toBe(false);
  });

  it("accumulates drill time across separate reports", async () => {
    const { recordDrillElapsed, getWorkoutForUser } = await import(
      "@/server/services/workoutService"
    );

    const userId = new ObjectId();
    const workoutId = await seedWorkout(userId, [
      { skillTags: ["shooting"], completed: false },
    ]);

    await recordDrillElapsed(userId, workoutId, 1, 30);
    await recordDrillElapsed(userId, workoutId, 1, 45);

    const workout = await getWorkoutForUser(userId, workoutId);
    expect(workout?.drills[0].elapsedSeconds).toBe(75);
  });
});
