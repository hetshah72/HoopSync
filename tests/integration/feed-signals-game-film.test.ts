import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

vi.mock("@/server/external/openaiClient", () => ({
  isOpenAiConfigured: () => false,
  createChatCompletion: vi.fn(),
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
}, 120_000);

afterAll(async () => {
  await mongod.stop();
});

beforeEach(async () => {
  const { gameFootageAnalysesCollection } = await import(
    "@/server/db/collections"
  );
  await (await gameFootageAnalysesCollection()).deleteMany({});
});

async function seedAnalysis(userId: ObjectId, status: string) {
  const { gameFootageAnalysesCollection } = await import(
    "@/server/db/collections"
  );
  await (
    await gameFootageAnalysesCollection()
  ).insertOne({
    userId,
    videoAssetId: new ObjectId(),
    uploadedAt: new Date(),
    status,
    events: [],
    strengths: [],
    weaknesses: [],
    recommendedWorkoutIds: [],
    provenance: "heuristic",
  } as never);
}

const DAY = "2026-09-16";

/**
 * The bug this guards: `hasActivity` used to count workouts and shot sessions
 * only, so a player whose entire history was Game Film read as having done
 * nothing - and `feedGenerationService` bails out early on that, leaving them
 * a "get started" feed on the day they uploaded a game. CLAUDE.md's acceptance
 * bar requires the feed to reflect the new activity.
 */
describe("Feed signals: Game Film counts as activity", () => {
  it("counts a completed review and reports the player as active", async () => {
    const { loadFeedSignals } = await import(
      "@/server/services/feedSignalsService"
    );
    const userId = new ObjectId();
    await seedAnalysis(userId, "completed");

    const signals = await loadFeedSignals(userId, DAY);

    expect(signals.gameFilmReviews).toBe(1);
    expect(signals.hasActivity).toBe(true);
  });

  it("ignores reviews that never finished", async () => {
    const { loadFeedSignals } = await import(
      "@/server/services/feedSignalsService"
    );
    const userId = new ObjectId();
    await seedAnalysis(userId, "processing");
    await seedAnalysis(userId, "failed");

    const signals = await loadFeedSignals(userId, DAY);

    // Neither gave the player anything to review, so neither is activity.
    expect(signals.gameFilmReviews).toBe(0);
    expect(signals.hasActivity).toBe(false);
  });

  it("scopes the count to the player", async () => {
    const { loadFeedSignals } = await import(
      "@/server/services/feedSignalsService"
    );
    const mine = new ObjectId();
    await seedAnalysis(new ObjectId(), "completed");

    const signals = await loadFeedSignals(mine, DAY);

    expect(signals.gameFilmReviews).toBe(0);
  });

  it("moves the fingerprint when a review lands, so cards rebuild", async () => {
    const { loadFeedSignals } = await import(
      "@/server/services/feedSignalsService"
    );
    const userId = new ObjectId();

    const before = await loadFeedSignals(userId, DAY);
    await seedAnalysis(userId, "completed");
    const after = await loadFeedSignals(userId, DAY);

    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});
