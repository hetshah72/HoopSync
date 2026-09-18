import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { ShotZone, SkillCategory } from "@/types/db";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

/**
 * Inserts a completed workout directly. Goal tracking must count real
 * records, so these tests write records rather than bumping counters.
 */
async function insertCompletedWorkout(
  userId: ObjectId,
  options: { skillCategory?: SkillCategory; completedAt?: Date } = {},
) {
  const { workoutsCollection } = await import("@/server/db/collections");
  const collection = await workoutsCollection();
  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    source: { type: "skill", label: "Test workout" },
    skillCategory: options.skillCategory,
    difficulty: "beginner",
    estimatedDurationMinutes: 15,
    drills: [],
    status: "completed",
    completedAt: options.completedAt ?? new Date(),
    createdAt: new Date(),
  } as never);
}

async function insertCompletedSession(
  userId: ObjectId,
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>,
) {
  const { shotSessionsCollection } = await import("@/server/db/collections");
  const collection = await shotSessionsCollection();
  const attempts = Object.values(zoneBreakdown).reduce((n, z) => n + z.attempts, 0);
  const makes = Object.values(zoneBreakdown).reduce((n, z) => n + z.makes, 0);
  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    videoAssetId: new ObjectId(),
    recordedAt: new Date(),
    status: "completed",
    shots: [],
    totalAttempts: attempts,
    totalMakes: makes,
    fgPercent: attempts === 0 ? 0 : Math.round((makes / attempts) * 100),
    zoneBreakdown,
    trendCallouts: [],
    createdAt: new Date(),
  } as never);
}

describe("goalService: creation seeds from real activity", () => {
  it("opens a lifetime goal at the player's existing progress, not at zero", async () => {
    const { createGoalForUser } = await import("@/server/services/goalService");
    const userId = new ObjectId();

    // Shots put up *before* the goal existed still count: "make 500 shots"
    // is a lifetime milestone, so a player 3 makes in is 3 makes in.
    await insertCompletedSession(userId, { paint: { attempts: 5, makes: 3 } });
    const { userStatsCollection } = await import("@/server/db/collections");
    await (await userStatsCollection()).insertOne({
      _id: new ObjectId(),
      userId,
      currentStreak: 0,
      longestStreak: 0,
      totalWorkoutsCompleted: 0,
      totalShotSessions: 1,
      totalShotAttempts: 5,
      totalShotMakes: 3,
      updatedAt: new Date(),
    } as never);

    const goal = await createGoalForUser(userId, {
      type: "total_makes",
      targetValue: 500,
    });

    expect(goal.currentValue).toBe(3);
    expect(goal.baselineValue).toBeUndefined();
    expect(goal.status).toBe("active");
    expect(goal.autoTrackedMetricKey).toBe("shotSessions.totalMakes");
    expect(goal.title).toContain("500");
  });

  it("opens a from-creation goal at zero, banking prior work as its baseline", async () => {
    const { createGoalForUser } = await import("@/server/services/goalService");
    const userId = new ObjectId();

    // A player with a training history who sets "20 workouts before tryouts"
    // means 20 *more* - the goal must not open already finished.
    await insertCompletedWorkout(userId);
    await insertCompletedWorkout(userId);

    const goal = await createGoalForUser(userId, {
      type: "tryout_prep",
      targetValue: 5,
    });

    expect(goal.currentValue).toBe(0);
    expect(goal.baselineValue).toBe(2);
    expect(goal.status).toBe("active");
    expect(goal.autoTrackedMetricKey).toBe("workouts.totalCompleted");
    expect(goal.title).toContain("5");
  });

  it("never opens a from-creation goal already completed, however much work came before", async () => {
    const { createGoalForUser } = await import("@/server/services/goalService");
    const userId = new ObjectId();
    for (let i = 0; i < 25; i++) await insertCompletedWorkout(userId);

    const goal = await createGoalForUser(userId, {
      type: "tryout_prep",
      targetValue: 2,
    });
    expect(goal.currentValue).toBe(0);
    expect(goal.status).toBe("active");
  });

  it("opens a lifetime goal as already-completed when the target is already met", async () => {
    const { createGoalForUser } = await import("@/server/services/goalService");
    const userId = new ObjectId();
    await insertCompletedSession(userId, {
      top_of_key_3: { attempts: 10, makes: 6 },
    });

    // 60% from three already clears a 38% target.
    const goal = await createGoalForUser(userId, {
      type: "three_point_pct",
      targetValue: 38,
    });
    expect(goal.status).toBe("completed");
  });

  it("rejects an unknown goal type", async () => {
    const { createGoalForUser } = await import("@/server/services/goalService");
    await expect(
      createGoalForUser(new ObjectId(), {
        type: "not_a_real_goal" as never,
        targetValue: 5,
      }),
    ).rejects.toThrow();
  });
});

