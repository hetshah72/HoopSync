"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { ValidationError } from "@/server/errors";
import { preGameCheckinSchema } from "@/lib/validation/confidence";
import {
  createRecoveryCheckin,
  getCheckinForUser,
  recordPreGameCheckin,
} from "@/server/services/confidenceService";
import { getProfileByUserId } from "@/server/services/profileService";
import { startConversationFromConfidenceCheckin } from "@/server/services/coachService";
import { objectIdString } from "@/lib/validation/common";

export async function recordPreGameCheckinAction(
  feeling: string,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = preGameCheckinSchema.safeParse({ feeling });
  if (!parsed.success) {
    throw new ValidationError("Pick how you're feeling first.");
  }

  await recordPreGameCheckin(new ObjectId(userId), parsed.data.feeling);
  // Deliberately no refresh(): the routine on screen is rendered from the
  // local table, not from this write, and `initialFeeling` is only read on
  // first paint. Re-rendering the page on every chip tap would cost a server
  // round-trip for a card whose whole point is that it answers instantly.
}

export async function createRecoveryPlanAction(): Promise<void> {
  const userId = await requireUserId();
  await createRecoveryCheckin(new ObjectId(userId));
  refresh();
}

/**
 * "Talk to Coach" from a check-in (BRD 7.9 "provide confidence/mental-game
 * support (see 7.10)").
 *
 * Confidence and Coach were built with no link between them in either
 * direction, so the mental-game requirement in 7.9 had no path to Coach at all.
 * This is it.
 */
export async function talkToCoachAboutCheckinAction(
  checkinId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const parsed = objectIdString.safeParse(checkinId);
  if (!parsed.success) {
    throw new ValidationError("Invalid check-in id.");
  }

  const checkin = await getCheckinForUser(
    new ObjectId(userId),
    new ObjectId(parsed.data),
  );
  if (!checkin) {
    throw new ValidationError("Check-in not found.");
  }

  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromConfidenceCheckin(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    checkin,
  );
  return { conversationId: conversationId.toString() };
}
