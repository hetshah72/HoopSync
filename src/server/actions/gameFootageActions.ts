"use server";

import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { ValidationError } from "@/server/errors";
import { getAnalysisForUser } from "@/server/services/gameFootageService";
import { getProfileByUserId } from "@/server/services/profileService";
import { startConversationFromGameFilm } from "@/server/services/coachService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

/**
 * Share With Coach from a Game Film report (BRD v1.1 §4: Coach is reached
 * *after* Analyze, optionally - never the route into it).
 */
export async function shareGameFilmWithCoachAction(
  analysisId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const analysis = await getAnalysisForUser(
    new ObjectId(userId),
    parseId(analysisId),
  );
  if (!analysis) {
    throw new ValidationError("Game film analysis not found.");
  }

  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromGameFilm(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    analysis,
  );
  return { conversationId: conversationId.toString() };
}
