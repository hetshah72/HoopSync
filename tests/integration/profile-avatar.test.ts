import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { OnboardingInput } from "@/lib/validation/onboarding";

/**
 * Storage is stubbed: what's under test is the profile side of a photo
 * upload - that the URL lands on the profile, that a later upload replaces
 * it, and that removing it `$unset`s the field rather than writing null.
 * Whether bytes reach GCS or the dev-only local directory is
 * mediaStorageService's business, and exercising it here would write files
 * into the repo.
 */
const storeAvatarImage = vi.fn();
vi.mock("@/server/services/avatarStorageService", () => ({
  storeAvatarImage: (...args: unknown[]) => storeAvatarImage(...args),
}));

/**
 * `src/server/db/client.ts` caches its client on the first connection, so
 * MONGODB_URI must point at the in-memory server before anything under test
 * opens one - hence the dynamic imports inside each test.
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
  dateOfBirth: new Date(Date.UTC(2008, 5, 15)),
  heightInches: 70,
  weightLbs: 150,
  educationLevel: "high_school",
  expectedGraduationYear: new Date().getFullYear() + 2,
  position: "Shooting Guard",
  competitiveLevel: "high_school",
  onTeam: false,
  primaryGoal: "Become a better all-around player",
  focusAreas: ["shooting"],
  gamesPerWeek: 2,
  practiceFrequencyPerWeek: 4,
  equipment: ["hoop", "ball"],
  coachPersonality: "balanced",
  parentalConsentGiven: false,
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("profileService avatar", () => {
  it("stores the photo and points the profile at the returned URL", async () => {
    const { completeOnboarding, setAvatar, getProfileByUserId } =
      await import("@/server/services/profileService");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);

    storeAvatarImage.mockResolvedValueOnce({ url: "/uploads/avatars/a.png" });
    const saved = await setAvatar(userId, PNG, "image/png");

    expect(storeAvatarImage).toHaveBeenCalledWith(
      userId.toString(),
      PNG,
      "image/png",
    );
    expect(saved.avatarUrl).toBe("/uploads/avatars/a.png");
    expect((await getProfileByUserId(userId))?.avatarUrl).toBe(
      "/uploads/avatars/a.png",
    );
  });

  it("replaces an existing photo and leaves the rest of the profile alone", async () => {
    const { completeOnboarding, setAvatar } =
      await import("@/server/services/profileService");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);

    storeAvatarImage.mockResolvedValueOnce({ url: "/uploads/avatars/one.png" });
    await setAvatar(userId, PNG, "image/png");
    storeAvatarImage.mockResolvedValueOnce({ url: "/uploads/avatars/two.png" });
    const second = await setAvatar(userId, PNG, "image/png");

    expect(second.avatarUrl).toBe("/uploads/avatars/two.png");
    // A photo change must not un-complete onboarding or disturb answers.
    expect(second.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(second.primaryGoal).toBe(baseInput.primaryGoal);
    expect(second.focusAreas).toEqual(baseInput.focusAreas);
  });

  /**
   * The field has to be *absent*, not BSON null: `PlayerProfileDoc.avatarUrl`
   * is optional-absent, and the UI's `profile.avatarUrl ?? session.user.image`
   * fallback only reaches the provider image when it really is missing.
   */
  it("removes the photo by unsetting the field", async () => {
    const { completeOnboarding, setAvatar, clearAvatar } =
      await import("@/server/services/profileService");
    const { playerProfilesCollection } =
      await import("@/server/db/collections");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);
    storeAvatarImage.mockResolvedValueOnce({ url: "/uploads/avatars/a.png" });
    await setAvatar(userId, PNG, "image/png");

    const cleared = await clearAvatar(userId);
    expect(cleared.avatarUrl).toBeUndefined();

    const collection = await playerProfilesCollection();
    const raw = await collection.findOne({ userId });
    expect(raw).not.toBeNull();
    expect(Object.hasOwn(raw!, "avatarUrl")).toBe(false);
  });

  it("refuses to write an avatar for a user with no profile", async () => {
    const { setAvatar, clearAvatar } =
      await import("@/server/services/profileService");

    const stranger = new ObjectId();
    await expect(setAvatar(stranger, PNG, "image/png")).rejects.toThrow(
      /couldn't find your profile/i,
    );
    await expect(clearAvatar(stranger)).rejects.toThrow(
      /couldn't find your profile/i,
    );
  });

  it("leaves the existing photo in place when storage fails", async () => {
    const { completeOnboarding, setAvatar, getProfileByUserId } =
      await import("@/server/services/profileService");

    const userId = new ObjectId();
    await completeOnboarding(userId, baseInput);
    storeAvatarImage.mockResolvedValueOnce({ url: "/uploads/avatars/a.png" });
    await setAvatar(userId, PNG, "image/png");

    storeAvatarImage.mockRejectedValueOnce(new Error("GCS is down"));
    await expect(setAvatar(userId, PNG, "image/png")).rejects.toThrow(
      "GCS is down",
    );

    expect((await getProfileByUserId(userId))?.avatarUrl).toBe(
      "/uploads/avatars/a.png",
    );
  });
});
