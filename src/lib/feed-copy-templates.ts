/**
 * Deterministic copy for every generated feed card.
 *
 * This is the floor, not the fallback-of-last-resort: these templates run
 * for every card on every day, and the AI rewriter (when configured) only
 * ever replaces the prose around numbers this module has already fixed. That
 * ordering is deliberate - it means the feed works with no API key, renders
 * instantly, and can never state a figure that wasn't computed here from the
 * player's own records.
 *
 * Pure and isomorphic: no database, no clock, no randomness. Variety comes
 * from a caller-supplied rotation key (`userId:dayStamp`), so the same
 * player sees the same card all day and a different one tomorrow.
 */
import { pickDeterministic } from "@/lib/deterministic";

export interface FeedCardCopy {
  title: string;
  body: string;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Weakness call-out (BRD 7.2 "personalized weakness call-outs")
// ---------------------------------------------------------------------------

export interface WeaknessCopyInput {
  zoneLabel: string;
  makes: number;
  attempts: number;
  fgPercent: number;
  sessionCount: number;
  bestZoneLabel?: string;
  bestZoneFgPercent?: number;
}

export function weaknessCopy(
  input: WeaknessCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const {
    zoneLabel,
    makes,
    attempts,
    fgPercent,
    sessionCount,
    bestZoneLabel,
    bestZoneFgPercent,
  } = input;

  const window =
    sessionCount === 1
      ? "your last session"
      : `your last ${sessionCount} sessions`;

  const openers = [
    `${zoneLabel} is costing you the most right now`,
    `Your ${zoneLabel} is the gap worth closing`,
    `Train the spot the chart is pointing at: ${zoneLabel}`,
  ];

  const comparison =
    bestZoneLabel && bestZoneFgPercent !== undefined
      ? ` You're shooting ${bestZoneFgPercent}% from ${bestZoneLabel} over the same stretch, so this isn't effort - it's one spot.`
      : " Log shots from a second spot next time and you'll see whether this is specific to that zone or shows up everywhere.";

  return {
    title: pickDeterministic(openers, rotationKey)!,
    body:
      `Across ${window} you're ${makes} of ${attempts} from ${zoneLabel} (${fgPercent}%).` +
      comparison,
  };
}

// ---------------------------------------------------------------------------
// Today's recommended workout (BRD 7.2)
// ---------------------------------------------------------------------------

export interface DailyWorkoutCopyInput {
  drillCount: number;
  estimatedMinutes: number;
  firstDrillName?: string;
  /** Why this workout, in the player's terms. */
  reason: string;
}

export function dailyWorkoutCopy(
  input: DailyWorkoutCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const { drillCount, estimatedMinutes, firstDrillName, reason } = input;

  const titles = [
    "Today's workout is ready",
    "Here's today's session",
    "Your workout for today",
  ];

  const opener = `${drillCount} ${plural(drillCount, "drill", "drills")}, about ${estimatedMinutes} minutes. ${reason}`;

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: firstDrillName ? `${opener} Starts with ${firstDrillName}.` : opener,
  };
}

// ---------------------------------------------------------------------------
// Progress update (BRD 7.2 "progress-update summaries")
// ---------------------------------------------------------------------------

export interface ProgressCopyInput {
  workoutsThisWeek: number;
  workoutsLastWeek: number;
  currentStreak: number;
  totalWorkoutsCompleted: number;
  totalShotSessions: number;
  lifetimeFgPercent?: number;
}

