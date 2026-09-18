import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

// No API key in tests, so the copy provider resolves to the deterministic
// template implementation - which is exactly the path that must work
// unaided. The AI rewriter's own guardrails are unit-tested separately.
vi.mock("@/server/external/openaiClient", () => ({
  isOpenAiConfigured: () => false,
  createChatCompletion: vi.fn(),
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";

  // Generation leans on unique partial indexes for its at-most-once
  // guarantees and integration tests don't otherwise create any, so the
  // idempotency assertions below would pass for the wrong reason without
  // these. Created directly rather than via scripts/db/init, because that
  // module pulls in scripts/db/lib/connection, which loads .env.local with
  // `override: true` and would replace this in-memory URI with the real one.
  const { feedItemsCollection, workoutsCollection } = await import(
    "@/server/db/collections"
  );
  await (await feedItemsCollection()).createIndex(
    { userId: 1, generatedForDate: 1, kind: 1 },
    { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
  );
  await (await workoutsCollection()).createIndex(
    { userId: 1, dayStamp: 1 },
    { unique: true, partialFilterExpression: { dayStamp: { $type: "string" } } },
  );
}, 120_000);

afterAll(async () => {
  await mongod.stop();
});

beforeEach(async () => {
  const { feedItemsCollection, workoutsCollection, drillsCollection } =
    await import("@/server/db/collections");
  await (await feedItemsCollection()).deleteMany({});
  await (await workoutsCollection()).deleteMany({});
  await (await drillsCollection()).deleteMany({});
});

async function seedProfile(userId: ObjectId, focusAreas = ["shooting"]) {
  const { playerProfilesCollection } = await import("@/server/db/collections");
  const collection = await playerProfilesCollection();
  await collection.insertOne({
    userId,
    focusAreas,
    equipment: [],
    coachPersonality: "balanced",
    consent: { parentalConsentRequired: false, parentalConsentGiven: false },
    onboardingCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

async function seedDrills() {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  await collection.insertMany([
    {
      _id: new ObjectId(),
      slug: "form-shooting-close-range",
      name: "Form Shooting",
      description: "Close-range form work.",
      skillTags: ["shooting"],
      difficulty: "beginner",
      coachingCues: ["Elbow under the ball"],
      equipmentNeeded: [],
      defaultSets: 3,
      defaultReps: 10,
      createdAt: new Date(),
    },
    {
      _id: new ObjectId(),
      slug: "handle-figure-eight",
      name: "Figure Eight",
      description: "Ball-handling warmup.",
      skillTags: ["ball_handling"],
      difficulty: "beginner",
      coachingCues: ["Stay low"],
      equipmentNeeded: [],
      defaultDurationSeconds: 60,
      createdAt: new Date(),
    },
  ] as never);
}

async function seedLibraryItems() {
  const { feedItemsCollection } = await import("@/server/db/collections");
  const collection = await feedItemsCollection();
  const shooting = await collection.insertOne({
    kind: "library",
    type: "tip",
    title: "Shooting tip",
    body: "body",
    tags: ["shooting"],
    createdAt: new Date(),
  } as never);
  const defense = await collection.insertOne({
    kind: "library",
    type: "tip",
    title: "Defense tip",
    body: "body",
    tags: ["defense"],
    createdAt: new Date(),
  } as never);
  const otherShooting = await collection.insertOne({
    kind: "library",
    type: "lesson",
    title: "Another shooting lesson",
    body: "body",
    tags: ["shooting", "mechanics"],
    createdAt: new Date(),
  } as never);
  return {
    shootingId: shooting.insertedId,
    defenseId: defense.insertedId,
    otherShootingId: otherShooting.insertedId,
  };
}

describe("feedService.getPersonalizedFeed", () => {
  it("ranks library items matching the player's focus areas above non-matching ones", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();
    const { shootingId, defenseId } = await seedLibraryItems();

    const feed = await getPersonalizedFeed(userId);
    const ids = feed.items.map((i) => i.id);

    expect(ids.indexOf(shootingId.toString())).toBeLessThan(
      ids.indexOf(defenseId.toString()),
    );
  });

  it("surfaces related items as real navigable links, not bare titles", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();
    const { shootingId, otherShootingId } = await seedLibraryItems();

    const feed = await getPersonalizedFeed(userId);
    const shootingItem = feed.items.find((i) => i.id === shootingId.toString());
    const otherItem = feed.items.find((i) => i.id === otherShootingId.toString());

    const link = shootingItem?.related.find((r) => r.label === otherItem?.title);
    expect(link).toBeDefined();
    expect(link?.href).toContain(otherShootingId.toString());
  });

  it("still renders when the player has no profile at all", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");
    await seedDrills();
    await seedLibraryItems();

    const feed = await getPersonalizedFeed(new ObjectId());
    expect(feed.items.length).toBeGreaterThan(0);
  });
});

describe("feedService generated cards", () => {
  it("generates today's workout exactly once, however many times Home is viewed", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");
    const { workoutsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();

    await getPersonalizedFeed(userId);
    await getPersonalizedFeed(userId);
    await getPersonalizedFeed(userId);

    const workouts = await (await workoutsCollection())
      .find({ userId, source: { $exists: true } })
      .toArray();
    const daily = workouts.filter((w) => w.source.type === "daily_feed");
    expect(daily).toHaveLength(1);
    expect(daily[0].dayStamp).toBeDefined();
  });

  it("does not duplicate generated cards across repeat views", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");
    const { feedItemsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();

    await getPersonalizedFeed(userId);
    const afterFirst = await (await feedItemsCollection()).countDocuments({ userId });
    await getPersonalizedFeed(userId);
    const afterSecond = await (await feedItemsCollection()).countDocuments({ userId });

    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
  });

  it("tells a brand-new player what to do instead of inventing a weakness", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();

    const feed = await getPersonalizedFeed(userId);

    expect(feed.items.some((i) => i.kind === "next_step")).toBe(true);
    // The account has no sessions, so nothing may claim to know their shooting.
    expect(feed.items.some((i) => i.kind === "weakness_callout")).toBe(false);
    expect(feed.items.some((i) => i.kind === "progress_update")).toBe(false);
    // And no card may cite a measured figure, because none exists.
    for (const item of feed.items) {
      expect(item.provenance?.facts ?? []).not.toContain(
        expect.stringContaining("%"),
      );
    }
  });

  it("names a weakness once there are enough real attempts, citing the true numbers", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");
    const { shotSessionsCollection, userStatsCollection } = await import(
      "@/server/db/collections"
    );

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();

    await (await shotSessionsCollection()).insertOne({
      _id: new ObjectId(),
      userId,
      videoAssetId: new ObjectId(),
      recordedAt: new Date(),
      status: "completed",
      shots: [],
      totalAttempts: 18,
      totalMakes: 8,
      fgPercent: 44.4,
      zoneBreakdown: {
        left_wing_3: { attempts: 9, makes: 2 },
        paint: { attempts: 9, makes: 6 },
      },
      bestZone: "paint",
      weakestZone: "left_wing_3",
      trendCallouts: [],
      createdAt: new Date(),
    } as never);
    await (await userStatsCollection()).insertOne({
      _id: new ObjectId(),
      userId,
      currentStreak: 1,
      longestStreak: 1,
      totalWorkoutsCompleted: 0,
      totalShotSessions: 1,
      totalShotAttempts: 18,
      totalShotMakes: 8,
      updatedAt: new Date(),
    } as never);

    const feed = await getPersonalizedFeed(userId);
    const weakness = feed.items.find((i) => i.kind === "weakness_callout");

    expect(weakness).toBeDefined();
    // 2/9 is 22.2% - the card must cite what was actually logged.
    expect(weakness!.provenance?.facts.join(" ")).toContain("2/9");
    expect(weakness!.provenance?.facts.join(" ")).toContain("Left Wing 3");
    expect(weakness!.relatedSessionId).toBeTruthy();
  });

  it("rebuilds activity-derived cards when new data lands, without waiting for tomorrow", async () => {
    const { getPersonalizedFeed } = await import("@/server/services/feedService");
    const { userStatsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrills();

    await (await userStatsCollection()).insertOne({
      _id: new ObjectId(),
      userId,
      currentStreak: 1,
      longestStreak: 1,
      totalWorkoutsCompleted: 1,
      totalShotSessions: 1,
      totalShotAttempts: 10,
      totalShotMakes: 4,
      updatedAt: new Date(),
    } as never);

    const before = await getPersonalizedFeed(userId);
    const progressBefore = before.items.find((i) => i.kind === "progress_update");
    expect(progressBefore?.body).toContain("1 workout");

    // Simulate finishing more workouts later the same day.
    await (await userStatsCollection()).updateOne(
      { userId },
      { $set: { totalWorkoutsCompleted: 7, currentStreak: 3 } },
    );

    const after = await getPersonalizedFeed(userId);
    const progressAfter = after.items.find((i) => i.kind === "progress_update");

    expect(progressAfter?.body).toContain("7 workouts");
    // Rebuilt in place, so a save or Coach conversation on it stays valid.
    expect(progressAfter?.id).toBe(progressBefore?.id);
  });
});

describe("feedService.toggleInteraction / recordShare / getSavedFeed", () => {
  it("toggles like on and back off", async () => {
    const { toggleInteraction } = await import("@/server/services/feedService");
    const userId = new ObjectId();
    const { shootingId } = await seedLibraryItems();

    expect(await toggleInteraction(userId, shootingId, "like")).toBe(true);
    expect(await toggleInteraction(userId, shootingId, "like")).toBe(false);
  });

  it("records a share at most once per user/item", async () => {
    const { recordShare } = await import("@/server/services/feedService");
    const { feedInteractionsCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();
    const { shootingId } = await seedLibraryItems();

    await recordShare(userId, shootingId);
    await recordShare(userId, shootingId);

    const count = await (await feedInteractionsCollection()).countDocuments({
      userId,
      feedItemId: shootingId,
      action: "share",
    });
    expect(count).toBe(1);
  });

  it("reads saved items back on the Saved screen", async () => {
    const { getSavedFeed, toggleInteraction } = await import(
      "@/server/services/feedService"
    );
    const userId = new ObjectId();
    const { shootingId } = await seedLibraryItems();

    expect(await getSavedFeed(userId)).toHaveLength(0);

    await toggleInteraction(userId, shootingId, "save");
    const saved = await getSavedFeed(userId);

    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(shootingId.toString());
    expect(saved[0].saved).toBe(true);
  });
});
