import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/**
 * Profiles are isolated by a fresh userId per test, but the drill library is
 * global - so without this, drills seeded by one test leak into the candidate
 * pool of every later one and assertions about *which* drills were selected
 * silently depend on test order.
 */
beforeEach(async () => {
  const { drillsCollection } = await import("@/server/db/collections");
  await (await drillsCollection()).deleteMany({});
});

async function seedProfile(
  userId: ObjectId,
  overrides: { equipment?: string[]; competitiveLevel?: string } = {},
) {
  const { playerProfilesCollection } = await import("@/server/db/collections");
  const collection = await playerProfilesCollection();
  await collection.insertOne({
    userId,
    focusAreas: ["shooting"],
    equipment: overrides.equipment ?? ["ball", "hoop"],
    competitiveLevel: overrides.competitiveLevel ?? "high_school",
    coachPersonality: "balanced",
    consent: { parentalConsentRequired: false, parentalConsentGiven: false },
    onboardingCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

async function seedDrill(overrides: {
  slug: string;
  skillTags: string[];
  equipmentNeeded: string[];
  difficulty?: string;
}) {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  const result = await collection.insertOne({
    slug: overrides.slug,
    name: overrides.slug,
    description: "d",
    skillTags: overrides.skillTags,
    difficulty: overrides.difficulty ?? "beginner",
    coachingCues: [],
    equipmentNeeded: overrides.equipmentNeeded,
    createdAt: new Date(),
  } as never);
  return result.insertedId;
}

describe("workoutGenerationService.generateWorkout", () => {
  it("excludes drills that require equipment the player doesn't have", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, { equipment: ["ball"] }); // no cones, no hoop

    await seedDrill({
      slug: "needs-cones",
      skillTags: ["shooting"],
      equipmentNeeded: ["ball", "cones"],
    });
    const okDrillId = await seedDrill({
      slug: "just-ball",
      skillTags: ["shooting"],
      equipmentNeeded: ["ball"],
    });

    const workout = await generateWorkout(userId, {
      targetSkills: ["shooting"],
      source: { type: "skill", label: "Test" },
    });

    expect(workout.drills.every((d) => d.drillId.equals(okDrillId))).toBe(true);
  });

  it("prioritizes drills that match the requested target skills", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, { equipment: ["ball", "hoop", "cones"] });

    const matchingId = await seedDrill({
      slug: "matches-defense",
      skillTags: ["defense"],
      equipmentNeeded: [],
    });
    await seedDrill({
      slug: "unrelated",
      skillTags: ["playmaking"],
      equipmentNeeded: [],
    });

    const workout = await generateWorkout(userId, {
      targetSkills: ["defense"],
      source: { type: "skill", label: "Test" },
    });

    expect(workout.drills[0].drillId.equals(matchingId)).toBe(true);
  });

  it("stamps difficulty from the drills actually selected, not the player's level", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, {
      equipment: ["ball"],
      competitiveLevel: "professional",
    });
    await seedDrill({
      slug: "difficulty-only-beginner",
      skillTags: ["shooting"],
      equipmentNeeded: [],
    });

    const workout = await generateWorkout(userId, { targetSkills: ["shooting"] });

    // A pro-level player whose only available drill is a beginner one has a
    // beginner workout. Stamping "advanced" here described the player, not the
    // session, and was the cosmetic-difficulty bug (audit Train-3).
    expect(workout.difficulty).toBe("beginner");
  });

  it("never selects a drill harder than a young player should be given", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, {
      equipment: ["ball"],
      competitiveLevel: "middle_school",
    });
    const safeId = await seedDrill({
      slug: "band-beginner",
      skillTags: ["defense"],
      equipmentNeeded: [],
      difficulty: "beginner",
    });
    await seedDrill({
      slug: "band-advanced",
      skillTags: ["defense"],
      equipmentNeeded: [],
      difficulty: "advanced",
    });

    const workout = await generateWorkout(userId, { targetSkills: ["defense"] });

    expect(workout.drills).toHaveLength(1);
    expect(workout.drills[0].drillId.equals(safeId)).toBe(true);
  });

  it("never pads a workout with drills that don't train a requested skill", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, { equipment: ["ball"] });

    await seedDrill({
      slug: "pad-playmaking-only",
      skillTags: ["playmaking"],
      equipmentNeeded: [],
    });
    // Four off-topic drills: the old engine took the top 4 regardless of
    // score, so these would have filled the workout under a playmaking title.
    for (const slug of ["pad-a", "pad-b", "pad-c", "pad-d"]) {
      await seedDrill({ slug, skillTags: ["shooting"], equipmentNeeded: [] });
    }

    const workout = await generateWorkout(userId, {
      targetSkills: ["playmaking"],
    });

    expect(workout.drills).toHaveLength(1);
    expect(
      workout.drills.every((d) => d.skillTags?.includes("playmaking")),
    ).toBe(true);
    expect(workout.skillCategory).toBe("playmaking");
  });

  it("rejects an empty target-skills list", async () => {
    const { generateWorkout } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId);

    await expect(
      generateWorkout(userId, { targetSkills: [], source: { type: "skill", label: "x" } }),
    ).rejects.toThrow();
  });
});

