/**
 * Workout duration estimation from a drill's real prescription.
 *
 * Replaces the previous flat heuristics (6 minutes per drill in generation, a
 * hardcoded 15 for single-drill workouts), which meant the "~N min" shown to a
 * player was never derived from the drill they were actually about to do.
 *
 * Pure and isomorphic so it can be unit-tested directly and reused by
 * scripts/db/seed.ts without pulling in a server context.
 */
import type { WorkoutDrillSnapshot } from "@/types/db";

/** One rep including the reset/rebound between reps. */
const SECONDS_PER_REP = 4;
const REST_SECONDS_PER_SET = 45;
const TRANSITION_SECONDS_PER_DRILL = 60;
/** A drill carrying no sets/reps/duration metadata at all. */
const FALLBACK_DRILL_SECONDS = 300;
const MIN_WORKOUT_MINUTES = 5;

export interface DrillPrescription {
  sets?: number;
  reps?: number;
  durationSeconds?: number;
}

/**
 * Work time for one drill: every set's work, plus rest *between* sets (n-1
 * gaps, not n - there is no rest after the final set; the between-drill
 * transition covers that).
 */
export function estimateDrillSeconds(drill: DrillPrescription): number {
  const sets = drill.sets ?? 1;
  const workPerSet = drill.durationSeconds ?? (drill.reps ?? 0) * SECONDS_PER_REP;
  if (workPerSet <= 0) return FALLBACK_DRILL_SECONDS;
  return sets * workPerSet + Math.max(0, sets - 1) * REST_SECONDS_PER_SET;
}

/**
 * Whole-workout estimate, rounded to the nearest 5 minutes because a
 * to-the-minute estimate implies a precision this heuristic doesn't have.
 */
export function estimateWorkoutMinutes(drills: DrillPrescription[]): number {
  if (drills.length === 0) return 0;
  const totalSeconds =
    drills.reduce((sum, drill) => sum + estimateDrillSeconds(drill), 0) +
    drills.length * TRANSITION_SECONDS_PER_DRILL;
  const rounded = Math.round(totalSeconds / 60 / 5) * 5;
  return Math.max(MIN_WORKOUT_MINUTES, rounded);
}

/** Formats `sets x reps` / duration for display, showing both when both exist. */
export function formatPrescription(drill: DrillPrescription): string | null {
  const parts: string[] = [];
  if (drill.sets && drill.reps) {
    parts.push(`${drill.sets} sets x ${drill.reps} reps`);
  } else if (drill.reps) {
    parts.push(`${drill.reps} reps`);
  } else if (drill.sets) {
    parts.push(`${drill.sets} sets`);
  }
  if (drill.durationSeconds) {
    const label =
      drill.durationSeconds >= 60
        ? `${Math.round(drill.durationSeconds / 60)} min`
        : `${drill.durationSeconds}s`;
    parts.push(drill.sets && !drill.reps ? `${label} each` : label);
  }
  return parts.length > 0 ? parts.join(" - ") : null;
}

/** Total real time actually spent, for the completion summary. */
export function totalElapsedSeconds(
  drills: Pick<WorkoutDrillSnapshot, "elapsedSeconds">[],
): number {
  return drills.reduce((sum, drill) => sum + (drill.elapsedSeconds ?? 0), 0);
}

/** `95` -> `1:35`. Shared by the drill timer and completion summaries. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