export function progressCopy(
  input: ProgressCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const {
    workoutsThisWeek,
    workoutsLastWeek,
    currentStreak,
    totalWorkoutsCompleted,
    totalShotSessions,
    lifetimeFgPercent,
  } = input;

  const delta = workoutsThisWeek - workoutsLastWeek;
  const weekLine =
    workoutsThisWeek === 0
      ? "You haven't finished a workout in the last 7 days."
      : `${workoutsThisWeek} ${plural(workoutsThisWeek, "workout", "workouts")} in the last 7 days` +
        (delta > 0
          ? `, ${delta} more than the week before.`
          : delta < 0
            ? `, ${Math.abs(delta)} fewer than the week before.`
            : ", the same as the week before.");

  const streakLine =
    currentStreak > 1 ? ` You're on a ${currentStreak}-day streak.` : "";

  const totalsParts = [
    `${totalWorkoutsCompleted} ${plural(totalWorkoutsCompleted, "workout", "workouts")}`,
  ];
  if (totalShotSessions > 0) {
    totalsParts.push(
      `${totalShotSessions} shooting ${plural(totalShotSessions, "session", "sessions")}`,
    );
  }
  const totalsLine = ` All time: ${totalsParts.join(", ")}${
    lifetimeFgPercent !== undefined ? `, ${lifetimeFgPercent}% from the field` : ""
  }.`;

  const titles = ["Where you stand", "Your week so far", "Progress check"];

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: `${weekLine}${streakLine}${totalsLine}`,
  };
}

// ---------------------------------------------------------------------------
// Goal nudge (BRD 7.12 goals surfaced on Home)
// ---------------------------------------------------------------------------

export interface GoalCopyInput {
  goalTitle: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  progressPercent: number;
}

export function goalCopy(input: GoalCopyInput, rotationKey: string): FeedCardCopy {
  const { goalTitle, currentValue, targetValue, unit, progressPercent } = input;

  const titles = [
    `${progressPercent}% of the way to your goal`,
    "Your goal, as of today",
    "Goal check-in",
  ];

  const remaining = Math.max(0, targetValue - currentValue);
  const closing =
    remaining === 0
      ? " You've hit the target - open Progress to set the next one."
      : ` ${Math.round(remaining * 10) / 10} ${unit} to go.`;

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: `"${goalTitle}" is at ${currentValue} of ${targetValue} ${unit}.${closing}`,
  };
}

// ---------------------------------------------------------------------------
// Player to learn from (BRD 7.2 "'player to learn from' suggestion")
// ---------------------------------------------------------------------------

export interface PlayerStudyCopyInput {
  playerName: string;
  /**
   * Omitted unless the roster sync has confirmed it. A player seeded from
   * editorial content before a sync carries a placeholder team, and naming
   * it would put an internal sync state ("Pending roster sync") in front of
   * the player as though it were a fact about the athlete.
   */
  team?: string;
  skillLabel: string;
  /** One line of real editorial content about the player, if authored. */
  whatTheyDoWell?: string;
}

export function playerStudyCopy(
  input: PlayerStudyCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const { playerName, team, skillLabel, whatTheyDoWell } = input;

  const titles = [
    `Study ${playerName}'s ${skillLabel.toLowerCase()}`,
    `${playerName} is worth watching this week`,
    `Learn ${skillLabel.toLowerCase()} from ${playerName}`,
  ];

  const opener = `${playerName}${team ? ` (${team})` : ""} is one of the best models for the ${skillLabel.toLowerCase()} you're working on.`;

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: whatTheyDoWell ? `${opener} ${whatTheyDoWell}` : opener,
  };
}

// ---------------------------------------------------------------------------
// "Try this today" (BRD 7.2)
// ---------------------------------------------------------------------------

export interface TryTodayCopyInput {
  drillName: string;
  drillDescription?: string;
  coachingCue?: string;
}

export function tryTodayCopy(
  input: TryTodayCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const { drillName, drillDescription, coachingCue } = input;

  const titles = [
    `Try this today: ${drillName}`,
    `One thing to add today: ${drillName}`,
    `${drillName} - before you leave the gym`,
  ];

  const body = [drillDescription, coachingCue && `Focus on one thing: ${coachingCue}`]
    .filter(Boolean)
    .join(" ");

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: body || `Add ${drillName} to today's session.`,
  };
}

// ---------------------------------------------------------------------------
// Confidence / mental game (BRD 7.2, 7.10)
// ---------------------------------------------------------------------------

