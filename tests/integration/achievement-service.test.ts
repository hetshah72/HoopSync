import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { SkillCategory } from "@/types/db";

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
 * Writes a real `userStats` document.
 *
 * Achievements are derived from the same counters Progress maintains, so these
 * tests set those counters rather than inserting achievement rows - an
 * achievement row is only ever a date stamp, never the thing that makes an
 * achievement earned.
 */
async function setStats(
  userId: ObjectId,
  fields: {
    totalWorkoutsCompleted?: number;
    totalShotSessions?: number;
    totalShotMakes?: number;
    longestStreak?: number;
    drillsBySkill?: Partial<Record<SkillCategory, number>>;
  },
) {
  const { userStatsCollection } = await import("@/server/db/collections");
  const collection = await userStatsCollection();

  const skillMetrics: Record<string, unknown> = {};
  for (const [skill, drills] of Object.entries(fields.drillsBySkill ?? {})) {
    skillMetrics[skill] = {
      workoutsCompleted: 1,
      drillsCompleted: drills,
      secondsTrained: 0,
    };
  }

  await collection.updateOne(
    { userId },
    {
      $set: {
        userId,
        currentStreak: 1,
        longestStreak: fields.longestStreak ?? 0,
        totalWorkoutsCompleted: fields.totalWorkoutsCompleted ?? 0,
        totalShotSessions: fields.totalShotSessions ?? 0,
        totalShotMakes: fields.totalShotMakes ?? 0,
        ...(fields.drillsBySkill ? { skillMetrics } : {}),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function insertCompletedGoal(userId: ObjectId) {
  const { goalsCollection } = await import("@/server/db/collections");
  const collection = await goalsCollection();
  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    type: "tryout_prep",
    title: "Complete 2 workouts before tryouts",
    targetValue: 2,
    currentValue: 2,
    unit: "workouts",
    status: "completed",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

async function insertCompletedAnalysis(userId: ObjectId) {
  const { gameFootageAnalysesCollection } = await import("@/server/db/collections");
  const collection = await gameFootageAnalysesCollection();
  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    videoAssetId: new ObjectId(),
    uploadedAt: new Date(),
    status: "completed",
    events: [],
    strengths: [],
    weaknesses: [],
    recommendedWorkoutIds: [],
    isSimulated: true,
  } as never);
}

async function insertSharedCoachConversation(
  userId: ObjectId,
  type: "shot_session" | "game_footage_analysis" | "feed_item" = "shot_session",
) {
  const { coachConversationsCollection } = await import("@/server/db/collections");
  const collection = await coachConversationsCollection();
  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    personality: "balanced",
    lastMessageAt: new Date(),
    contextRefs: [{ type, refId: new ObjectId() }],
    createdAt: new Date(),
  } as never);
}

describe("getAchievementStateForUser: derived, never stored", () => {
  it("reports an achievement as earned with no stored row at all", async () => {
    // The whole design in one assertion: the criterion is the authority, so a
    // player with real counters and an empty achievements collection still has
    // earned the badge.
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 10 });

    const state = await getAchievementStateForUser(userId);
    const keys = state.unlocked.map((entry) => entry.key);
    expect(keys).toContain("first_workout");
    expect(keys).toContain("workouts_10");
    expect(keys).not.toContain("workouts_25");
  });

  it("credits work done before the feature existed, with no backfill step", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await setStats(userId, {
      totalWorkoutsCompleted: 60,
      totalShotMakes: 800,
      longestStreak: 30,
    });

    const state = await getAchievementStateForUser(userId);
    expect(state.unlockedCount).toBeGreaterThan(5);
    expect(state.xp).toBeGreaterThan(0);
  });

  it("gives a brand-new account zero XP, the first tier and nothing earned", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const state = await getAchievementStateForUser(new ObjectId());

    expect(state.xp).toBe(0);
    expect(state.tier.tier.key).toBe("getting_started");
    expect(state.unlockedCount).toBe(0);
    expect(state.locked.length).toBe(state.totalCount);
    expect(state.latestUnlock).toBeNull();
    // Still points somewhere, so the tab is never a dead end.
    expect(state.next).not.toBeNull();
  });

  it("never writes - two reads leave the collection empty", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const { countAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 25 });

    await getAchievementStateForUser(userId);
    await getAchievementStateForUser(userId);

    // The Progress page is a Server Component; reading it must not mutate.
    expect(await countAchievementsForUser(userId)).toBe(0);
  });

  it("computes XP from the documented weights", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await setStats(userId, {
      totalWorkoutsCompleted: 2,
      totalShotSessions: 1,
      totalShotMakes: 30,
      longestStreak: 3,
    });

    // 100 + 30 + 30 + 60
    expect((await getAchievementStateForUser(userId)).xp).toBe(220);
  });

  it("treats a stats document with no optional counters as zero, not NaN", async () => {
    const { userStatsCollection } = await import("@/server/db/collections");
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();

    // A document shaped the way pre-feature stats were: no shot totals, no
    // skillMetrics.
    const collection = await userStatsCollection();
    await collection.insertOne({
      _id: new ObjectId(),
      userId,
      currentStreak: 0,
      longestStreak: 0,
      totalWorkoutsCompleted: 3,
      totalShotSessions: 0,
      updatedAt: new Date(),
    } as never);

    const state = await getAchievementStateForUser(userId);
    expect(Number.isNaN(state.xp)).toBe(false);
    expect(state.xp).toBe(150);
  });
});

