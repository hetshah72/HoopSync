/**
 * The goal catalog (BRD 7.12), isomorphic so the Goals UI and the server-side
 * auto-tracker agree on one definition instead of two.
 *
 * Every template maps to a `metricKey` that goalService can compute from real
 * workout, shot and game-film data - BRD 7.12 requires goals to "update
 * automatically from workout, shot, and game data wherever possible, rather
 * than requiring manual check-ins", so there is deliberately no
 * manually-incremented goal type here.
 *
 * On the "wherever possible" clause: the one game-derived metric counts films
 * the player actually uploaded and reviewed, which is a real action they
 * took. The *content* of a game film analysis is generated - however good the
 * provider behind it - so its strengths/weaknesses must never drive a
 * progress bar the player reads as a measured fact about their game.
 */

export const GOAL_METRIC_KEYS = [
  "workouts.totalCompleted",
  "workouts.completedPerWeek",
  "workouts.completedForSkill:ball_handling",
  "workouts.completedForSkill:finishing",
  "shotSessions.totalMakes",
  "shotSessions.threePointPct",
  "gameFilm.totalAnalyzed",
] as const;

export type GoalMetricKey = (typeof GOAL_METRIC_KEYS)[number];

export const GOAL_TYPE_IDS = [
  "three_point_pct",
  "total_makes",
  "training_frequency",
  "weak_hand",
  "finishing",
  "tryout_prep",
  "film_study",
] as const;

export type GoalTypeId = (typeof GOAL_TYPE_IDS)[number];

/**
 * How a goal's target relates to time.
 *
 * `cumulative` goals accrue until they are met and then stay met. `weekly`
 * ones are habits, not milestones: they measure a rolling 7-day window, so
 * they must never latch to "completed" - a player who trained 4x last week
 * and nothing since has not permanently achieved "train 4x per week". See
 * goalService.recalculateGoalsForUser, which deliberately leaves weekly goals
 * active, and listGoalsForUser, which re-resolves them on read so a stale
 * window never reaches the UI.
 */
export type GoalCadence = "cumulative" | "weekly";

/**
 * Where a counting goal starts from.
 *
 * `creation` goals count only activity logged after the goal was set, which
 * is the honest reading of "complete 20 workouts before tryouts" - otherwise
 * a player with 25 lifetime workouts opens that goal already finished.
 * `lifetime` is for targets that genuinely are lifetime milestones ("make
 * 500 shots") and for rates, where subtracting a baseline is meaningless.
 */
export type GoalCountsFrom = "creation" | "lifetime";

export interface GoalTemplate {
  type: GoalTypeId;
  label: string;
  /** Shown under the label when picking a goal. */
  description: string;
  /** How `targetValue`/`currentValue` should read in the UI. */
  unit: string;
  metricKey: GoalMetricKey;
  defaultTarget: number;
  minTarget: number;
  maxTarget: number;
  /** Whether this goal is naturally bounded by a deadline (e.g. tryouts). */
  supportsTargetDate: boolean;
  cadence: GoalCadence;
  countsFrom: GoalCountsFrom;
  titleFor: (target: number) => string;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    type: "three_point_pct",
    label: "Improve 3PT%",
    description:
      "Tracks your make rate across every three-point zone in your logged shooting sessions.",
    unit: "%",
    metricKey: "shotSessions.threePointPct",
    defaultTarget: 38,
    minTarget: 1,
    maxTarget: 100,
    supportsTargetDate: true,
    // A rate, not a count: there is no baseline to subtract, and "your 3PT%
    // since Tuesday" is a worse answer than "your 3PT%".
    cadence: "cumulative",
    countsFrom: "lifetime",
    titleFor: (t) => `Raise 3PT% to ${t}%`,
  },
  {
    type: "total_makes",
    label: "Make a number of shots",
    description:
      "Counts every made shot you tap-log across all of your shooting sessions.",
    unit: "makes",
    metricKey: "shotSessions.totalMakes",
    defaultTarget: 500,
    minTarget: 1,
    maxTarget: 100000,
    supportsTargetDate: true,
    cadence: "cumulative",
    // Genuinely a lifetime milestone - a player 480 makes in wants to see
    // 480/500, not 0/500.
    countsFrom: "lifetime",
    titleFor: (t) => `Make ${t} shots`,
  },
  {
    type: "training_frequency",
    label: "Train more often",
    description:
      "Counts the workouts you've completed in the last 7 days, so it moves with your week.",
    unit: "workouts/week",
    metricKey: "workouts.completedPerWeek",
    defaultTarget: 4,
    minTarget: 1,
    maxTarget: 21,
    supportsTargetDate: false,
    cadence: "weekly",
    countsFrom: "lifetime",
    titleFor: (t) => `Train ${t}x per week`,
  },
  {
    type: "weak_hand",
    label: "Improve your weak hand",
    description:
      "Counts the ball-handling workouts you complete from here on - the work that actually builds the off hand.",
    unit: "workouts",
    metricKey: "workouts.completedForSkill:ball_handling",
    defaultTarget: 10,
    minTarget: 1,
    maxTarget: 500,
    supportsTargetDate: true,
    cadence: "cumulative",
    countsFrom: "creation",
    titleFor: (t) => `Complete ${t} ball-handling workouts`,
  },
  {
    type: "finishing",
    label: "Improve finishing",
    description: "Counts the finishing workouts you complete from here on.",
    unit: "workouts",
    metricKey: "workouts.completedForSkill:finishing",
    defaultTarget: 10,
    minTarget: 1,
    maxTarget: 500,
    supportsTargetDate: true,
    cadence: "cumulative",
    countsFrom: "creation",
    titleFor: (t) => `Complete ${t} finishing workouts`,
  },
  {
    type: "tryout_prep",
    label: "Prepare for tryouts",
    description:
      "Counts every workout you complete from now until your tryout date - set the date below.",
    unit: "workouts",
    metricKey: "workouts.totalCompleted",
    defaultTarget: 20,
    minTarget: 1,
    maxTarget: 1000,
    supportsTargetDate: true,
    cadence: "cumulative",
    countsFrom: "creation",
    titleFor: (t) => `Complete ${t} workouts before tryouts`,
  },
  {
    type: "film_study",
    label: "Review game film",
    description:
      "Counts the game films you upload and review from here on. It tracks the reviewing you do, not how you played.",
    unit: "films",
    metricKey: "gameFilm.totalAnalyzed",
    defaultTarget: 5,
    minTarget: 1,
    maxTarget: 200,
    supportsTargetDate: true,
    cadence: "cumulative",
    countsFrom: "creation",
    titleFor: (t) => `Review ${t} game films`,
  },
];

export function goalTemplateFor(type: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.type === type);
}

/** Clamped 0-100 so a bar never overflows when a player beats their target. */
export function goalProgressPercent(
  currentValue: number,
  targetValue: number,
): number {
  if (targetValue <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((currentValue / targetValue) * 100)));
}

/** True once a goal's current value has reached its target. */
export function isGoalMet(currentValue: number, targetValue: number): boolean {
  return currentValue >= targetValue;
}

/**
 * Whether this goal type latches once met.
 *
 * Weekly goals don't: "met this week" is derived from the current rolling
 * value every time it is read, so it goes away on its own when the window
 * slides past the work that earned it.
 */
export function goalCadenceFor(type: string): GoalCadence {
  return goalTemplateFor(type)?.cadence ?? "cumulative";
}
