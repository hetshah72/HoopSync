import "server-only";
import type { ObjectId } from "mongodb";
import {
  findProfileByUserId,
  upsertProfile,
  type ProfileWrite,
} from "@/server/repositories/playerProfileRepository";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import type { NotificationPreferencesInput } from "@/lib/validation/notifications";
import type { PlayerProfileDoc } from "@/types/db";
import {
  calculateAge,
  requiresParentalConsent,
  resolveProfileAge,
} from "@/lib/age";
import { NotFoundError, ValidationError } from "@/server/errors";
import { storeAvatarImage } from "@/server/services/avatarStorageService";
import type { AvatarImageType } from "@/lib/avatar-image";

export async function getProfileByUserId(
  userId: ObjectId,
): Promise<PlayerProfileDoc | null> {
  return findProfileByUserId(userId);
}

export function isOnboardingComplete(
  profile: PlayerProfileDoc | null,
): profile is PlayerProfileDoc {
  return Boolean(profile?.onboardingCompletedAt);
}

/**
 * Re-exported so callers already reaching for the profile service don't need
 * a second import. The implementation lives in `@/lib/age` so pure consumers
 * (the Coach prompt builder) can use it without pulling in the DB client.
 */
export function resolveAge(profile: PlayerProfileDoc | null): number | undefined {
  return resolveProfileAge(profile);
}

/** Onboarding answers -> the profile fields they map onto. */
function profileWriteFromInput(
  input: OnboardingInput,
  consent: PlayerProfileDoc["consent"],
): ProfileWrite {
  return {
    displayName: input.displayName,
    age: calculateAge(input.dateOfBirth),
    heightInches: input.heightInches,
    weightLbs: input.weightLbs,
    educationLevel: input.educationLevel,
    expectedGraduationYear: input.expectedGraduationYear,
    position: input.position,
    competitiveLevel: input.competitiveLevel,
    onTeam: input.onTeam,
    // `undefined` here is an explicit clear - the repository turns it into
    // a `$unset` rather than writing BSON null.
    teamName: input.onTeam ? input.teamName : undefined,
    teamLevel: input.onTeam ? input.teamLevel : undefined,
    roleOnTeam: input.onTeam ? input.roleOnTeam : undefined,
    primaryGoal: input.primaryGoal,
    focusAreas: input.focusAreas,
    gamesPerWeek: input.gamesPerWeek,
    practiceFrequencyPerWeek: input.practiceFrequencyPerWeek,
    equipment: input.equipment,
    coachPersonality: input.coachPersonality,
    consent,
  };
}

/**
 * Derives the consent block from the submitted DOB and enforces it.
 *
 * `parentalConsentRequired` is derived here - never trusted from the
 * client - so it can't be bypassed by sending a falsified flag. When
 * consent is required it is also *enforced*: the write fails rather than
 * succeeding with `parentalConsentGiven: false`, which would otherwise let
 * an under-13 account through while recording that no consent was given.
 * This is the COPPA mechanism only (BRD A7): it gates and records, it does
 * not constitute legal compliance.
 *
 * `alreadyGiven` carries consent forward across a profile edit, so a player
 * whose guardian already consented isn't asked again every time they change
 * their height.
 */
function resolveConsent(
  input: OnboardingInput,
  existing: PlayerProfileDoc | null,
): PlayerProfileDoc["consent"] {
  const parentalConsentRequired = requiresParentalConsent(input.dateOfBirth);
  const alreadyGiven = Boolean(existing?.consent?.parentalConsentGiven);
  const given = input.parentalConsentGiven || alreadyGiven;

  if (parentalConsentRequired && !given) {
    throw new ValidationError(
      "A parent or guardian needs to give consent before you can finish setting up your account.",
    );
  }

  return {
    dateOfBirth: input.dateOfBirth,
    parentalConsentRequired,
    parentalConsentGiven: parentalConsentRequired ? given : false,
  };
}

/** Persists onboarding answers as a completed player profile. */
export async function completeOnboarding(
  userId: ObjectId,
  input: OnboardingInput,
): Promise<PlayerProfileDoc> {
  const existing = await findProfileByUserId(userId);
  return upsertProfile(userId, {
    ...profileWriteFromInput(input, resolveConsent(input, existing)),
    onboardingCompletedAt: existing?.onboardingCompletedAt ?? new Date(),
  });
}

/**
 * Applies an edit from the profile screen (BRD 7.1: "Persist profile data
 * so it can be edited later").
 *
 * Deliberately does *not* write `onboardingCompletedAt`: the repository
 * leaves absent keys untouched, so an edit can never un-complete
 * onboarding and bounce the player back into the wizard mid-save.
 */
export async function updateProfile(
  userId: ObjectId,
  input: OnboardingInput,
): Promise<PlayerProfileDoc> {
  const existing = await findProfileByUserId(userId);
  if (!isOnboardingComplete(existing)) {
    throw new ValidationError("Finish onboarding before editing your profile.");
  }
  return upsertProfile(
    userId,
    profileWriteFromInput(input, resolveConsent(input, existing)),
  );
}

/**
 * Saves notification preferences (BRD 7.15).
 *
 * Separate from `updateProfile` for the same reason `setAvatar` is: these are
 * toggles that save on their own, and routing them through the onboarding
 * schema would let an unrelated answer being momentarily invalid stop someone
 * turning a notification off. Silencing a notification is exactly the kind of
 * thing that must never fail for an unrelated reason.
 *
 * Writes the whole `notificationPreferences` object rather than merging, so a
 * type switched back on is genuinely removed from the map. `notificationsContentSeenAt`
 * lives outside this object and is therefore untouched - which is why it lives
 * outside it.
 */
export async function updateNotificationPreferences(
  userId: ObjectId,
  input: NotificationPreferencesInput,
): Promise<PlayerProfileDoc> {
  const existing = await findProfileByUserId(userId);
  if (!existing) {
    throw new NotFoundError("We couldn't find your profile.");
  }

  return upsertProfile(userId, {
    notificationPreferences: {
      ...(input.types ? { types: input.types } : {}),
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
  });
}

/**
 * Stores an uploaded profile photo and points the profile at it.
 *
 * Separate from `updateProfile` on purpose: the photo is picked and applied
 * on its own, with no Save step, so routing it through the onboarding schema
 * would mean an avatar change could be rejected by an unrelated answer being
 * momentarily invalid - and would make an in-progress form edit either get
 * saved early or silently discarded.
 *
 * `contentType` is the sniffed image type, not the client's declared one -
 * see `sniffAvatarImageType`.
 */
export async function setAvatar(
  userId: ObjectId,
  buffer: Buffer,
  contentType: AvatarImageType,
): Promise<PlayerProfileDoc> {
  const existing = await findProfileByUserId(userId);
  if (!existing) {
    throw new NotFoundError("We couldn't find your profile.");
  }

  // Storage first: a failed upload must leave the existing photo in place
  // rather than clearing it and leaving the profile pointing nowhere.
  const asset = await storeAvatarImage(userId.toString(), buffer, contentType);
  return upsertProfile(userId, { avatarUrl: asset.url });
}

/**
 * Drops the uploaded photo, falling the UI back to the identity provider's
 * image and then to the player's initial.
 *
 * `undefined` is an explicit `$unset` in the repository, so the field is
 * removed rather than written as BSON null.
 */
export async function clearAvatar(
  userId: ObjectId,
): Promise<PlayerProfileDoc> {
  const existing = await findProfileByUserId(userId);
  if (!existing) {
    throw new NotFoundError("We couldn't find your profile.");
  }
  return upsertProfile(userId, { avatarUrl: undefined });
}
