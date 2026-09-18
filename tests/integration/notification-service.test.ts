import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import type { UserStatsDoc } from "@/types/db";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";

  // The unique {userId, dedupeKey} index is the mechanism under test, not an
  // optimisation, so these tests run against the real initialized schema
  // rather than a bare collection.
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const { initializeDatabase } = await import("../../scripts/db/init");
  await initializeDatabase(client.db("hoopsync_test"));
  await client.close();
});

afterAll(async () => {
  await mongod.stop();
});

beforeEach(async () => {
  const { notificationsCollection, playerProfilesCollection } = await import(
    "@/server/db/collections"
  );
  await (await notificationsCollection()).deleteMany({});
  await (await playerProfilesCollection()).deleteMany({});
});

/** Onboarded profile - the service reads preferences off it. */
async function insertProfile(
  userId: ObjectId,
  overrides: Record<string, unknown> = {},
) {
  const { playerProfilesCollection } = await import("@/server/db/collections");
  await (
    await playerProfilesCollection()
  ).insertOne({
    _id: new ObjectId(),
    userId,
    focusAreas: ["shooting"],
    equipment: ["hoop", "ball"],
    coachPersonality: "balanced",
    consent: { parentalConsentRequired: false, parentalConsentGiven: false },
    onboardingCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never);
}

function stats(overrides: Partial<UserStatsDoc> = {}): UserStatsDoc {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    currentStreak: 0,
    longestStreak: 0,
    totalWorkoutsCompleted: 0,
    totalShotSessions: 0,
    updatedAt: new Date(),
    ...overrides,
  } as UserStatsDoc;
}

async function listAll(userId: ObjectId) {
  const { listNotificationsForUser } = await import(
    "@/server/repositories/notificationRepository"
  );
  return listNotificationsForUser(userId);
}

describe("notification emission is at-most-once", () => {
  it("does not raise the same milestone twice", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones } = await import(
      "@/server/services/notificationService"
    );

    const before = stats({ userId, totalWorkoutsCompleted: 9 });
    const after = stats({ userId, totalWorkoutsCompleted: 10 });

    await notifyProgressMilestones(userId, before, after);
    await notifyProgressMilestones(userId, before, after);

    const all = await listAll(userId);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("progress_milestone");
    expect(all[0].dedupeKey).toBe("progress_milestone:workouts:10");
  });

  it("inserts exactly one row when two emissions race", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones } = await import(
      "@/server/services/notificationService"
    );

    const before = stats({ userId, totalShotSessions: 4 });
    const after = stats({ userId, totalShotSessions: 5 });

    // Two devices finishing a session at once. Only the unique index can
    // arbitrate; a read-then-write would let both through.
    await Promise.all([
      notifyProgressMilestones(userId, before, after),
      notifyProgressMilestones(userId, before, after),
    ]);

    expect(await listAll(userId)).toHaveLength(1);
  });

  it("never backfills milestones a counter was already past", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones } = await import(
      "@/server/services/notificationService"
    );

    // An existing player with 40 workouts completes their 41st.
    await notifyProgressMilestones(
      userId,
      stats({ userId, totalWorkoutsCompleted: 40 }),
      stats({ userId, totalWorkoutsCompleted: 41 }),
    );

    expect(await listAll(userId)).toHaveLength(0);
  });

  it("raises every threshold inside one jump", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones } = await import(
      "@/server/services/notificationService"
    );

    await notifyProgressMilestones(
      userId,
      stats({ userId, totalWorkoutsCompleted: 8 }),
      stats({ userId, totalWorkoutsCompleted: 26 }),
    );

    const keys = (await listAll(userId)).map((n) => n.dedupeKey).sort();
    expect(keys).toEqual([
      "progress_milestone:workouts:10",
      "progress_milestone:workouts:25",
    ]);
  });
});

describe("preferences gate emission", () => {
  it("raises nothing for a type the player switched off", async () => {
    const userId = new ObjectId();
    await insertProfile(userId, {
      notificationPreferences: { types: { progress_milestone: false } },
    });
    const { notifyProgressMilestones } = await import(
      "@/server/services/notificationService"
    );

    await notifyProgressMilestones(
      userId,
      stats({ userId, totalWorkoutsCompleted: 9 }),
      stats({ userId, totalWorkoutsCompleted: 10 }),
    );

    expect(await listAll(userId)).toHaveLength(0);
  });
});