const CONFIDENCE_TIPS: FeedCardCopy[] = [
  {
    title: "Box breathing before tip-off",
    body: "Four seconds in, four hold, four out, four hold. A minute of it in the locker room brings your heart rate down without needing quiet or privacy.",
  },
  {
    title: "Pick your reset before you need it",
    body: "Decide now what you do after a bad possession - one deep breath, tug your jersey, whatever it is. Choosing it in advance is what makes it work when you're rattled.",
  },
  {
    title: "Judge the shot, not the result",
    body: "A good look that rims out is a good decision. If you only count makes, you'll stop taking the shots you should be taking.",
  },
  {
    title: "Shrink the game when it speeds up",
    body: "When everything feels fast, give yourself one job for the next possession - box out, or get to the corner. One job at a time slows the game back down.",
  },
  {
    title: "Your warm-up is a confidence routine",
    body: "Start every warm-up with shots you know you'll make. Walking into the game having seen the ball go in changes how the first real look feels.",
  },
  {
    title: "Talk to yourself like a teammate",
    body: "You'd never tell a teammate they're trash after one miss. The way you talk to yourself between possessions is coaching too - make it the kind you'd actually follow.",
  },
  {
    title: "Nerves and excitement feel identical",
    body: "Same racing heart, same tight chest. Naming it \"I'm ready\" instead of \"I'm nervous\" is not a trick - it's a more accurate read of what your body is doing.",
  },
];

export function confidenceCopy(rotationKey: string): FeedCardCopy {
  return pickDeterministic(CONFIDENCE_TIPS, rotationKey)!;
}

// ---------------------------------------------------------------------------
// Next step, for a player with no activity yet
// ---------------------------------------------------------------------------

export interface NextStepCopyInput {
  hasCompletedWorkout: boolean;
  hasLoggedSession: boolean;
}

/**
 * What an empty account sees instead of a fabricated insight.
 *
 * A brand-new player has no weakness, no trend and no progress, so the honest
 * card is the one that tells them how to produce that data - never a guess
 * dressed up as analysis.
 */
export function nextStepCopy(input: NextStepCopyInput): FeedCardCopy {
  if (!input.hasCompletedWorkout && !input.hasLoggedSession) {
    return {
      title: "Start with one workout",
      body: "Your feed gets specific once there's something to read. Finish today's workout below and Progress, your streak and your goals all start moving.",
    };
  }
  if (!input.hasLoggedSession) {
    return {
      title: "Log a shooting session to unlock your shot chart",
      body: "Record in Analyze and tap each attempt as you go. That's what turns this feed from general advice into your weakest zone, your percentages, and drills aimed at them.",
    };
  }
  return {
    title: "Keep the streak going",
    body: "You've logged shots - finish a workout too and your progress summary starts comparing week to week.",
  };
}

// ---------------------------------------------------------------------------
// Achievement milestone (BRD 7.13)
// ---------------------------------------------------------------------------

export interface AchievementCopyInput {
  label: string;
  description: string;
  unlockedCount: number;
  totalCount: number;
  xp: number;
  /** The closest unearned milestone, when there is one left. */
  nextLabel?: string;
  nextCurrent?: number;
  nextTarget?: number;
}

/**
 * The one card this feature puts on Home, and the only place gamification
 * appears outside Progress.
 *
 * Written to stay subordinate to the coaching content, per BRD 7.13's founder
 * guidance: it states the milestone in one clause, then immediately points at
 * the next piece of work. No exclamation marks, no "level up", no rank - the
 * reward framing is that the training added up, not that a game was played.
 * Every figure here is a real count the caller measured.
 */
export function achievementCopy(
  input: AchievementCopyInput,
  rotationKey: string,
): FeedCardCopy {
  const {
    label,
    description,
    unlockedCount,
    totalCount,
    xp,
    nextLabel,
    nextCurrent,
    nextTarget,
  } = input;

  const titles = [
    `Milestone reached: ${label}`,
    `You hit a milestone: ${label}`,
    `One for the record: ${label}`,
  ];

  const standing = ` That's ${unlockedCount} of ${totalCount} milestones and ${xp.toLocaleString("en-US")} training XP.`;

  const next =
    nextLabel && nextTarget !== undefined && nextCurrent !== undefined
      ? ` Next up: ${nextLabel}, and you're ${nextCurrent} of ${nextTarget} there.`
      : " That's every milestone in the app - keep training for the reason you started.";

  return {
    title: pickDeterministic(titles, rotationKey)!,
    body: `${description}${standing}${next}`,
  };
}
