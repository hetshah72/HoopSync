"use server";

import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { coachPersonalitySchema } from "@/lib/validation/coach";
import { ValidationError } from "@/server/errors";
import {
  changePersonality,
  createConversation,
} from "@/server/services/coachService";
import { getProfileByUserId } from "@/server/services/profileService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

export async function createConversationAction(): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversation = await createConversation(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
  );
  return { conversationId: conversation._id.toString() };
}

export async function updateCoachPersonalityAction(
  conversationId: string,
  personality: string,
) {
  const userId = await requireUserId();
  const parsed = coachPersonalitySchema.safeParse(personality);
  if (!parsed.success) {
    throw new ValidationError("Invalid personality.");
  }
  await changePersonality(new ObjectId(userId), parseId(conversationId), parsed.data);
}
