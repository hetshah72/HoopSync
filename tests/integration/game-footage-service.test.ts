import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

let mongod: MongoMemoryServer;

// Storing the upload is not what's under test here, and writing real files
// from a test would litter public/uploads.
vi.mock("@/server/services/videoStorageService", () => ({
  storeGameFootageVideo: vi.fn(async () => ({
    _id: new ObjectId(),
    url: "/uploads/game-footage/test.mp4",
    type: "video",
    source: "original",
    createdAt: new Date(),
  })),
}));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

beforeEach(async () => {
  const { drillsCollection } = await import("@/server/db/collections");
  await (await drillsCollection()).deleteMany({});
});

async function seedProfile(userId: ObjectId, focusAreas: string[] = ["defense"]) {
  const { playerProfilesCollection } = await import("@/server/db/collections");
  await (
    await playerProfilesCollection()
  ).insertOne({
    userId,
    focusAreas,
    equipment: ["ball", "hoop", "cones"],
    competitiveLevel: "high_school",
    position: "Point Guard",
    coachPersonality: "balanced",
    consent: { parentalConsentRequired: false, parentalConsentGiven: false },
    onboardingCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

/** One drill per skill, so a workout can be built for any weakness. */
async function seedDrillsForEverySkill() {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  const skills = [
    "shooting",
    "ball_handling",
    "finishing",
    "defense",
    "footwork",
    "playmaking",
    "athletic_development",
  ];
  await collection.insertMany(
    skills.map((skill) => ({
      slug: `gf-${skill}`,
      name: `Drill for ${skill}`,
      description: "d",
      skillTags: [skill],
      difficulty: "beginner",
      coachingCues: [],
      equipmentNeeded: [],
      createdAt: new Date(),
    })) as never,
  );
}

const VIDEO = Buffer.from("fake-video-bytes");

/**
 * Upload, then analyse - the two halves the route runs either side of its
 * response. With no frames and no API key these tests exercise the heuristic
 * fallback, which is the path that has to stay honest.
 */
async function analyzeUpload(userId: ObjectId) {
  const { startGameFootageAnalysis, runGameFootageAnalysis } = await import(
    "@/server/services/gameFootageService"
  );
  const started = await startGameFootageAnalysis(userId, VIDEO, "video/mp4");
  const completed = await runGameFootageAnalysis(userId, started._id, []);
  if (!completed) throw new Error("The analysis disappeared mid-test.");
  return completed;
}

describe("gameFootageService: upload -> analyse (BRD 7.7)", () => {
  it("returns a finished review, not just a processing confirmation", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);

    expect(analysis.status).toBe("completed");
    expect(analysis.strengths.length).toBeGreaterThan(0);
    expect(analysis.weaknesses.length).toBeGreaterThan(0);
    expect(analysis.weaknesses.every((w) => w.recommendation)).toBe(true);
  });

  it("records that a fallback review was heuristic, not a read of the footage", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);

    // BRD v1.1 §5: generated analysis must never be presentable as measured.
    // With no frames and no API key this is the only honest answer.
    expect(analysis.provenance).toBe("heuristic");
    expect(analysis.framesAnalyzed).toBeUndefined();
    expect(analysis.basis).toBeTruthy();
  });

  it("stores no fabricated per-event timestamps", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);

    // Inventing "at 4:12 you turned it over" would be presenting invented data
    // as something observed in the footage.
    expect(analysis.events).toEqual([]);
  });

  it("turns each weakness into a real, startable workout", async () => {
    const { getWorkoutForUser } = await import(
      "@/server/services/workoutService"
    );
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);

    // BRD v1.1 §7: "Game Weakness -> Recommended Workout" must be real and
    // traversable, not narrative.
    expect(analysis.recommendedWorkoutIds.length).toBeGreaterThan(0);

    const workout = await getWorkoutForUser(
      userId,
      analysis.recommendedWorkoutIds[0],
    );
    expect(workout).not.toBeNull();
    expect(workout!.source.type).toBe("game_analysis");
    expect(workout!.drills.length).toBeGreaterThan(0);
  });

  it("still completes when no workout can be built for a weakness", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    // No drills seeded at all - every workout build fails.

    const analysis = await analyzeUpload(userId);

    // The review itself is still useful without the workouts.
    expect(analysis.status).toBe("completed");
    expect(analysis.weaknesses.length).toBeGreaterThan(0);
    expect(analysis.recommendedWorkoutIds).toEqual([]);
  });

  it("keeps a training streak alive without inventing shooting stats", async () => {
    const { getStatsForUser } = await import("@/server/services/progressService");
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    await analyzeUpload(userId);
    const stats = await getStatsForUser(userId);

    expect(stats?.currentStreak).toBe(1);
    // Reviewing film is not shooting - these must stay untouched.
    expect(stats?.totalShotSessions).toBe(0);
    expect(stats?.totalShotAttempts).toBe(0);
  });

  it("scopes reads to the owner", async () => {
    const { getAnalysisForUser } = await import(
      "@/server/services/gameFootageService"
    );
    const owner = new ObjectId();
    await seedProfile(owner);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(owner);

    expect(await getAnalysisForUser(new ObjectId(), analysis._id)).toBeNull();
    expect(await getAnalysisForUser(owner, analysis._id)).not.toBeNull();
  });
});

describe("Game film -> Coach (BRD 7.8 / v1.1 §7)", () => {
  it("attaches the real analysis and opens with its actual findings", async () => {
    const { startConversationFromGameFilm, listMessages } = await import(
      "@/server/services/coachService",
    );

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);
    const conversationId = await startConversationFromGameFilm(
      userId,
      "balanced",
      analysis,
    );

    const messages = await listMessages(userId, conversationId);
    expect(messages.length).toBeGreaterThan(0);
    // BRD 7.8: never a generic greeting, and never overstating what this is.
    // With no frames this is the heuristic path, so the opener has to say so.
    expect(messages[0].content).toMatch(/game film/i);
    expect(messages[0].content).toMatch(/nothing in the video was analysed/i);
  });

  it("resumes the same conversation when the same review is shared twice", async () => {
    const { startConversationFromGameFilm, countConversationsForUser, listMessages } =
      await import("@/server/services/coachService");

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeUpload(userId);
    const first = await startConversationFromGameFilm(userId, "balanced", analysis);
    const second = await startConversationFromGameFilm(userId, "balanced", analysis);

    expect(second.toString()).toBe(first.toString());
    expect(await countConversationsForUser(userId)).toBe(1);
    expect(await listMessages(userId, first)).toHaveLength(1);
  });

  it("loads the analysis into the Coach prompt as heuristic context", async () => {
    const { loadContextBlocks } = await import(
      "@/server/services/coachContextService"
    );

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();
    const analysis = await analyzeUpload(userId);

    const blocks = await loadContextBlocks(userId, [
      { type: "game_footage_analysis", refId: analysis._id },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(/heuristic/i);
    expect(blocks[0]).toMatch(/never as something observed/i);
  });
});
