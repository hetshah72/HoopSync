"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { ValidationError } from "@/server/errors";
import { recordShare, toggleInteraction } from "@/server/services/feedService";
import { getProfileByUserId } from "@/server/services/profileService";
import {
  addDrillToWorkoutWithStatus,
  startDrillAsWorkout,
} from "@/server/services/workoutService";
import { startConversationFromFeedItem } from "@/server/services/coachService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

export async function toggleFeedInteractionAction(
  feedItemId: string,
  action: "like" | "save",
): Promise<{ active: boolean }> {
  const userId = await requireUserId();
  const active = await toggleInteraction(
    new ObjectId(userId),
    parseId(feedItemId),
    action,
  );
  // Saving is the only interaction with a second surface to keep in sync.
  if (action === "save") {
    revalidatePath("/saved");
  }
  return { active };
}

export async function shareFeedItemAction(
  feedItemId: string,
): Promise<{ shareText: string }> {
  const userId = await requireUserId();
  const shareText = await recordShare(new ObjectId(userId), parseId(feedItemId));
  return { shareText };
}

// These intentionally return data rather than calling redirect(): a client
// component that awaits a Server Action inside try/catch (to show a toast on
// real failures) would otherwise catch redirect()'s internal throw and
// misreport a successful action as an error. The client navigates itself
// once the awaited call resolves successfully.
export async function askCoachAboutFeedItemAction(
  feedItemId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromFeedItem(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    parseId(feedItemId),
  );
  return { conversationId: conversationId.toString() };
}

/**
 * Returns the workout id so the client can land the player *in* the workout.
 * Previously this dropped them on the Train list, which read as the button
 * having done nothing (audit Bug Feed-2).
 */
export async function startDrillFromFeedItemAction(
  drillId: string,
): Promise<{ workoutId: string }> {
  const userId = await requireUserId();
  const workoutId = await startDrillAsWorkout(new ObjectId(userId), parseId(drillId));
  revalidatePath("/train");
  return { workoutId: workoutId.toString() };
}

export async function addDrillToWorkoutFromFeedItemAction(
  drillId: string,
): Promise<{ workoutId: string; alreadyIncluded: boolean }> {
  const userId = await requireUserId();
  // `alreadyIncluded` lets the client say "already in your workout" rather
  // than showing the same success toast for a no-op (audit FEED-08).
  const { workoutId, alreadyIncluded } = await addDrillToWorkoutWithStatus(
    new ObjectId(userId),
    parseId(drillId),
  );
  revalidatePath("/train");
  return { workoutId: workoutId.toString(), alreadyIncluded };
}