describe("goalService.recalculateGoalsForUser: automatic tracking (BRD 7.12)", () => {
  it("advances a workout-count goal from real completed workouts", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    const goal = await createGoalForUser(userId, {
      type: "tryout_prep",
      targetValue: 3,
    });
    expect(goal.currentValue).toBe(0);

    await insertCompletedWorkout(userId);
    await recalculateGoalsForUser(userId);

    const [afterOne] = await listGoalsForUser(userId);
    expect(afterOne.currentValue).toBe(1);
    expect(afterOne.status).toBe("active");
  });

  it("flips a goal to completed once the target is reached, and reports it", async () => {
    const { createGoalForUser, recalculateGoalsForUser } = await import(
      "@/server/services/goalService"
    );
    const userId = new ObjectId();
    await createGoalForUser(userId, { type: "tryout_prep", targetValue: 2 });

    await insertCompletedWorkout(userId);
    await insertCompletedWorkout(userId);
    const newlyCompleted = await recalculateGoalsForUser(userId);

    expect(newlyCompleted).toHaveLength(1);
    expect(newlyCompleted[0].status).toBe("completed");
    expect(newlyCompleted[0].currentValue).toBe(2);
  });

  it("counts only the matching skill for a skill-scoped goal", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, { type: "weak_hand", targetValue: 5 });

    await insertCompletedWorkout(userId, { skillCategory: "ball_handling" });
    await insertCompletedWorkout(userId, { skillCategory: "shooting" });
    await insertCompletedWorkout(userId, { skillCategory: "finishing" });

    await recalculateGoalsForUser(userId);
    const [goal] = await listGoalsForUser(userId);

    // Only the ball-handling workout counts toward the weak-hand goal.
    expect(goal.currentValue).toBe(1);
  });

  it("computes 3PT% from real per-zone shot data, ignoring twos", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, { type: "three_point_pct", targetValue: 40 });

    // 3/6 from three (50%), plus a perfect paint session that must not
    // inflate the three-point number.
    await insertCompletedSession(userId, {
      top_of_key_3: { attempts: 4, makes: 2 },
      left_corner_3: { attempts: 2, makes: 1 },
      paint: { attempts: 10, makes: 10 },
    });

    await recalculateGoalsForUser(userId);
    const [goal] = await listGoalsForUser(userId);

    expect(goal.currentValue).toBe(50);
    expect(goal.status).toBe("completed");
  });

  it("only counts workouts inside the window for a weekly-frequency goal", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, {
      type: "training_frequency",
      targetValue: 4,
    });

    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await insertCompletedWorkout(userId, { completedAt: longAgo });
    await insertCompletedWorkout(userId, { completedAt: longAgo });
    await insertCompletedWorkout(userId); // today

    await recalculateGoalsForUser(userId);
    const [goal] = await listGoalsForUser(userId);

    expect(goal.currentValue).toBe(1);
  });

  it("leaves archived goals alone", async () => {
    const { createGoalForUser, abandonGoal, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    const goal = await createGoalForUser(userId, {
      type: "tryout_prep",
      targetValue: 1,
    });
    await abandonGoal(userId, goal._id);

    await insertCompletedWorkout(userId);
    await recalculateGoalsForUser(userId);

    const [after] = await listGoalsForUser(userId);
    expect(after.status).toBe("abandoned");
    expect(after.currentValue).toBe(0);
  });

  it("never advances one user's goal from another user's activity", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const owner = new ObjectId();
    const stranger = new ObjectId();

    await createGoalForUser(owner, { type: "tryout_prep", targetValue: 3 });
    await insertCompletedWorkout(stranger);
    await insertCompletedWorkout(stranger);

    await recalculateGoalsForUser(owner);
    const [goal] = await listGoalsForUser(owner);
    expect(goal.currentValue).toBe(0);
  });

  it("counts activity from the goal's baseline, not the player's whole history", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await insertCompletedWorkout(userId, { skillCategory: "finishing" });
    await insertCompletedWorkout(userId, { skillCategory: "finishing" });

    const goal = await createGoalForUser(userId, {
      type: "finishing",
      targetValue: 2,
    });
    expect(goal.currentValue).toBe(0);

    // One more after the goal exists: 1 of 2, not 3 of 2.
    await insertCompletedWorkout(userId, { skillCategory: "finishing" });
    await recalculateGoalsForUser(userId);

    const [after] = await listGoalsForUser(userId);
    expect(after.currentValue).toBe(1);
    expect(after.status).toBe("active");
  });
});

