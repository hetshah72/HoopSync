"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { achievementLabels } from "@/lib/achievements";
import {
  generateWorkoutSchema,
  recordDrillElapsedSchema,
  setDrillCompletionSchema,
  setDrillSkippedSchema,
} from "@/lib/validation/workout";
import { AppError, ValidationError } from "@/server/errors";
import { generateWorkout } from "@/server/services/workoutGenerationService";
import { generateWorkoutFromPlayer } from "@/server/services/nbaPlayerService";
import {
  completeWorkout,
  getWorkoutForUser,
  recordDrillElapsed,
  setDrillCompletion,
  setDrillSkipped,
  startWorkout,
} from "@/server/services/workoutService";
import { getProfileByUserId } from "@/server/services/profileService";
import { startConversationFromWorkout } from "@/server/services/coachService";

/**
 * Generation returns a result union rather than throwing.
 *
 * The service's failures here are *actionable* ("no shooting drill works with
 * just a ball - add a hoop in your profile"), and Next.js redacts thrown
 * Server Action messages in production, which would turn every one of them
 * into an opaque 500. Matches the `{ ok: true }` convention already used by
 * onboardingActions. Genuinely unexpected errors are still thrown.
 */
export type GenerateWorkoutResult =
  | { ok: true; workoutId: string }
  | { ok: false; message: string };

export async function generateWorkoutAction(
  input: unknown,
): Promise<GenerateWorkoutResult> {
  const userId = await requireUserId();
  const parsed = generateWorkoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "That workout request isn't valid.",
    };
  }

  try {
    const workout =
      parsed.data.mode === "player"
        ? await generateWorkoutFromPlayer(
            new ObjectId(userId),
            new ObjectId(parsed.data.playerId),
          )
        : await generateWorkout(new ObjectId(userId), {
            targetSkills: parsed.data.targetSkills,
          });

    refresh();
    return { ok: true, workoutId: workout._id.toString() };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

export async function startWorkoutAction(workoutId: string): Promise<void> {
  const userId = await requireUserId();
  await startWorkout(new ObjectId(userId), parseId(workoutId));
}

export async function toggleDrillCompletionAction(
  workoutId: string,
  order: number,
  completed: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = setDrillCompletionSchema.safeParse({
    workoutId,
    order,
    completed,
  });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid drill update.",
    );
  }
  await setDrillCompletion(
    new ObjectId(userId),
    new ObjectId(parsed.data.workoutId),
    parsed.data.order,
    parsed.data.completed,
  );
}

/** BRD 7.3's "next/skip" - recorded, not just navigated past. */
export async function toggleDrillSkippedAction(
  workoutId: string,
  order: number,
  skipped: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = setDrillSkippedSchema.safeParse({ workoutId, order, skipped });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid drill update.",
    );
  }
  await setDrillSkipped(
    new ObjectId(userId),
    new ObjectId(parsed.data.workoutId),
    parsed.data.order,
    parsed.data.skipped,
  );
}

/**
 * Reports time spent on a drill as a delta. Called when the player leaves a
 * drill, pauses, or finishes - not on a timer tick.
 */
export async function recordDrillElapsedAction(
  workoutId: string,
  order: number,
  deltaSeconds: number,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = recordDrillElapsedSchema.safeParse({
    workoutId,
    order,
    deltaSeconds,
  });
  if (!parsed.success) {
    // Losing a few seconds of timing is never worth failing the player's
    // session over - the drill record itself is unaffected.
    return;
  }
  await recordDrillElapsed(
    new ObjectId(userId),
    new ObjectId(parsed.data.workoutId),
    parsed.data.order,
    parsed.data.deltaSeconds,
  );
}

/**
 * "Ask Coach" from a workout (BRD 7.9 "discuss and adjust workouts").
 *
 * The `workout` context ref type and `formatWorkoutContext` both already
 * existed, but no code path in the app ever created one - so the type was dead
 * and this BRD requirement had no way to be exercised. This is the entry point.
 */
export async function askCoachAboutWorkoutAction(
  workoutId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const workout = await getWorkoutForUser(new ObjectId(userId), parseId(workoutId));
  if (!workout) {
    throw new ValidationError("Workout not found.");
  }

  const profile = await getProfileByUserId(new ObjectId(userId));
  const conversationId = await startConversationFromWorkout(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    workout,
  );
  return { conversationId: conversationId.toString() };
}

export async function completeWorkoutAction(
  workoutId: string,
): Promise<{ completedGoalTitles: string[]; unlockedMilestones: string[] }> {
  const userId = await requireUserId();
  const { newlyCompletedGoals, newlyUnlockedAchievements } = await completeWorkout(
    new ObjectId(userId),
    parseId(workoutId),
  );
  // Progress/streak/skill metrics all move on completion (BRD 7.3), so the
  // Progress route's cached render is stale the moment this returns.
  refresh();
  // Titles/labels only - the wire format carries no ObjectId or Date.
  return {
    completedGoalTitles: newlyCompletedGoals.map((goal) => goal.title),
    unlockedMilestones: achievementLabels(newlyUnlockedAchievements),
  };
}
