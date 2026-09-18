import "server-only";
import type { ObjectId } from "mongodb";
import {
  createGoal as createGoalRepo,
  deleteGoal as deleteGoalRepo,
  findGoalByIdForUser,
  listGoalsForUser as listGoalsRepo,
  setGoalStatus,
  updateGoalProgress,
} from "@/server/repositories/goalRepository";
import { countCompletedWorkoutsForUser } from "@/server/repositories/workoutRepository";
import { aggregateZoneStatsForUser } from "@/server/repositories/shotSessionRepository";
import { findStatsForUser } from "@/server/repositories/userStatsRepository";
import { countCompletedAnalysesForUser } from "@/server/repositories/gameFootageRepository";
import { notifyGoalsCompleted } from "@/server/services/notificationService";
import { fgPercent, THREE_POINT_ZONES } from "@/lib/shot-zones";
import {
  goalCadenceFor,
  goalTemplateFor,
  type GoalMetricKey,
} from "@/lib/goal-types";
import { NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { CreateGoalInput } from "@/lib/validation/goal";
import type { GoalDoc, GoalStatus, SkillCategory } from "@/types/db";

const SKILL_METRIC_PREFIX = "workouts.completedForSkill:";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** `workouts.completedForSkill:finishing` -> `finishing`. */
function skillCategoryFromMetricKey(
  metricKey: `${typeof SKILL_METRIC_PREFIX}${SkillCategory}`,
): SkillCategory {
  return metricKey.slice(SKILL_METRIC_PREFIX.length) as SkillCategory;
}

/**
 * Turns a raw metric reading into this goal's progress.
 *
 * `baselineValue` is what the metric already read when the goal was set, so
 * subtracting it is what makes "complete 20 workouts before tryouts" mean 20
 * *more*. Absent baseline (lifetime goals, and any document written before
 * the field existed) reads as 0, i.e. the raw metric - unchanged behaviour.
 */
function progressFrom(goal: GoalDoc, resolved: number): number {
  return Math.max(0, resolved - (goal.baselineValue ?? 0));
}

/**
 * Weekly goals never latch to "completed": they measure a rolling window, so
 * "met" has to be able to become "not met again" when the window slides. The
 * Goals tab derives that state from the value instead of reading it here.
 */
function nextStatusFor(goal: GoalDoc, value: number): GoalStatus {
  if (goalCadenceFor(goal.type) === "weekly") return "active";
  return value >= goal.targetValue ? "completed" : "active";
}

/**
 * Resolves one metric key to a real, currently-true value.
 *
 * Everything here is *derived* rather than incremented, which is what makes
 * BRD 7.12's "update automatically... rather than requiring manual
 * check-ins" hold even for a goal created after the activity happened: a
 * "make 500 shots" goal set today immediately reflects shots logged last
 * week, and no counter can drift away from the underlying records.
 */
async function resolveMetric(
  userId: ObjectId,
  metricKey: GoalMetricKey,
): Promise<number> {
  switch (metricKey) {
    case "workouts.totalCompleted":
      return countCompletedWorkoutsForUser(userId);

    case "workouts.completedPerWeek":
      return countCompletedWorkoutsForUser(userId, {
        completedSince: new Date(Date.now() - WEEK_MS),
      });

    case "workouts.completedForSkill:ball_handling":
    case "workouts.completedForSkill:finishing":
      return countCompletedWorkoutsForUser(userId, {
        skillCategory: skillCategoryFromMetricKey(metricKey),
      });

    case "shotSessions.totalMakes": {
      const stats = await findStatsForUser(userId);
      return stats?.totalShotMakes ?? 0;
    }

    case "shotSessions.threePointPct": {
      const { attempts, makes } = await aggregateZoneStatsForUser(
        userId,
        THREE_POINT_ZONES,
      );
      return fgPercent(makes, attempts);
    }

    // The game-data leg of BRD 7.12. Counts films the player really uploaded
    // and reviewed - a real action - never anything read out of the generated
    // analysis content.
    case "gameFilm.totalAnalyzed":
      return countCompletedAnalysesForUser(userId);

    default: {
      // Exhaustiveness guard: adding a metric key without handling it here
      // should fail the build, not silently report 0 progress forever.
      const unhandled: never = metricKey;
      throw new Error(`Unhandled goal metric key: ${String(unhandled)}`);
    }
  }
}

/**
 * Every goal for the Goals tab, with weekly goals resolved against the live
 * rolling window.
 *
 * A weekly goal's persisted `currentValue` is only rewritten when the player
 * finishes something, so on its own it would freeze: train 4x and then stop,
 * and the tab would still read 4/4 forever. Re-resolving here keeps the
 * displayed number true on every view.
 *
 * Deliberately a read: this runs during a Server Component render, and
 * writing to Mongo on a GET would make rendering the page a mutation. The
 * persisted value stays the cache that activity-time recalculation owns (the
 * feed fingerprint reads it), and this only corrects what the player sees.
 */
export async function listGoalsForUser(userId: ObjectId): Promise<GoalDoc[]> {
  const goals = await listGoalsRepo(userId);

  const windowed = goals.filter(
    (goal) =>
      goal.status !== "abandoned" &&
      goal.autoTrackedMetricKey &&
      goalCadenceFor(goal.type) === "weekly",
  );
  if (windowed.length === 0) return goals;

  const windowedIds = new Set(windowed.map((goal) => goal._id.toString()));
  const values = new Map<string, number>();
  for (const key of new Set(windowed.map((g) => g.autoTrackedMetricKey!))) {
    try {
      values.set(key, await resolveMetric(userId, key as GoalMetricKey));
    } catch (err) {
      // A failed resolve falls back to the persisted value rather than
      // blanking the tab.
      logger.error(
        { userId: userId.toString(), key, err },
        "Failed to resolve windowed goal metric for display",
      );
    }
  }

  return goals.map((goal) => {
    if (!windowedIds.has(goal._id.toString())) return goal;
    const resolved = values.get(goal.autoTrackedMetricKey!);
    if (resolved === undefined) return goal;
    return { ...goal, currentValue: progressFrom(goal, resolved) };
  });
}

export async function createGoalForUser(
  userId: ObjectId,
  input: CreateGoalInput,
): Promise<GoalDoc> {
  const template = goalTemplateFor(input.type);
  if (!template) {
    throw new ValidationError("That goal type isn't available.");
  }

  const resolved = await resolveMetric(userId, template.metricKey);

  // A "from creation" goal banks what the player has already done as its
  // baseline and opens at 0, so the target is work still ahead of them. A
  // lifetime goal keeps the raw reading, so it never opens at 0 when they
  // have already put the shots up.
  const baselineValue =
    template.countsFrom === "creation" ? resolved : undefined;
  const currentValue = Math.max(0, resolved - (baselineValue ?? 0));

  const now = new Date();
  return createGoalRepo({
    userId,
    type: template.type,
    title: template.titleFor(input.targetValue),
    targetValue: input.targetValue,
    currentValue,
    unit: template.unit,
    status:
      template.cadence === "weekly"
        ? "active"
        : currentValue >= input.targetValue
          ? "completed"
          : "active",
    autoTrackedMetricKey: template.metricKey,
    baselineValue,
    targetDate: input.targetDate,
    createdAt: now,
    updatedAt: now,
  });
}

export async function abandonGoal(
  userId: ObjectId,
  goalId: ObjectId,
): Promise<GoalDoc> {
  const updated = await setGoalStatus(userId, goalId, "abandoned");
  if (!updated) {
    throw new NotFoundError("Goal not found.");
  }
  return updated;
}

export async function reactivateGoal(
  userId: ObjectId,
  goalId: ObjectId,
): Promise<GoalDoc> {
  const goal = await findGoalByIdForUser(userId, goalId);
  if (!goal) {
    throw new NotFoundError("Goal not found.");
  }
  const updated = await setGoalStatus(userId, goalId, "active");
  if (!updated) {
    throw new NotFoundError("Goal not found.");
  }
  return updated;
}

export async function deleteGoalForUser(
  userId: ObjectId,
  goalId: ObjectId,
): Promise<void> {
  const deleted = await deleteGoalRepo(userId, goalId);
  if (!deleted) {
    throw new NotFoundError("Goal not found.");
  }
}

/**
 * Recomputes every auto-tracked goal for a user against real activity, and
 * flips any that have reached their target to "completed".
 *
 * Called from workoutService.completeWorkout,
 * shotSessionService.finalizeSession and gameFootageService.analyzeGameFootage
 * - i.e. from the same service-layer choke points that already own the
 * Progress write - so no route or action can forget to run it.
 *
 * Returns the goals that newly completed, so callers can surface them.
 * Weekly goals are never among them: they don't latch (see nextStatusFor).
 */
export async function recalculateGoalsForUser(
  userId: ObjectId,
): Promise<GoalDoc[]> {
  const goals = await listGoalsRepo(userId);
  const active = goals.filter(
    (goal) => goal.status === "active" && goal.autoTrackedMetricKey,
  );
  if (active.length === 0) return [];

  // One resolve per distinct metric, not per goal - two goals on the same
  // metric shouldn't cost two aggregations. Baselines are per-goal, so they
  // are applied to the shared reading below rather than resolved separately.
  const distinctKeys = [
    ...new Set(active.map((goal) => goal.autoTrackedMetricKey!)),
  ];
  const values = new Map<string, number>();
  for (const key of distinctKeys) {
    try {
      values.set(key, await resolveMetric(userId, key as GoalMetricKey));
    } catch (err) {
      logger.error({ userId: userId.toString(), key, err }, "Failed to resolve goal metric");
    }
  }

  const newlyCompleted: GoalDoc[] = [];
  for (const goal of active) {
    const resolved = values.get(goal.autoTrackedMetricKey!);
    if (resolved === undefined) continue;

    const value = progressFrom(goal, resolved);
    const status = nextStatusFor(goal, value);
    // Nothing to write when neither the number nor the status moved.
    if (value === goal.currentValue && status === goal.status) continue;

    const updated = await updateGoalProgress(userId, goal._id, {
      currentValue: value,
      status,
    });
    if (updated && status === "completed") {
      newlyCompleted.push(updated);
    }
  }

  // Notified here rather than at each call site, for the same reason this
  // function is called from the choke points at all: three paths complete
  // goals, and any one of them could otherwise forget. A transition to
  // "completed" is the only thing that reaches this list, so a goal that was
  // already complete - or one created complete from past activity - never
  // produces a notification (BRD 7.15 "goal updates").
  await notifyGoalsCompleted(userId, newlyCompleted);

  return newlyCompleted;
}
