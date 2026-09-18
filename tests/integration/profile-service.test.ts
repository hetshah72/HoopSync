import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { calculateAge } from "@/lib/age";

/**
 * `src/server/db/client.ts` caches its client on the first connection, so
 * MONGODB_URI must point at the in-memory server *before* anything under test
 * opens one. Dynamic import() after the env var is set (rather than a static
 * top-of-file import) guarantees that ordering.
 */
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

const baseInput: OnboardingInput = {
  displayName: "Jordan",
  dateOfBirth: new Date(Date.UTC(2010, 5, 15)),
  heightInches: 70,
  weightLbs: 150,
  educationLevel: "high_school",
  expectedGraduationYear: new Date().getFullYear() + 2,
  position: "Shooting Guard",
  competitiveLevel: "high_school",
  onTeam: true,
  teamName: "Lincoln High Varsity",
  teamLevel: "Varsity",
  roleOnTeam: "Rotation player",
  primaryGoal: "Become a better all-around player",
  focusAreas: ["shooting", "ball_handling"],
  gamesPerWeek: 2,
  practiceFrequencyPerWeek: 4,
  equipment: ["hoop", "ball"],
  coachPersonality: "balanced",
  parentalConsentGiven: false,
};

describe("profileService.completeOnboarding + getProfileByUserId", () => {
  it("persists a profile and marks onboarding complete", async () => {
    const { completeOnboarding, getProfileByUserId, isOnboardingComplete } =
      await import("@/server/services/profileService");

    const userId = new ObjectId();
    const saved = await completeOnboarding(userId, baseInput);

    expect(saved.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(saved.age).toBe(calculateAge(baseInput.dateOfBirth));
    expect(saved.primaryGoal).toBe(baseInput.primaryGoal);
    expect(saved.consent.parentalConsentRequired).toBe(false);

    const fetched = await getProfileByUserId(userId);
    expect(isOnboardingComplete(fetched)).toBe(true);
    expect(fetched?.teamName).toBe("Lincoln High Varsity");
  });

  it("derives parentalConsentRequired from DOB server-side, ignoring any client-sent value", async () => {
    const { completeOnboarding } = await import("@/server/services/profileService");

    const userId = new ObjectId();
    const minorInput: OnboardingInput = {
      ...baseInput,
      dateOfBirth: new Date(new Date().getFullYear() - 10, 0, 1), // age 10
      parentalConsentGiven: true,
    };

    const saved = await completeOnboarding(userId, minorInput);
    expect(saved.consent.parentalConsentRequired).toBe(true);
    expect(saved.consent.parentalConsentGiven).toBe(true);
  });

  it("refuses to complete onboarding for an under-13 account without consent", async () => {
    const { completeOnboarding, getProfileByUserId } = await import(
      "@/server/services/profileService"
    );

    const userId = new ObjectId();
    const minorWithoutConsent: OnboardingInput = {
      ...baseInput,
      dateOfBirth: new Date(new Date().getFullYear() - 10, 0, 1), // age 10
      parentalConsentGiven: false,
    };

    await expect(completeOnboarding(userId, minorWithoutConsent)).rejects.toThrow();

    // The account must not exist in a half-created state afterwards.
    expect(await getProfileByUserId(userId)).toBeNull();
  });

  it("is safe to re-submit onboarding - upserts rather than duplicating", async () => {
    const { completeOnboarding, getProfileByUserId } = await import(
      "@/server/services/profileService"
    );
    const { playerProfilesCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);
    await completeOnboarding(userId, { ...baseInput, primaryGoal: "Updated goal" });

    const collection = await playerProfilesCollection();
    const count = await collection.countDocuments({ userId });
    expect(count).toBe(1);

    const fetched = await getProfileByUserId(userId);
    expect(fetched?.primaryGoal).toBe("Updated goal");
  });
});

/** BRD 7.1 FR3: "persist profile data so it can be edited later". */
describe("profileService.updateProfile", () => {
  it("saves an edit without un-completing onboarding", async () => {
    const { completeOnboarding, updateProfile, isOnboardingComplete } =
      await import("@/server/services/profileService");

    const userId = new ObjectId();
    const created = await completeOnboarding(userId, baseInput);

    const edited = await updateProfile(userId, {
      ...baseInput,
      primaryGoal: "Prepare for tryouts",
      focusAreas: ["defense"],
    });

    expect(edited.primaryGoal).toBe("Prepare for tryouts");
    expect(edited.focusAreas).toEqual(["defense"]);
    // The whole point: an edit must not strip the completion marker and
    // bounce the player back into the wizard.
    expect(isOnboardingComplete(edited)).toBe(true);
    expect(edited.onboardingCompletedAt?.getTime()).toBe(
      created.onboardingCompletedAt?.getTime(),
    );
  });

  it("refuses to edit a profile that never finished onboarding", async () => {
    const { updateProfile } = await import("@/server/services/profileService");
    await expect(updateProfile(new ObjectId(), baseInput)).rejects.toThrow();
  });

  /**
   * Audit "Low" bug: the driver is built without `ignoreUndefined`, so
   * `$set: { teamName: undefined }` wrote BSON null into a field typed as
   * optional-absent. Leaving a team must remove the fields, not null them.
   */
  it("clears team fields by unsetting them, never writing null", async () => {
    const { completeOnboarding, updateProfile } = await import(
      "@/server/services/profileService"
    );
    const { playerProfilesCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);
    await updateProfile(userId, { ...baseInput, onTeam: false });

    const collection = await playerProfilesCollection();
    const raw = await collection.findOne({ userId });

    expect(raw).not.toBeNull();
    for (const field of ["teamName", "teamLevel", "roleOnTeam"]) {
      expect(raw).not.toHaveProperty(field);
    }
  });

  it("carries existing parental consent forward instead of demanding it again", async () => {
    const { completeOnboarding, updateProfile } = await import(
      "@/server/services/profileService"
    );

    const userId = new ObjectId();
    const minor: OnboardingInput = {
      ...baseInput,
      dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1)),
      parentalConsentGiven: true,
    };
    await completeOnboarding(userId, minor);

    // A later edit doesn't re-send the consent toggle.
    const edited = await updateProfile(userId, {
      ...minor,
      parentalConsentGiven: false,
      weightLbs: 120,
    });

    expect(edited.weightLbs).toBe(120);
    expect(edited.consent.parentalConsentRequired).toBe(true);
    expect(edited.consent.parentalConsentGiven).toBe(true);
  });
});

describe("profileService.resolveAge", () => {
  it("derives the current age from the stored DOB, not the stale stored age", async () => {
    const { completeOnboarding, resolveAge, getProfileByUserId } = await import(
      "@/server/services/profileService"
    );
    const { playerProfilesCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);

    // Simulate a profile written years ago: the denormalised `age` is a
    // snapshot and is never recomputed.
    const collection = await playerProfilesCollection();
    await collection.updateOne({ userId }, { $set: { age: 11 } });

    const profile = await getProfileByUserId(userId);
    expect(profile?.age).toBe(11);
    expect(resolveAge(profile)).toBe(calculateAge(baseInput.dateOfBirth));
  });
});