describe("goal notifications", () => {
  it("announces a goal only on a genuine transition to completed", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyGoalsCompleted } = await import(
      "@/server/services/notificationService"
    );

    const goalId = new ObjectId();
    const goal = {
      _id: goalId,
      userId,
      type: "total_makes",
      title: "Make 500 shots",
      targetValue: 500,
      currentValue: 500,
      unit: "makes",
      status: "completed" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await notifyGoalsCompleted(userId, [goal]);
    // A second recalculation must not re-announce the same goal.
    await notifyGoalsCompleted(userId, [goal]);

    const all = await listAll(userId);
    expect(all).toHaveLength(1);
    expect(all[0].dedupeKey).toBe(`goal_update:${goalId.toString()}:completed`);
    expect(all[0].href).toBe("/progress");
  });

  it("does nothing for an empty list", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyGoalsCompleted } = await import(
      "@/server/services/notificationService"
    );

    await notifyGoalsCompleted(userId, []);
    expect(await listAll(userId)).toHaveLength(0);
  });
});

describe("scheduled evaluation", () => {
  it("stays silent for a brand-new account", async () => {
    // The Bug Feed-1 guard: a player with no records gets no fabricated nudge.
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );

    await evaluateScheduledNotifications(userId, {
      stats: null,
      hasActivity: false,
    });

    expect(await listAll(userId)).toHaveLength(0);
  });

  it("sets the content watermark on first run without announcing anything", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );
    const { findProfileByUserId } = await import(
      "@/server/repositories/playerProfileRepository"
    );

    await evaluateScheduledNotifications(userId, {
      stats: null,
      hasActivity: false,
    });

    // Nobody is told the entire seeded library is new.
    expect(await listAll(userId)).toHaveLength(0);
    expect(
      (await findProfileByUserId(userId))?.notificationsContentSeenAt,
    ).toBeInstanceOf(Date);
  });

  it("does not step over content added later the same day", async () => {
    // Regression: the watermark used to advance whenever a draft was built,
    // including when the day-keyed dedupe then dropped it. Anything added
    // between two Home views on the same day fell behind the watermark and was
    // never announced at all.
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );
    const { findProfileByUserId } = await import(
      "@/server/repositories/playerProfileRepository"
    );
    const { drillsCollection } = await import("@/server/db/collections");
    const drills = await drillsCollection();

    const signals = { stats: null, hasActivity: false };

    // First view: sets the watermark, announces nothing.
    await evaluateScheduledNotifications(userId, signals);
    const firstWatermark = (await findProfileByUserId(userId))
      ?.notificationsContentSeenAt;
    expect(firstWatermark).toBeInstanceOf(Date);

    const insertDrill = async (slug: string) => {
      await drills.insertOne({
        _id: new ObjectId(),
        slug,
        name: slug,
        description: "x",
        skillTags: ["shooting"],
        difficulty: "beginner",
        coachingCues: [],
        equipmentNeeded: [],
        createdAt: new Date(),
      } as never);
    };

    await insertDrill(`nc-a-${userId.toString()}`);
    await evaluateScheduledNotifications(userId, signals);
    expect(
      (await listAll(userId)).filter((n) => n.type === "new_content"),
    ).toHaveLength(1);

    const afterAnnounce = (await findProfileByUserId(userId))
      ?.notificationsContentSeenAt;
    expect(afterAnnounce!.getTime()).toBeGreaterThan(firstWatermark!.getTime());

    // A second drill the same day: deduped away, so the watermark must hold
    // and the drill must still be pending an announcement tomorrow.
    await insertDrill(`nc-b-${userId.toString()}`);
    await evaluateScheduledNotifications(userId, signals);

    const held = (await findProfileByUserId(userId))?.notificationsContentSeenAt;
    expect(held!.getTime()).toBe(afterAnnounce!.getTime());

    await drills.deleteMany({ slug: { $regex: `^nc-[ab]-${userId.toString()}$` } });
  });

  it("raises a streak reminder only on the at-risk day", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );

    const now = new Date(2026, 2, 10, 18, 0);
    const yesterday = new Date(2026, 2, 9, 20, 0);

    await evaluateScheduledNotifications(
      userId,
      {
        stats: stats({
          userId,
          currentStreak: 4,
          longestStreak: 4,
          lastActivityDate: yesterday,
        }),
        hasActivity: true,
      },
      now,
    );

    const streakNotifications = (await listAll(userId)).filter(
      (n) => n.type === "streak_reminder",
    );
    expect(streakNotifications).toHaveLength(1);
    expect(streakNotifications[0].body).toContain("4 days in a row");
  });

  it("does not quote a stale streak that has already lapsed", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );

    const now = new Date(2026, 2, 10, 18, 0);
    // currentStreak still reads 7 because it decays lazily - the exact lie the
    // streakStatus check exists to prevent.
    await evaluateScheduledNotifications(
      userId,
      {
        stats: stats({
          userId,
          currentStreak: 7,
          longestStreak: 7,
          lastActivityDate: new Date(2026, 2, 1, 20, 0),
        }),
        hasActivity: true,
      },
      now,
    );

    expect(
      (await listAll(userId)).filter((n) => n.type === "streak_reminder"),
    ).toHaveLength(0);
  });

  it("raises at most one streak reminder per day", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );

    const now = new Date(2026, 2, 10, 18, 0);
    const signals = {
      stats: stats({
        userId,
        currentStreak: 4,
        longestStreak: 4,
        lastActivityDate: new Date(2026, 2, 9, 20, 0),
      }),
      hasActivity: true,
    };

    // Home rendering three times in a day must not nag three times.
    await evaluateScheduledNotifications(userId, signals, now);
    await evaluateScheduledNotifications(userId, signals, now);
    await evaluateScheduledNotifications(userId, signals, now);

    expect(
      (await listAll(userId)).filter((n) => n.type === "streak_reminder"),
    ).toHaveLength(1);
  });

  it("raises nothing at all during quiet hours", async () => {
    const userId = new ObjectId();
    await insertProfile(userId, {
      notificationPreferences: {
        quietHours: { startHour: 22, endHour: 7 },
        timeZone: "UTC",
      },
    });
    const { evaluateScheduledNotifications } = await import(
      "@/server/services/notificationService"
    );

    await evaluateScheduledNotifications(
      userId,
      {
        stats: stats({
          userId,
          currentStreak: 4,
          longestStreak: 4,
          lastActivityDate: new Date(2026, 2, 9, 20, 0),
        }),
        hasActivity: true,
      },
      new Date("2026-03-10T02:00:00Z"),
    );

    expect(await listAll(userId)).toHaveLength(0);
  });
});