describe("recordNewlyUnlockedAchievements: stamping", () => {
  it("backfills an account with pre-existing activity and announces nothing", async () => {
    const { recordNewlyUnlockedAchievements } = await import(
      "@/server/services/achievementService"
    );
    const { listAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 25, longestStreak: 7 });

    const announced = await recordNewlyUnlockedAchievements(userId);

    // Nothing to announce: they passed these before the feature saw them.
    expect(announced).toEqual([]);
    const rows = await listAchievementsForUser(userId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.backfilled)).toBe(true);
  });

  it("announces a genuinely new unlock after the first evaluation", async () => {
    const { recordNewlyUnlockedAchievements } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();

    // First activity ever: backfilled, silent.
    await setStats(userId, { totalWorkoutsCompleted: 1 });
    expect(await recordNewlyUnlockedAchievements(userId)).toEqual([]);

    // Later they reach 10 - that one is real news.
    await setStats(userId, { totalWorkoutsCompleted: 10 });
    const announced = await recordNewlyUnlockedAchievements(userId);

    expect(announced.map((row) => row.key)).toContain("workouts_10");
    expect(announced.every((row) => !row.backfilled)).toBe(true);
  });

  it("is idempotent - a second call announces nothing new", async () => {
    const { recordNewlyUnlockedAchievements } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 1 });
    await recordNewlyUnlockedAchievements(userId);

    await setStats(userId, { totalWorkoutsCompleted: 10 });
    const first = await recordNewlyUnlockedAchievements(userId);
    const second = await recordNewlyUnlockedAchievements(userId);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it("never moves a stamp that already exists", async () => {
    const { recordNewlyUnlockedAchievements } = await import(
      "@/server/services/achievementService"
    );
    const { listAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 1 });
    await recordNewlyUnlockedAchievements(userId);

    const before = (await listAchievementsForUser(userId)).find(
      (row) => row.key === "first_workout",
    )!;

    await setStats(userId, { totalWorkoutsCompleted: 5 });
    await recordNewlyUnlockedAchievements(userId);

    const after = (await listAchievementsForUser(userId)).find(
      (row) => row.key === "first_workout",
    )!;
    expect(after.firstObservedAt.getTime()).toBe(before.firstObservedAt.getTime());
  });

  it("stamps at most one row per key even when called concurrently", async () => {
    const { recordNewlyUnlockedAchievements } = await import(
      "@/server/services/achievementService"
    );
    const { listAchievementsForUser } = await import(
      "@/server/repositories/achievementRepository"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 10 });

    // Two tabs finishing a workout at once. The unique index on
    // {userId, key} is what makes this safe, not the read above it.
    await Promise.all([
      recordNewlyUnlockedAchievements(userId),
      recordNewlyUnlockedAchievements(userId),
    ]);

    const rows = await listAchievementsForUser(userId);
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("surfaces an earned date only for genuine unlocks", async () => {
    const { recordNewlyUnlockedAchievements, getAchievementStateForUser } =
      await import("@/server/services/achievementService");
    const userId = new ObjectId();

    await setStats(userId, { totalWorkoutsCompleted: 1 });
    await recordNewlyUnlockedAchievements(userId);
    await setStats(userId, { totalWorkoutsCompleted: 10 });
    await recordNewlyUnlockedAchievements(userId);

    const state = await getAchievementStateForUser(userId);
    const backfilled = state.unlocked.find((e) => e.key === "first_workout")!;
    const genuine = state.unlocked.find((e) => e.key === "workouts_10")!;

    // Both are earned; only one has a date we can honestly show.
    expect(backfilled.earnedAt).toBeUndefined();
    expect(genuine.earnedAt).toBeInstanceOf(Date);
    expect(state.latestUnlock?.key).toBe("workouts_10");
  });
});

