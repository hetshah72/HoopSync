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

async function seedWorkoutWithDrill(userId: ObjectId) {
  const { drillsCollection, workoutsCollection } = await import(
    "@/server/db/collections"
  );
  const drills = await drillsCollection();
  const drillResult = await drills.insertOne({
    slug: "completion-test-drill",
    name: "Completion Test Drill",
    description: "d",
    skillTags: ["shooting"],
    difficulty: "beginner",
    coachingCues: ["cue"],
    equipmentNeeded: [],
    createdAt: new Date(),
  } as never);

  const workouts = await workoutsCollection();
  const workoutId = new ObjectId();
  await workouts.insertOne({
    _id: workoutId,
    userId,
    source: { type: "skill", label: "Test workout" },
    difficulty: "beginner",
    estimatedDurationMinutes: 10,
    status: "pending",
    drills: [
      {
        drillId: drillResult.insertedId,
        order: 1,
        name: "Completion Test Drill",
        coachingCues: ["cue"],
        completed: false,
      },
    ],
    createdAt: new Date(),
  } as never);

  return workoutId;
}

describe("workoutService: start -> toggle -> complete", () => {
  it("moves pending -> in_progress on start", async () => {
    const { startWorkout } = await import("@/server/services/workoutService");
    const userId = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(userId);

    const started = await startWorkout(userId, workoutId);
    expect(started.status).toBe("in_progress");
    expect(started.startedAt).toBeInstanceOf(Date);
  });

  it("toggles a single drill's completion flag", async () => {
    const { setDrillCompletion } = await import("@/server/services/workoutService");
    const userId = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(userId);

    const updated = await setDrillCompletion(userId, workoutId, 1, true);
    expect(updated.drills[0].completed).toBe(true);
  });

  it("completing a workout marks it done and updates real Progress stats", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");
    const { getStatsForUser } = await import("@/server/services/progressService");

    const userId = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(userId);

    const beforeStats = await getStatsForUser(userId);
    expect(beforeStats).toBeNull(); // nothing completed yet

    const { workout: completed } = await completeWorkout(userId, workoutId);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeInstanceOf(Date);

    const afterStats = await getStatsForUser(userId);
    expect(afterStats?.totalWorkoutsCompleted).toBe(1);
    expect(afterStats?.currentStreak).toBe(1);
    expect(afterStats?.lastActivityDate).toBeInstanceOf(Date);
  });

  it("preserves the real per-drill record instead of force-marking every drill complete", async () => {
    const { completeWorkout, setDrillCompletion } = await import(
      "@/server/services/workoutService"
    );

    const userId = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(userId);

    // The player never marked the drill off - finishing the workout must not
    // rewrite history to claim they did. Progress and future skill tracking
    // depend on this record being truthful about what was actually done.
    const { workout: completed } = await completeWorkout(userId, workoutId);
    expect(completed.status).toBe("completed");
    expect(completed.drills[0].completed).toBe(false);

    // ...and a drill the player *did* mark off stays marked off.
    const otherWorkoutId = await seedWorkoutWithDrill(userId);
    await setDrillCompletion(userId, otherWorkoutId, 1, true);
    const { workout: second } = await completeWorkout(userId, otherWorkoutId);
    expect(second.drills[0].completed).toBe(true);
  });

  it("completing the same workout twice does not double-count Progress", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");
    const { getStatsForUser } = await import("@/server/services/progressService");

    const userId = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(userId);

    await completeWorkout(userId, workoutId);
    await completeWorkout(userId, workoutId); // idempotent re-call

    const stats = await getStatsForUser(userId);
    expect(stats?.totalWorkoutsCompleted).toBe(1);
  });

  it("throws for a workout that doesn't belong to the user", async () => {
    const { completeWorkout } = await import("@/server/services/workoutService");
    const owner = new ObjectId();
    const otherUser = new ObjectId();
    const workoutId = await seedWorkoutWithDrill(owner);

    await expect(completeWorkout(otherUser, workoutId)).rejects.toThrow();
  });
});

describe("workoutService: completion stamps achievements (BRD 7.13)", () => {
  it("records the first-workout milestone, and never twice", async () => {
    const { completeWorkout, startWorkout } = await import(
      "@/server/services/workoutService"
    );
    const { listAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    const userId = new ObjectId();

    const first = await seedWorkoutWithDrill(userId);
    await startWorkout(userId, first);
    await completeWorkout(userId, first);

    const rows = await listAchievementsForUser(userId);
    expect(rows.map((row) => row.key)).toContain("first_workout");
    // The account's history predated this evaluation, so nothing is announced.
    expect(rows.every((row) => row.backfilled)).toBe(true);

    // Re-completing must not duplicate the stamp - completeWorkout's
    // already-completed guard plus the unique index both protect this.
    await completeWorkout(userId, first);
    const after = await listAchievementsForUser(userId);
    expect(after.filter((row) => row.key === "first_workout")).toHaveLength(1);

    // A second, genuinely later workout is announceable.
    const second = await seedWorkoutWithDrill(userId);
    await startWorkout(userId, second);
    const result = await completeWorkout(userId, second);
    expect(Array.isArray(result.newlyUnlockedAchievements)).toBe(true);
  });
});
