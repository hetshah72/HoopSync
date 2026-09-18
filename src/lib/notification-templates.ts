/**
 * Deterministic copy for every notification (BRD 7.15).
 *
 * Pure and isomorphic: no database, no clock, no randomness, no AI. Unlike the
 * feed - where an optional rewriter may restate the prose around a fixed set of
 * numbers - notification copy is *only* ever these templates. A notification is
 * an interruption, so it has to be short, specific and cheap; there is nothing
 * for a language model to improve here and a great deal it could get wrong.
 *
 * The rule every template obeys, inherited from feedSignalsService: a
 * notification may only state a figure that was computed from this player's own
 * records and handed in as a parameter. Nothing here invents, estimates, or
 * fills a gap with a plausible default - the callers pass real values or the
 * notification isn't raised at all.
 *
 * Tone is deliberately flat. BRD 7.13 warns that gamification must never
 * outgrow the coaching value, and the audience is 13-20 year olds, so nothing
 * here uses guilt, loss-aversion ("don't lose your streak!"), streaks-as-debt
 * framing, or exclamation-mark hype. State the fact, name the next action.
 */
import { formatHour } from "@/lib/quiet-hours";
import type { MilestoneMetric } from "@/lib/notification-types";

export interface NotificationCopy {
  title: string;
  body: string;
  /** The measured figures this copy cites, for NotificationDoc.facts. */
  facts: string[];
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Workout reminders
// ---------------------------------------------------------------------------

/**
 * An unfinished session is the strongest reminder there is: it names something
 * the player actually started, so it can't read as a generic prod.
 */
export function unfinishedWorkoutCopy(input: {
  label: string;
  drillsRemaining: number;
  daysSinceStarted: number;
}): NotificationCopy {
  const { label, drillsRemaining, daysSinceStarted } = input;
  return {
    title: "You have a session part-way through",
    body:
      `"${label}" still has ${drillsRemaining} ${plural(drillsRemaining, "drill", "drills")} left` +
      `${daysSinceStarted > 0 ? `, from ${daysSinceStarted} ${plural(daysSinceStarted, "day", "days")} ago` : ""}. ` +
      "Pick it up where you stopped.",
    facts: [
      `${drillsRemaining} ${plural(drillsRemaining, "drill", "drills")} remaining in "${label}"`,
    ],
  };
}

/** No pending session - just a gap since the last completed one. */
export function trainingGapCopy(input: {
  daysSinceLastWorkout: number;
}): NotificationCopy {
  const { daysSinceLastWorkout } = input;
  return {
    title: "Ready when you are",
    body:
      `It's been ${daysSinceLastWorkout} ${plural(daysSinceLastWorkout, "day", "days")} since your last workout. ` +
      "Today's session is already built and waiting on Train.",
    facts: [`${daysSinceLastWorkout} days since the last completed workout`],
  };
}

// ---------------------------------------------------------------------------
// Streak reminders
// ---------------------------------------------------------------------------

/**
 * Raised only on the one day the streak can still be saved - see
 * `streakStatus` in src/lib/streak.ts, which is what stops this quoting the
 * stale `currentStreak` of a streak that lapsed weeks ago.
 *
 * Framed as what's already banked rather than what's about to be lost.
 */
export function streakAtRiskCopy(input: {
  currentStreak: number;
}): NotificationCopy {
  const { currentStreak } = input;
  return {
    title: `Your ${currentStreak}-day streak is still going`,
    body:
      `You trained ${currentStreak} ${plural(currentStreak, "day", "days")} in a row through yesterday. ` +
      "Anything you log today keeps it running.",
    facts: [`${currentStreak}-day streak as of yesterday`],
  };
}

// ---------------------------------------------------------------------------
// Goal updates
// ---------------------------------------------------------------------------

export function goalCompletedCopy(input: {
  goalTitle: string;
  targetValue: number;
  unit: string;
}): NotificationCopy {
  const { goalTitle, targetValue, unit } = input;
  return {
    title: "You hit your goal",
    body: `"${goalTitle}" is done - ${targetValue} ${unit}. Open Progress to set the next one.`,
    facts: [`"${goalTitle}" reached ${targetValue} ${unit}`],
  };
}

// ---------------------------------------------------------------------------
// Coach recommendations
// ---------------------------------------------------------------------------

/**
 * The honest version of "coach recommendations".
 *
 * Coach in this app is reactive - it answers what the player asks and has no
 * proactive recommendation engine - so a notification claiming the Coach
 * reached out unprompted would be fiction. What is real: finalizing a shooting
 * session or a game film analysis *does* build a startable workout aimed at the
 * weakest thing it found. That workout is the recommendation, and this points
 * at it.
 */
export function sessionRecommendationCopy(input: {
  zoneLabel: string;
  makes: number;
  attempts: number;
  fgPercent: number;
}): NotificationCopy {
  const { zoneLabel, makes, attempts, fgPercent } = input;
  return {
    title: "A workout from your last session",
    body:
      `You shot ${makes} of ${attempts} (${fgPercent}%) from ${zoneLabel}. ` +
      "There's a session built around that spot, ready to start.",
    facts: [`${makes}/${attempts} (${fgPercent}%) from ${zoneLabel}`],
  };
}

/**
 * Game film's equivalent. The weakness is heuristic rather than detected, and
 * `coach-context-format.ts` already requires that to be stated wherever it is
 * referenced - so the copy says "from your profile", not "we saw".
 */
export function gameFilmRecommendationCopy(input: {
  weaknessLabel: string;
  workoutCount: number;
}): NotificationCopy {
  const { weaknessLabel, workoutCount } = input;
  return {
    title: "Your game film review is ready",
    body:
      `It flagged ${weaknessLabel} and built ${workoutCount} ${plural(workoutCount, "workout", "workouts")} around it. ` +
      "The review is a starting point drawn from your profile, not something detected in the footage.",
    facts: [`${workoutCount} recommended ${plural(workoutCount, "workout", "workouts")}`],
  };
}

// ---------------------------------------------------------------------------
// New content
// ---------------------------------------------------------------------------

export function newContentCopy(input: {
  drillCount: number;
  lessonCount: number;
}): NotificationCopy {
  const { drillCount, lessonCount } = input;

  const parts: string[] = [];
  if (drillCount > 0) {
    parts.push(`${drillCount} new ${plural(drillCount, "drill", "drills")}`);
  }
  if (lessonCount > 0) {
    parts.push(`${lessonCount} new ${plural(lessonCount, "lesson", "lessons")}`);
  }
  const summary = parts.join(" and ");

  return {
    title: "New in the library",
    body: `${summary} since you last checked. Worth a look before your next session.`,
    facts: [summary],
  };
}

// ---------------------------------------------------------------------------
// Progress milestones
// ---------------------------------------------------------------------------

/**
 * One line per milestone, stating the real counter and nothing else. No points,
 * no levels, no rank - see the note on MILESTONE_THRESHOLDS about BRD 7.13.
 */
export function milestoneCopy(input: {
  metric: MilestoneMetric;
  threshold: number;
}): NotificationCopy {
  const { metric, threshold } = input;

  switch (metric) {
    case "streak":
      return {
        title: `${threshold} days in a row`,
        body: `That's ${threshold} straight days of logged training. Consistency is the whole thing.`,
        facts: [`${threshold}-day training streak`],
      };
    case "longest_streak":
      return {
        title: "Your longest streak yet",
        body: `${threshold} ${plural(threshold, "day", "days")} in a row - further than you've gone before.`,
        facts: [`New longest streak: ${threshold} days`],
      };
    case "workouts":
      return {
        title: `${threshold} workouts done`,
        body: `You've completed ${threshold} workouts in HoopSync. Progress has the breakdown by skill.`,
        facts: [`${threshold} workouts completed`],
      };
    case "shot_sessions":
      return {
        title: `${threshold} shooting sessions logged`,
        body: `${threshold} sessions of real, tapped-in shot data. Your zone percentages get sharper with every one.`,
        facts: [`${threshold} shooting sessions logged`],
      };
    default: {
      // Adding a metric without copy should fail the build, not ship a blank
      // notification.
      const unhandled: never = metric;
      throw new Error(`Unhandled milestone metric: ${String(unhandled)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Preferences summary
// ---------------------------------------------------------------------------

/** "Quiet from 10 PM to 7 AM" - the line under the quiet-hours control. */
export function quietHoursSummary(window?: {
  startHour: number;
  endHour: number;
}): string {
  if (!window || window.startHour === window.endHour) {
    return "No quiet hours set.";
  }
  return `Quiet from ${formatHour(window.startHour)} to ${formatHour(window.endHour)}.`;
}