describe("goalService: weekly goals are habits, not milestones (BRD 7.12)", () => {
  it("never latches a weekly goal to completed, however far past target it gets", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, {
      type: "training_frequency",
      targetValue: 2,
    });

    for (let i = 0; i < 4; i++) await insertCompletedWorkout(userId);
    const newlyCompleted = await recalculateGoalsForUser(userId);

    // Blowing past "train 2x this week" is not a goal you have finished
    // forever - so it stays active and is never announced as completed.
    expect(newlyCompleted).toHaveLength(0);
    const [goal] = await listGoalsForUser(userId);
    expect(goal.status).toBe("active");
    expect(goal.currentValue).toBe(4);
  });

  it("falls back on its own once the rolling window slides past the work", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, {
      type: "training_frequency",
      targetValue: 3,
    });

    // Three workouts, all of them now outside the 7-day window.
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      await insertCompletedWorkout(userId, { completedAt: longAgo });
    }
    await recalculateGoalsForUser(userId);

    const [goal] = await listGoalsForUser(userId);
    expect(goal.currentValue).toBe(0);
    expect(goal.status).toBe("active");
  });

  it("reports a fresh weekly value on read without writing to the goal", async () => {
    const { createGoalForUser, listGoalsForUser } = await import(
      "@/server/services/goalService"
    );
    const { goalsCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();

    const created = await createGoalForUser(userId, {
      type: "training_frequency",
      targetValue: 4,
    });
    expect(created.currentValue).toBe(0);

    // Activity lands with no recalculation - exactly the state the Progress
    // page renders in when a rolling window has moved since the last workout.
    await insertCompletedWorkout(userId);
    await insertCompletedWorkout(userId);

    const [goal] = await listGoalsForUser(userId);
    expect(goal.currentValue).toBe(2);

    // Reading the tab is a GET: it must not have written the corrected value
    // back, or rendering the page would be a mutation.
    const stored = await (await goalsCollection()).findOne({ _id: created._id });
    expect(stored?.currentValue).toBe(0);
  });
});

describe("goalService: game film goals count real reviews (BRD 7.12)", () => {
  async function insertAnalysis(
    userId: ObjectId,
    status: "processing" | "completed" | "failed",
  ) {
    const { gameFootageAnalysesCollection } = await import(
      "@/server/db/collections"
    );
    const collection = await gameFootageAnalysesCollection();
    await collection.insertOne({
      _id: new ObjectId(),
      userId,
      videoAssetId: new ObjectId(),
      uploadedAt: new Date(),
      status,
      events: [],
      strengths: [],
      weaknesses: [],
      recommendedWorkoutIds: [],
    } as never);
  }

  it("counts only films that finished analysing", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const userId = new ObjectId();

    await createGoalForUser(userId, { type: "film_study", targetValue: 2 });

    await insertAnalysis(userId, "completed");
    await insertAnalysis(userId, "processing"); // not reviewed yet
    await insertAnalysis(userId, "failed"); // gave them nothing to review
    await recalculateGoalsForUser(userId);

    const [goal] = await listGoalsForUser(userId);
    expect(goal.currentValue).toBe(1);
    expect(goal.status).toBe("active");
  });

  it("completes once enough films have really been reviewed", async () => {
    const { createGoalForUser, recalculateGoalsForUser } = await import(
      "@/server/services/goalService"
    );
    const userId = new ObjectId();

    await createGoalForUser(userId, { type: "film_study", targetValue: 2 });
    await insertAnalysis(userId, "completed");
    await insertAnalysis(userId, "completed");

    const newlyCompleted = await recalculateGoalsForUser(userId);
    expect(newlyCompleted).toHaveLength(1);
    expect(newlyCompleted[0].title).toContain("2");
  });

  it("never counts another player's game films", async () => {
    const { createGoalForUser, recalculateGoalsForUser, listGoalsForUser } =
      await import("@/server/services/goalService");
    const owner = new ObjectId();
    const stranger = new ObjectId();

    await createGoalForUser(owner, { type: "film_study", targetValue: 3 });
    await insertAnalysis(stranger, "completed");
    await insertAnalysis(stranger, "completed");

    await recalculateGoalsForUser(owner);
    const [goal] = await listGoalsForUser(owner);
    expect(goal.currentValue).toBe(0);
  });
});
