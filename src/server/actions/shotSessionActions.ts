"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { achievementLabels } from "@/lib/achievements";
import { logShotSchema } from "@/lib/validation/shotSession";
import { ValidationError } from "@/server/errors";
import {
  addCorrectionDrillForShot,
  finalizeSession,
  getSessionForUser,
  logShot,
  removeShot,
} from "@/server/services/shotSessionService";
import { getProfileByUserId } from "@/server/services/profileService";
import {
  startConversationFromShot,
  startConversationFromShotSession,
} from "@/server/services/coachService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

export async function logShotAction(
  sessionId: string,
  input: {
    xPct: number;
    yPct: number;
    zone: string;
    made: boolean;
    timestampInVideoSeconds: number;
  },
) {
  const userId = await requireUserId();
  const parsed = logShotSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid shot data.", parsed.error.flatten());
  }

  const session = await logShot(new ObjectId(userId), parseId(sessionId), parsed.data);
  return {
    totalAttempts: session.totalAttempts,
    totalMakes: session.totalMakes,
    shots: session.shots.map((s) => ({ ...s, id: s.id })),
  };
}

export async function deleteShotAction(sessionId: string, shotId: string) {
  const userId = await requireUserId();
  await removeShot(new ObjectId(userId), parseId(sessionId), shotId);
}

export async function finalizeSessionAction(
  sessionId: string,
): Promise<{
  ok: true;
  completedGoalTitles: string[];
  unlockedMilestones: string[];
}> {
  const userId = await requireUserId();
  const { newlyCompletedGoals, newlyUnlockedAchievements } = await finalizeSession(
    new ObjectId(userId),
    parseId(sessionId),
  );
  // Shooting totals, streak, goals and session history all move on finalize
  // (BRD 7.11), so the Progress route's cached render is stale the moment
  // this returns - the same reason completeWorkoutAction refreshes.
  //
  // The client's own router.refresh() cannot cover this: it clears the client
  // cache for the *current* route, which is the session report, not /progress.
  refresh();

  // Titles/labels only - the wire format carries no ObjectId or Date.
  return {
    ok: true,
    completedGoalTitles: newlyCompletedGoals.map((goal) => goal.title),
    unlockedMilestones: achievementLabels(newlyUnlockedAchievements),
  };
}

export async function shareShotSessionWithCoachAction(
  sessionId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const session = await getSessionForUser(new ObjectId(userId), parseId(sessionId));
  if (!session) {
    throw new ValidationError("Session not found.");
  }
  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromShotSession(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    session,
  );
  return { conversationId: conversationId.toString() };
}

/** "Ask Coach about this shot" from the replay dialog (BRD 7.5). */
export async function askCoachAboutShotAction(
  sessionId: string,
  shotId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const session = await getSessionForUser(new ObjectId(userId), parseId(sessionId));
  if (!session) {
    throw new ValidationError("Session not found.");
  }
  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromShot(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    session,
    shotId,
  );
  return { conversationId: conversationId.toString() };
}

/**
 * "Add a correction drill to a workout" from the replay dialog (BRD 7.5).
 * Reuses the same drill the session's mechanical breakdown already points
 * at for that zone, so the fix the player is told about is the fix they add.
 */
export async function addCorrectionDrillToWorkoutAction(
  sessionId: string,
  shotId: string,
): Promise<{ workoutId: string; drillName: string }> {
  const userId = await requireUserId();
  const result = await addCorrectionDrillForShot(
    new ObjectId(userId),
    parseId(sessionId),
    shotId,
  );
  return {
    workoutId: result.workoutId.toString(),
    drillName: result.drillName,
  };
}
