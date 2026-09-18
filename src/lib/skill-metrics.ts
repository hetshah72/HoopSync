/**
 * Per-skill training metrics (BRD 7.3 "update ... the relevant skill metrics",
 * BRD 7.11 "Skill development").
 *
 * Deliberately counts only *real, observed* activity - workouts completed and
 * drills the player actually marked done. There is no synthesized 0-100 "skill
 * rating" here: HoopSync has no way to measure skill, and a number that looks
 * measured but isn't would violate the project's rule against presenting
 * generated data as real.
 *
 * Pure and isomorphic, so the same function backs both the incremental write
 * on completion and the rebuild-from-workouts path that proves those counters
 * never drifted.
 */
import type { SkillCategory, WorkoutDoc, WorkoutDrillSnapshot } from "@/types/db";

export interface SkillMetric {
  /** Completed workouts that actually contained a completed drill for this skill. */
  workoutsCompleted: number;
  drillsCompleted: number;
  secondsTrained: number;
  lastTrainedAt?: Date;
}

export type SkillMetrics = Partial<Record<SkillCategory, SkillMetric>>;

/**
 * The skills a *single* workout genuinely trained: the union of skill tags on
 * the drills the player actually completed.
 *
 * Driven by completed drills rather than `workout.skillCategory` because that
 * field records what the workout was *aimed* at. A player who completes one
 * drill and skips three has not trained everything the title claims, and
 * crediting them for it would make Progress overstate their work.
 */
export function skillsTrainedInWorkout(
  drills: Pick<WorkoutDrillSnapshot, "completed" | "skillTags">[],
): SkillCategory[] {
  const skills = new Set<SkillCategory>();
  for (const drill of drills) {
    if (!drill.completed) continue;
    for (const tag of drill.skillTags ?? []) skills.add(tag);
  }
  return [...skills];
}

function emptyMetric(): SkillMetric {
  return { workoutsCompleted: 0, drillsCompleted: 0, secondsTrained: 0 };
}

/**
 * Folds one completed workout into an existing metrics map, returning a new
 * map. `completedAt` is passed explicitly so the caller controls the clock
 * (and tests stay deterministic).
 */
export function applyWorkoutToSkillMetrics(
  existing: SkillMetrics,
  workout: Pick<WorkoutDoc, "drills">,
  completedAt: Date,
): SkillMetrics {
  const next: SkillMetrics = { ...existing };

  for (const skill of skillsTrainedInWorkout(workout.drills)) {
    const metric = { ...(next[skill] ?? emptyMetric()) };
    metric.workoutsCompleted += 1;
    if (!metric.lastTrainedAt || completedAt > metric.lastTrainedAt) {
      metric.lastTrainedAt = completedAt;
    }
    next[skill] = metric;
  }

  // Per-drill counters are credited separately from the per-workout one: a
  // workout with three completed shooting drills is one shooting workout but
  // three shooting drills.
  for (const drill of workout.drills) {
    if (!drill.completed) continue;
    const seconds = drill.elapsedSeconds ?? 0;
    for (const skill of drill.skillTags ?? []) {
      const metric = { ...(next[skill] ?? emptyMetric()) };
      metric.drillsCompleted += 1;
      metric.secondsTrained += seconds;
      next[skill] = metric;
    }
  }

  return next;
}

/**
 * The rebuild path: derives metrics from scratch out of the `workouts`
 * collection, which is the real source of truth. Used to backfill accounts
 * whose stats predate this feature, and used in tests to assert the
 * incrementally-maintained counters match a from-scratch recomputation.
 */
export function computeSkillMetricsFromWorkouts(
  workouts: Pick<WorkoutDoc, "drills" | "status" | "completedAt">[],
): SkillMetrics {
  let metrics: SkillMetrics = {};
  const completed = workouts
    .filter((w) => w.status === "completed")
    .sort(
      (a, b) =>
        (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0),
    );

  for (const workout of completed) {
    metrics = applyWorkoutToSkillMetrics(
      metrics,
      workout,
      workout.completedAt ?? new Date(0),
    );
  }
  return metrics;
}

/** Highest-volume skills first - what the player has actually put work into. */
export function rankSkillsByVolume(
  metrics: SkillMetrics,
): Array<{ skill: SkillCategory; metric: SkillMetric }> {
  return (Object.entries(metrics) as Array<[SkillCategory, SkillMetric]>)
    .filter(([, metric]) => metric.drillsCompleted > 0)
    .map(([skill, metric]) => ({ skill, metric }))
    .sort(
      (a, b) =>
        b.metric.drillsCompleted - a.metric.drillsCompleted ||
        a.skill.localeCompare(b.skill),
    );
}