describe("read state", () => {
  it("counts, marks one, and marks all", async () => {
    const userId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones, countUnreadNotifications, markNotificationRead, markAllNotificationsRead } =
      await import("@/server/services/notificationService");

    await notifyProgressMilestones(
      userId,
      stats({ userId, totalWorkoutsCompleted: 8 }),
      stats({ userId, totalWorkoutsCompleted: 26 }),
    );

    expect(await countUnreadNotifications(userId)).toBe(2);

    const [first] = await listAll(userId);
    await markNotificationRead(userId, first._id);
    expect(await countUnreadNotifications(userId)).toBe(1);

    // Re-marking an already-read notification is a no-op, not an error - two
    // open tabs will do exactly this.
    await markNotificationRead(userId, first._id);
    expect(await countUnreadNotifications(userId)).toBe(1);

    await markAllNotificationsRead(userId);
    expect(await countUnreadNotifications(userId)).toBe(0);
  });

  it("scopes every read-state write to the owner", async () => {
    const userId = new ObjectId();
    const intruderId = new ObjectId();
    await insertProfile(userId);
    const { notifyProgressMilestones, countUnreadNotifications, markNotificationRead } =
      await import("@/server/services/notificationService");

    await notifyProgressMilestones(
      userId,
      stats({ userId, totalWorkoutsCompleted: 9 }),
      stats({ userId, totalWorkoutsCompleted: 10 }),
    );
    const [mine] = await listAll(userId);

    await markNotificationRead(intruderId, mine._id);
    expect(await countUnreadNotifications(userId)).toBe(1);
  });
});
