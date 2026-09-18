"use server";

import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { updateProfile } from "@/server/services/profileService";
import { onboardingSchema, type OnboardingInput } from "@/lib/validation/onboarding";
import { ValidationError } from "@/server/errors";

/**
 * Saves an edit from the profile screen (BRD 7.1: "persist profile data so
 * it can be edited later and is available to every other module").
 *
 * Re-validates with the same schema onboarding uses, so the two can't drift
 * and a client bypassing the form gains nothing. Returns data rather than
 * redirecting, for the same reason `submitOnboarding` does: the caller
 * awaits this inside a try/catch, which would otherwise swallow
 * `redirect()`'s internal NEXT_REDIRECT throw and report a successful save
 * as a failure.
 */
export async function saveProfile(
  input: OnboardingInput,
): Promise<{ ok: true }> {
  const userId = await requireUserId("You must be signed in to edit your profile.");

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      "Please check your answers and try again.",
      parsed.error.flatten(),
    );
  }

  await updateProfile(new ObjectId(userId), parsed.data);
  return { ok: true };
}
