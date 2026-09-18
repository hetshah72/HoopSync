/**
 * Notification taxonomy, dedupe keys, and milestone thresholds (BRD 7.15).
 *
 * Pure and isomorphic: the service raises notifications with these keys, the
 * profile form renders these labels, and the tests exercise the key builders
 * directly without a database.
 */
import { NOTIFICATION_TYPES, type NotificationType } from "@/types/db";

export { NOTIFICATION_TYPES };
export type { NotificationType };

/**
 * How a type is described wherever the player can switch it off. Written as
 * what they'll actually receive, not as an internal category name.
 */
export const NOTIFICATION_TYPE_INFO: Record<
  NotificationType,
  { label: string; description: string }
> = {
  workout_reminder: {
    label: "Workout reminders",
    description: "When you've left a session unfinished, or it's been a while.",
  },
  streak_reminder: {
    label: "Streak reminders",
    description: "Only on the day your streak is actually at risk.",
  },
  goal_update: {
    label: "Goal updates",
    description: "When a goal you set finishes.",
  },
  coach_recommendation: {
    label: "Coach recommendations",
    description: "When an analysis produces a workout worth running.",
  },
  new_content: {
    label: "New content",
    description: "When drills or lessons are added.",
  },
  progress_milestone: {
    label: "Progress milestones",
    description: "When you pass a training milestone.",
  },
};

/**
 * Types raised by the passage of time rather than by something the player just
 * did. These are the ones evaluated on read, capped at one per day each, and
 * the only ones quiet hours applies to - an event-triggered notification is a
 * receipt for an action the player took seconds ago, so holding it back until
 * morning would be strange rather than considerate.
 */
export const TIME_TRIGGERED_TYPES = [
  "workout_reminder",
  "streak_reminder",
  "new_content",
] as const satisfies readonly NotificationType[];

/**
 * Whether a type is switched on for a player.
 *
 * Absence means enabled, so a profile written before notifications existed -
 * or before a type was added - behaves as fully on without a migration.
 */
export function isTypeEnabled(
  type: NotificationType,
  preferences?: { types?: Partial<Record<NotificationType, boolean>> },
): boolean {
  return preferences?.types?.[type] !== false;
}

// ---------------------------------------------------------------------------
// Dedupe keys
// ---------------------------------------------------------------------------

/**
 * Every notification's identity, and the thing the unique index on
 * {userId, dedupeKey} enforces. The key's *shape* is what encodes how often a
 * type may recur, so getting these right is the whole of the "don't nag"
 * guarantee:
 *
 *   ...:{dayStamp}              at most once a day     (the reminders)
 *   ...:{entityId}              once per goal/analysis (the receipts)
 *   ...:{metric}:{threshold}    once ever              (milestones)
 *
 * Milestone keys deliberately carry no day or streak-run component: crossing
 * 7 days, lapsing, and climbing back to 7 must congratulate the player once,
 * not every time.
 */
export const dedupeKeyFor = {
  workoutReminder: (dayStamp: string) => `workout_reminder:${dayStamp}`,
  streakReminder: (dayStamp: string) => `streak_reminder:${dayStamp}`,
  newContent: (dayStamp: string) => `new_content:${dayStamp}`,
  goalCompleted: (goalId: string) => `goal_update:${goalId}:completed`,
  coachRecommendation: (sourceId: string) =>
    `coach_recommendation:${sourceId}`,
  milestone: (metric: MilestoneMetric, threshold: number) =>
    `progress_milestone:${metric}:${threshold}`,
} as const;

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export type MilestoneMetric =
  | "streak"
  | "workouts"
  | "shot_sessions"
  | "longest_streak";

/**
 * Thresholds worth interrupting someone for.
 *
 * Deliberately sparse. BRD 7.13 (Achievements/XP) is a *separate* Phase 2
 * feature carrying explicit founder guidance that gamification must "never
 * become more prominent than the app's actual development/coaching value", so
 * this is not that system: no XP, no levels, no badges, and no milestone every
 * five workouts. These are derived entirely from counters BRD 7.11 already
 * keeps (src/types/db.ts UserStatsDoc).
 */
export const MILESTONE_THRESHOLDS: Record<
  Exclude<MilestoneMetric, "longest_streak">,
  readonly number[]
> = {
  streak: [7, 14, 30, 60, 100],
  workouts: [10, 25, 50, 100],
  shot_sessions: [5, 10, 25],
};

/**
 * Thresholds crossed by moving from `previous` to `next`.
 *
 * Takes both values rather than just the new one, which is what makes
 * milestones safe to emit with no "already awarded" bookkeeping: a counter can
 * only cross a threshold at the moment it moves past it, so a player who
 * already has 40 workouts when this ships never gets a retroactive 10 or 25.
 * Returns every threshold in the gap, because a single shot session can push a
 * counter past more than one.
 */
export function thresholdsCrossed(
  thresholds: readonly number[],
  previous: number,
  next: number,
): number[] {
  if (next <= previous) return [];
  return thresholds.filter(
    (threshold) => previous < threshold && next >= threshold,
  );
}
