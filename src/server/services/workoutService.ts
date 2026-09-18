import "server-only";
import type { ObjectId } from "mongodb";
import {
  addDrillElapsedSeconds as addDrillElapsedSecondsRepo,
  appendDrillToWorkout as appendDrillRepo,
  createWorkout,
  findPendingSingleDrillWorkout,
  findPendingWorkoutForUser,
  findWorkoutByIdForUser,
  listWorkoutsForUser as listWorkoutsRepo,
  setDrillCompletion as setDrillCompletionRepo,
  setDrillSkipped as setDrillSkippedRepo,
  setWorkoutStatus,
} from "@/server/repositories/workoutRepository";
import { findDrillById } from "@/server/repositories/drillRepository";
import { recordWorkoutCompletion } from "@/server/services/progressService";
import {
  estimateWorkoutMinutes,
  totalElapsedSeconds,
} from "@/lib/workout-duration";
import { recalculateGoalsForUser } from "@/server/services/goalService";
import { recordNewlyUnlockedAchievements } from "@/server/services/achievementService";
import { NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type {
  AchievementDoc,
  DrillDoc,
  GoalDoc,
  WorkoutDoc,
  WorkoutDrillSnapshot,
  WorkoutSourceType,
} from "@/types/db";

export interface WorkoutSource {
  type: WorkoutSourceType;
  refId?: ObjectId;
  label: string;
}

/** Shared by every workout-creation path (Feed, Player, Train generation). */
export function drillToSnapshot(drill: DrillDoc, order: number): WorkoutDrillSnapshot {
  return {
    drillId: drill._id,
    order,
    name: drill.name,
    description: drill.description,
    videoUrl: drill.videoUrl,
    // Carried so the Active Workout screen can disclose what it is playing,
    // and so `content:audit` can trace a completed workout's footage back to
    // a provenance row (BRD 7.14).
    videoAssetId: drill.videoAssetId,
    videoSource: drill.videoSource,
    coachingCues: drill.coachingCues,
    skillTags: drill.skillTags,
    difficulty: drill.difficulty,
    sets: drill.defaultSets,
    reps: drill.defaultReps,
    durationSeconds: drill.defaultDurationSeconds,
    completed: false,
  };
}

/**
 * Minimal workout creation backing Feed's "Start Drill" / "Add to Workout"
 * actions and NBA Player's Signature-Move action - wraps a single real
 * drill into a real, persisted workout. Train's rule-based multi-drill
 * generation (workoutGenerationService) creates workouts directly via
 * `createWorkout` below with more than one drill; both write the exact
 * same WorkoutDoc shape - one collection, no parallel system.
 */
export async function startDrillAsWorkout(
  userId: ObjectId,
  drillId: ObjectId,
  source?: WorkoutSource,
): Promise<ObjectId> {
  const drill = await findDrillById(drillId);
  if (!drill) {
    throw new NotFoundError("Drill not found.");
  }

  // Tapping "Start Drill" again before doing the last one should take the
  // player back to that workout, not create another identical pending one
  // (audit Bug Feed-2: "3 duplicate pending workouts"). Scoped to
  // single-drill pending workouts so it can never absorb a real session the
  // player has already built up.
  const existing = await findPendingSingleDrillWorkout(userId, drillId);
  if (existing) {
    return existing._id;
  }

  const snapshot = drillToSnapshot(drill, 1);
  const workout = await createWorkout({
    userId,
    source: source ?? { type: "skill", label: `From your feed: ${drill.name}` },
    skillCategory: drill.skillTags[0],
    difficulty: drill.difficulty,
    // Derived from the drill's real prescription rather than a flat 15, so a
    // 45-second handle drill and a 5-set conditioning drill don't claim the
    // same length.
    estimatedDurationMinutes: estimateWorkoutMinutes([snapshot]),
    drills: [snapshot],
    status: "pending",
    createdAt: new Date(),
  });
  return workout._id;
}

export async function addDrillToWorkout(
  userId: ObjectId,
  drillId: ObjectId,
  source?: WorkoutSource,
): Promise<ObjectId> {
  const { workoutId } = await addDrillToWorkoutWithStatus(userId, drillId, source);
  return workoutId;
}

/**
 * As `addDrillToWorkout`, but reports whether the drill was already there.
 *
 * Callers that show a confirmation need to tell the two cases apart: adding
 * the same drill twice used to produce the identical success toast for what
 * was actually a no-op (audit FEED-08).
 */
export async function addDrillToWorkoutWithStatus(
  userId: ObjectId,
  drillId: ObjectId,
  source?: WorkoutSource,
): Promise<{ workoutId: ObjectId; alreadyIncluded: boolean }> {
  const drill = await findDrillById(drillId);
  if (!drill) {
    throw new NotFoundError("Drill not found.");
  }

  const pending = await findPendingWorkoutForUser(userId);
  if (!pending) {
    return {
      workoutId: await startDrillAsWorkout(userId, drillId, source),
      alreadyIncluded: false,
    };
  }

  if (pending.drills.some((d) => d.drillId.equals(drillId))) {
    return { workoutId: pending._id, alreadyIncluded: true };
  }

  const snapshot = drillToSnapshot(drill, pending.drills.length + 1);
  // Recompute the estimate in the same write. Appending without this left the
  // workout advertising its pre-append length forever (Bug Train-4).
  const updated = await appendDrillRepo(
    pending._id,
    snapshot,
    estimateWorkoutMinutes([...pending.drills, snapshot]),
  );
  return { workoutId: (updated ?? pending)._id, alreadyIncluded: false };
}

export async function listWorkoutsForUser(userId: ObjectId): Promise<WorkoutDoc[]> {
  return listWorkoutsRepo(userId);
}

export async function getWorkoutForUser(
  userId: ObjectId,
  workoutId: ObjectId,
): Promise<WorkoutDoc | null> {
  return findWorkoutByIdForUser(userId, workoutId);
}

export async function startWorkout(
  userId: ObjectId,
  workoutId: ObjectId,
): Promise<WorkoutDoc> {
  const workout = await findWorkoutByIdForUser(userId, workoutId);
  if (!workout) {
    throw new NotFoundError("Workout not found.");
  }
  if (workout.status === "pending") {
    const updated = await setWorkoutStatus(workoutId, "in_progress", {
      startedAt: new Date(),
    });
    return updated ?? workout;
  }
  return workout;
}

/**
 * A finished workout is a historical record, not a live document. Editing its
 * drills after the fact would desync it from the Progress/streak/skill numbers
 * already written from it at completion, so every per-drill mutation below
 * goes through this guard.
 */
async function requireEditableWorkout(
  userId: ObjectId,
  workoutId: ObjectId,
): Promise<WorkoutDoc> {
  const workout = await findWorkoutByIdForUser(userId, workoutId);
  if (!workout) {
    throw new NotFoundError("Workout not found.");
  }
  if (workout.status === "completed") {
    throw new ValidationError("This workout is already complete.");
  }
  return workout;
}

export async function setDrillCompletion(
  userId: ObjectId,
  workoutId: ObjectId,
  order: number,
  completed: boolean,
): Promise<WorkoutDoc> {
  await requireEditableWorkout(userId, workoutId);
  const updated = await setDrillCompletionRepo(workoutId, order, completed);
  if (!updated) {
    throw new ValidationError("That drill isn't part of this workout.");
  }
  return updated;
}

/**
 * The "skip" half of BRD 7.3's "next/skip" control. Recorded rather than
 * merely navigated past, so the completion summary and skill metrics can tell
 * "deliberately passed over" apart from "never reached".
 */
export async function setDrillSkipped(
  userId: ObjectId,
  workoutId: ObjectId,
  order: number,
  skipped: boolean,
): Promise<WorkoutDoc> {
  await requireEditableWorkout(userId, workoutId);
  const updated = await setDrillSkippedRepo(workoutId, order, skipped);
  if (!updated) {
    throw new ValidationError("That drill isn't part of this workout.");
  }
  return updated;
}

/**
 * Records real time spent on a drill. Called on drill change/pause/completion
 * rather than every tick - a per-second write would be one round-trip per
 * second per training player for no extra fidelity.
 */
export async function recordDrillElapsed(
  userId: ObjectId,
  workoutId: ObjectId,
  order: number,
  deltaSeconds: number,
): Promise<void> {
  if (deltaSeconds <= 0) return;
  await requireEditableWorkout(userId, workoutId);
  const updated = await addDrillElapsedSecondsRepo(workoutId, order, deltaSeconds);
  if (!updated) {
    throw new ValidationError("That drill isn't part of this workout.");
  }
}

export interface CompleteWorkoutResult {
  workout: WorkoutDoc;
  /**
   * Goals this completion pushed over the line (BRD 7.12). Returned rather
   * than swallowed so the caller can tell the player in the moment - a goal
   * that completes silently is indistinguishable from one that never moved.
   */
  newlyCompletedGoals: GoalDoc[];
  /**
   * Milestones this completion earned (BRD 7.13), for the same reason as
   * above. Only genuinely new ones - never a backfilled stamp - so the caller
   * can announce them without claiming the player just did something they
   * finished months ago. See achievementService.
   */
  newlyUnlockedAchievements: AchievementDoc[];
}

/**
 * Completing a workout is the Train -> Progress connection (BRD 7.3/7.11):
 * this is the one place that transition happens, so every path that
 * finishes a workout (however Train's UI evolves) updates Progress the
 * same way, with no manual re-entry.
 */
export async function completeWorkout(
  userId: ObjectId,
  workoutId: ObjectId,
): Promise<CompleteWorkoutResult> {
  const workout = await findWorkoutByIdForUser(userId, workoutId);
  if (!workout) {
    throw new NotFoundError("Workout not found.");
  }
  if (workout.status === "completed") {
    // Already counted - re-completing must not re-announce goals or milestones.
    return { workout, newlyCompletedGoals: [], newlyUnlockedAchievements: [] };
  }

  // Deliberately does NOT force every drill to `completed`. The player can
  // mark drills off individually (setDrillCompletion), and overwriting that
  // here destroyed the real record of what they actually did versus skipped
  // - which Progress and skill metrics need to be truthful.
  const updated = await setWorkoutStatus(workoutId, "completed", {
    completedAt: new Date(),
    actualDurationSeconds: totalElapsedSeconds(workout.drills),
  });
  // Pass the workout itself so Progress can credit the skills the player
  // actually trained, not just bump a global counter (BRD 7.3: "update
  // Progress, training history, streak, and the relevant skill metrics").
  await recordWorkoutCompletion(userId, updated ?? workout);

  // Train -> Goals (BRD 7.12): goals advance off real activity with no
  // manual check-in. Best-effort - a goal-tracking failure must never lose
  // the completed workout itself.
  let newlyCompletedGoals: GoalDoc[] = [];
  try {
    newlyCompletedGoals = await recalculateGoalsForUser(userId);
  } catch (err) {
    logger.error(
      { userId: userId.toString(), workoutId: workoutId.toString(), err },
      "Failed to recalculate goals after workout completion",
    );
  }

  // Train -> Achievements (BRD 7.13). Runs after the goal recalculation above,
  // because the "Goal Closed Out" milestone reads the status that call just
  // flipped. Best-effort for the same reason: unlock state is derived, so a
  // failure here loses only a date stamp, and the next completed workout or
  // session stamps it.
  let newlyUnlockedAchievements: AchievementDoc[] = [];
  try {
    newlyUnlockedAchievements = await recordNewlyUnlockedAchievements(userId);
  } catch (err) {
    logger.error(
      { userId: userId.toString(), workoutId: workoutId.toString(), err },
      "Failed to record achievements after workout completion",
    );
  }

  return {
    workout: updated ?? workout,
    newlyCompletedGoals,
    newlyUnlockedAchievements,
  };
}
