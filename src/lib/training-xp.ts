/**
 * Training XP and tiers (BRD 7.13).
 *
 * XP is *derived*, never stored. It is a pure function of counters the app
 * already maintains from real completed activity (src/types/db.ts
 * UserStatsDoc), which is what makes three things true at once: it can never
 * drift away from the records, a player who trained before this feature
 * existed gets credit for that work immediately, and there is no counter for a
 * second write path to forget. Same reasoning as goalService's derived metrics.
 *
 * Pure and isomorphic so it is directly unit-testable without a database, and
 * so the Progress UI and the feed generator compute the same number.
 */

/**
 * BRD 7.13 says "levels", but `EducationLevel` and `CompetitiveLevel` already
 * mean something specific in this domain - a gamification "Level 4" sitting
 * next to "high school level" is genuinely ambiguous. So: tiers.
 *
 * The names describe *training commitment*, which is what the counters
 * actually measure. Names implying competitive standing ("Varsity",
 * "All-State") would assert something HoopSync cannot measure, which is the
 * same line src/lib/skill-metrics.ts draws against synthesized skill ratings.
 */
export interface TrainingTier {
  key: TrainingTierKey;
  label: string;
  minXp: number;
}

export const TRAINING_TIER_KEYS = [
  "getting_started",
  "putting_in_work",
  "consistent",
  "committed",
  "relentless",
  "year_round",
] as const;

export type TrainingTierKey = (typeof TRAINING_TIER_KEYS)[number];

/**
 * Ascending by `minXp`, and deliberately *bounded* at six. An endless level
 * ladder is the part of gamification that turns into a treadmill, and BRD 7.13
 * carries explicit founder guidance that this layer must never become more
 * prominent than the actual coaching value.
 *
 * Roughly 2.5-3x per step, calibrated against the XP weights below: ~5
 * workouts to leave the first tier, ~30 plus logged sessions to reach
 * "Committed", and a sustained year of training for the top. These are a
 * product judgement, not a measurement - cheap to retune precisely because
 * nothing is persisted.
 */
export const TRAINING_TIERS: readonly TrainingTier[] = [
  { key: "getting_started", label: "Getting Started", minXp: 0 },
  { key: "putting_in_work", label: "Putting In Work", minXp: 250 },
  { key: "consistent", label: "Consistent", minXp: 750 },
  { key: "committed", label: "Committed", minXp: 2_000 },
  { key: "relentless", label: "Relentless", minXp: 5_000 },
  { key: "year_round", label: "Year-Round", minXp: 12_000 },
];

/**
 * The counters XP is computed from.
 *
 * Every field is monotonic, which is what guarantees XP never goes down:
 * `longestStreak` is used rather than `currentStreak` precisely because the
 * latter falls back to 1 after a missed day, and a number that dropped
 * overnight would read as a punishment for one rest day.
 */
export interface TrainingXpInputs {
  totalWorkoutsCompleted: number;
  totalShotSessions: number;
  totalShotMakes: number;
  longestStreak: number;
}

/**
 * XP per unit of real work.
 *
 * A completed workout is the most effortful unit here and anchors the scale. A
 * logged shooting session is a smaller commitment. A single made shot is worth
 * 1, so a 60-make session adds roughly twice a workout, which is fair for the
 * work it represents. The streak term rewards consistency itself rather than
 * volume.
 *
 * Deliberately absent: per-skill `drillsCompleted`. skill-metrics.ts credits a
 * drill once *per skill tag* it carries, so summing that map across skills
 * double-counts any multi-tag drill - it would make XP quietly wrong. (Per-skill
 * counts are still fine for skill achievements, which never sum across skills.)
 */
export const XP_WEIGHTS = {
  workoutCompleted: 50,
  shotSessionLogged: 30,
  shotMade: 1,
  longestStreakDay: 20,
} as const;

export function xpFromInputs(inputs: TrainingXpInputs): number {
  return (
    inputs.totalWorkoutsCompleted * XP_WEIGHTS.workoutCompleted +
    inputs.totalShotSessions * XP_WEIGHTS.shotSessionLogged +
    inputs.totalShotMakes * XP_WEIGHTS.shotMade +
    inputs.longestStreak * XP_WEIGHTS.longestStreakDay
  );
}

/** The highest tier whose `minXp` has been reached. Never undefined - the
 *  first tier starts at 0. */
export function tierForXp(xp: number): TrainingTier {
  let current = TRAINING_TIERS[0];
  for (const tier of TRAINING_TIERS) {
    if (xp >= tier.minXp) current = tier;
  }
  return current;
}

export interface TierProgress {
  xp: number;
  tier: TrainingTier;
  /** Null at the top tier - there is nothing further to climb. */
  nextTier: TrainingTier | null;
  /** XP accumulated inside the current tier. */
  xpIntoTier: number;
  /** XP the current tier spans. 0 at the top tier. */
  xpTierSpan: number;
  /** XP still needed to reach `nextTier`. 0 at the top tier. */
  xpToNextTier: number;
  /** 0-100, clamped. 100 at the top tier. */
  percent: number;
}

/**
 * Everything the UI needs to render one progress bar, computed in one place so
 * the Progress overview line and the Achievements tab can never disagree.
 */
export function tierProgressForXp(xp: number): TierProgress {
  const safeXp = Math.max(0, Math.floor(xp));
  const tier = tierForXp(safeXp);
  const index = TRAINING_TIERS.findIndex((t) => t.key === tier.key);
  const nextTier = TRAINING_TIERS[index + 1] ?? null;

  if (!nextTier) {
    return {
      xp: safeXp,
      tier,
      nextTier: null,
      xpIntoTier: safeXp - tier.minXp,
      xpTierSpan: 0,
      xpToNextTier: 0,
      percent: 100,
    };
  }

  const xpTierSpan = nextTier.minXp - tier.minXp;
  const xpIntoTier = safeXp - tier.minXp;

  return {
    xp: safeXp,
    tier,
    nextTier,
    xpIntoTier,
    xpTierSpan,
    xpToNextTier: nextTier.minXp - safeXp,
    // Clamped for the same reason goalProgressPercent is: a bar must never
    // overflow its track.
    percent: Math.max(0, Math.min(100, Math.round((xpIntoTier / xpTierSpan) * 100))),
  };
}
