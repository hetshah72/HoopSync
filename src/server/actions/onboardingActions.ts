"use server";

import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { completeOnboarding } from "@/server/services/profileService";
import { generateStartingPlan } from "@/server/services/workoutGenerationService";
import { logger } from "@/server/logger";
import { onboardingSchema, type OnboardingInput } from "@/lib/validation/onboarding";
import { ValidationError } from "@/server/errors";

// Returns data rather than calling redirect(): the wizard awaits this inside
// a try/catch (to toast real failures), which would otherwise catch
// redirect()'s internal NEXT_REDIRECT throw and report a successful signup as
// an error. Same reasoning as the feed actions - the client navigates itself
// once the awaited call resolves.
export async function submitOnboarding(
  input: OnboardingInput,
): Promise<{ ok: true }> {
  const userId = await requireUserId("You must be signed in to complete onboarding.");

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      "Please check your answers and try again.",
      parsed.error.flatten(),
    );
  }

  const id = new ObjectId(userId);
  await completeOnboarding(id, parsed.data);

  // The starting plan (BRD 7.1) is a nice-to-have on top of a completed
  // profile, never a precondition for one: if the drill library can't
  // satisfy this player's equipment, they should still land on Home with a
  // finished account rather than be stranded in the wizard by an error they
  // can't act on. Home falls back to the rest of the feed when it's absent.
  try {
    await generateStartingPlan(id);
  } catch (err) {
    logger.error(
      { err, userId },
      "Failed to generate the onboarding starting plan",
    );
  }

  return { ok: true };
}