describe("loop milestones read real records", () => {
  it("earns Goal Closed Out only from a completed goal", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await setStats(userId, { totalWorkoutsCompleted: 5 });

    let keys = (await getAchievementStateForUser(userId)).unlocked.map((e) => e.key);
    expect(keys).not.toContain("first_goal_completed");

    await insertCompletedGoal(userId);
    keys = (await getAchievementStateForUser(userId)).unlocked.map((e) => e.key);
    expect(keys).toContain("first_goal_completed");
  });

  it("earns Film Reviewed only from a completed analysis", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );
    const userId = new ObjectId();
    await insertCompletedAnalysis(userId);

    const keys = (await getAchievementStateForUser(userId)).unlocked.map((e) => e.key);
    expect(keys).toContain("first_game_film");
  });

  it("earns Took It to Coach from a shared session, not from Ask Coach", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );

    // "Ask Coach about this card" is a question, not a BRD 7.8 hand-off.
    const asker = new ObjectId();
    await insertSharedCoachConversation(asker, "feed_item");
    let keys = (await getAchievementStateForUser(asker)).unlocked.map((e) => e.key);
    expect(keys).not.toContain("first_coach_share");

    const sharer = new ObjectId();
    await insertSharedCoachConversation(sharer, "shot_session");
    keys = (await getAchievementStateForUser(sharer)).unlocked.map((e) => e.key);
    expect(keys).toContain("first_coach_share");
  });
});

describe("skill milestones", () => {
  it("earn per skill at the drill threshold and never by summing skills", async () => {
    const { getAchievementStateForUser } = await import(
      "@/server/services/achievementService"
    );

    const spread = new ObjectId();
    await setStats(spread, {
      drillsBySkill: { shooting: 20, ball_handling: 20 },
    });
    let keys = (await getAchievementStateForUser(spread)).unlocked.map((e) => e.key);
    expect(keys).not.toContain("skill_shooting");
    expect(keys).not.toContain("skill_ball_handling");

    const focused = new ObjectId();
    await setStats(focused, { drillsBySkill: { shooting: 25 } });
    keys = (await getAchievementStateForUser(focused)).unlocked.map((e) => e.key);
    expect(keys).toContain("skill_shooting");
    expect(keys).not.toContain("skill_defense");
  });
});

describe("cross-user isolation", () => {
  it("does not let one player's activity unlock another player's milestones", async () => {
    const { getAchievementStateForUser, recordNewlyUnlockedAchievements } =
      await import("@/server/services/achievementService");
    const busy = new ObjectId();
    const idle = new ObjectId();

    await setStats(busy, { totalWorkoutsCompleted: 100, longestStreak: 30 });
    await insertCompletedGoal(busy);
    await recordNewlyUnlockedAchievements(busy);

    const idleState = await getAchievementStateForUser(idle);
    expect(idleState.unlockedCount).toBe(0);
    expect(idleState.xp).toBe(0);
  });
});