/**
 * BRD 7.1 FR2: "use the responses to generate an initial personalized
 * recommendation / starting plan", and the success criterion that onboarding
 * data "visibly drives at least one Home-screen recommendation immediately
 * afterward".
 */
describe("workoutGenerationService.generateStartingPlan", () => {
  // Every test in this file shares one in-memory database, so drills seeded
  // earlier would otherwise outrank the ones under test here.
  beforeEach(async () => {
    const { drillsCollection } = await import("@/server/db/collections");
    await (await drillsCollection()).deleteMany({});
  });

  it("builds a real workout from the player's own focus areas and equipment", async () => {
    const { generateStartingPlan } = await import(
      "@/server/services/workoutGenerationService"
    );
    const userId = new ObjectId();
    await seedProfile(userId, { equipment: ["ball"] });

    const onTopic = await seedDrill({
      slug: "starting-plan-shooting",
      skillTags: ["shooting"],
      equipmentNeeded: ["ball"],
    });
    await seedDrill({
      slug: "starting-plan-needs-hoop",
      skillTags: ["shooting"],
      equipmentNeeded: ["ball", "hoop"],
    });

    const plan = await generateStartingPlan(userId);

    expect(plan).not.toBeNull();
    expect(plan?.source.type).toBe("onboarding");
    expect(plan?.source.label).toBe("Your starting plan");
    expect(plan?.status).toBe("pending");
    expect(plan?.drills.length).toBeGreaterThan(0);
    // Equipment stays a hard filter even for the welcome workout.
    expect(plan?.drills.map((d) => d.drillId.toString())).toContain(
      onTopic.toString(),
    );
    expect(plan?.drills.map((d) => d.name)).not.toContain(
      "starting-plan-needs-hoop",
    );
  });

  it("is idempotent - a player only ever gets one starting plan", async () => {
    const { generateStartingPlan, getStartingPlan } = await import(
      "@/server/services/workoutGenerationService"
    );
    const { workoutsCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();
    await seedProfile(userId, { equipment: ["ball"] });
    await seedDrill({
      slug: "idempotent-shooting",
      skillTags: ["shooting"],
      equipmentNeeded: ["ball"],
    });

    const first = await generateStartingPlan(userId);
    const second = await generateStartingPlan(userId);

    expect(second?._id.toString()).toBe(first?._id.toString());

    const collection = await workoutsCollection();
    expect(
      await collection.countDocuments({ userId, "source.type": "onboarding" }),
    ).toBe(1);

    const fetched = await getStartingPlan(userId);
    expect(fetched?._id.toString()).toBe(first?._id.toString());
  });

  it("returns null rather than throwing when the player has no focus areas", async () => {
    const { generateStartingPlan } = await import(
      "@/server/services/workoutGenerationService"
    );
    const { playerProfilesCollection } = await import("@/server/db/collections");
    const userId = new ObjectId();
    const collection = await playerProfilesCollection();
    await collection.insertOne({
      userId,
      focusAreas: [],
      equipment: [],
      coachPersonality: "balanced",
      consent: { parentalConsentRequired: false, parentalConsentGiven: false },
      onboardingCompletedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(generateStartingPlan(userId)).resolves.toBeNull();
  });
});
