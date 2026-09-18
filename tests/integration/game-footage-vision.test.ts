import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

let mongod: MongoMemoryServer;

vi.mock("@/server/services/videoStorageService", () => ({
  storeGameFootageVideo: vi.fn(async () => ({
    _id: new ObjectId(),
    url: "/uploads/game-footage/test.mp4",
    type: "video",
    source: "original",
    createdAt: new Date(),
  })),
}));

/**
 * Stands in for the vision API. `visionReply` is reassigned per test so one
 * mock covers a good read, an unusable clip, and a transport failure.
 */
let visionReply: () => Promise<string>;

vi.mock("@/server/external/openaiClient", () => ({
  isOpenAiConfigured: () => true,
  createVisionCompletion: vi.fn(() => visionReply()),
  createChatCompletion: vi.fn(async () => "unused"),
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
  visionReply = async () => GOOD_REPLY;
});

const FRAMES = [
  { base64: "aaa", timestampInVideoSeconds: 5 },
  { base64: "bbb", timestampInVideoSeconds: 15 },
];

const GOOD_REPLY = JSON.stringify({
  usable: true,
  subjectFound: true,
  events: [
    { type: "drive", timestampInVideoSeconds: 5, description: "Drove right off the catch." },
    // Deliberately a timestamp we never sent - it must not survive.
    { type: "turnover", timestampInVideoSeconds: 99, description: "Lost the handle." },
  ],
  strengths: [{ category: "drives", text: "Your first step beat the defender." }],
  weaknesses: [
    {
      category: "defensive_positioning",
      text: "You closed out flat on the wing.",
      recommendation: "Chop your last two steps.",
    },
  ],
});

async function seedProfile(userId: ObjectId) {
  const { playerProfilesCollection } = await import("@/server/db/collections");
  await (
    await playerProfilesCollection()
  ).insertOne({
    userId,
    focusAreas: ["defense"],
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

async function seedDrillsForEverySkill() {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  await collection.insertMany(
    [
      "shooting",
      "ball_handling",
      "finishing",
      "defense",
      "footwork",
      "playmaking",
    ].map((skill) => ({
      slug: `gfv-${skill}`,
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

async function analyzeWithFrames(
  userId: ObjectId,
  frames = FRAMES,
  subject?: { jerseyColor?: string; jerseyNumber?: string },
) {
  const { startGameFootageAnalysis, runGameFootageAnalysis } = await import(
    "@/server/services/gameFootageService"
  );
  const started = await startGameFootageAnalysis(
    userId,
    VIDEO,
    "video/mp4",
    subject,
  );
  const completed = await runGameFootageAnalysis(userId, started._id, frames);
  if (!completed) throw new Error("The analysis disappeared mid-test.");
  return completed;
}

describe("Game film: real vision analysis (BRD 7.7)", () => {
  it("records that the findings came from the footage, and how much of it", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId);

    expect(analysis.status).toBe("completed");
    expect(analysis.provenance).toBe("vision_model");
    expect(analysis.framesAnalyzed).toBe(2);
    expect(analysis.basis).toMatch(/2 frames/);
  });

  it("stores only events whose timestamps were actually sent", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId);

    // BRD 7.7 asks for real events; a hallucinated one is worse than none,
    // because the report renders it as a seekable point in the player's video.
    expect(analysis.events).toHaveLength(1);
    expect(analysis.events[0].timestampInVideoSeconds).toBe(5);
  });

  it("still turns a vision-read weakness into a startable workout", async () => {
    const { getWorkoutForUser } = await import("@/server/services/workoutService");
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId);

    expect(analysis.recommendedWorkoutIds.length).toBeGreaterThan(0);
    const workout = await getWorkoutForUser(
      userId,
      analysis.recommendedWorkoutIds[0],
    );
    expect(workout!.source.type).toBe("game_analysis");
  });

  it("records the subject the player named", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId, FRAMES, {
      jerseyColor: "red",
      jerseyNumber: "23",
    });

    expect(analysis.subject?.jerseyColor).toBe("red");
    expect(analysis.subject?.jerseyNumber).toBe("23");
  });

  it("falls back to the heuristic review, honestly labelled, when the clip is unusable", async () => {
    visionReply = async () =>
      JSON.stringify({ usable: false, unusableReason: "Too dark to read." });

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId);

    // The player still gets something useful - but it must not claim to be a
    // read of footage that was never successfully read.
    expect(analysis.status).toBe("completed");
    expect(analysis.provenance).toBe("heuristic");
    expect(analysis.events).toEqual([]);
    expect(analysis.weaknesses.length).toBeGreaterThan(0);
  });

  it("falls back rather than failing when the model call throws", async () => {
    visionReply = async () => {
      throw new Error("upstream exploded");
    };

    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId);

    expect(analysis.status).toBe("completed");
    expect(analysis.provenance).toBe("heuristic");
  });

  it("uses the heuristic path when the browser produced no frames", async () => {
    const userId = new ObjectId();
    await seedProfile(userId);
    await seedDrillsForEverySkill();

    const analysis = await analyzeWithFrames(userId, []);

    expect(analysis.provenance).toBe("heuristic");
    expect(analysis.framesAnalyzed).toBeUndefined();
  });
});
