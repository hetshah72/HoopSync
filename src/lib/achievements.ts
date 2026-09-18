/**
 * The achievement catalog (BRD 7.13), isomorphic so the Achievements tab, the
 * feed generator and the server-side evaluator all agree on one definition.
 *
 * Two rules govern everything in this file.
 *
 * 1. Unlock state is *derived*, never stored. An achievement is unlocked iff
 *    its criterion is true of the player's real records, evaluated fresh every
 *    time. The `achievements` collection stores only the date a criterion was
 *    first observed met - a missing row means "we never stamped a date", never
 *    "locked". This is the same derived-not-incremented rule goalService
 *    follows, and it is what makes retroactive credit and drift-freedom
 *    automatic.
 *
 * 2. Nothing here may read as a measurement of ability. A skill achievement is
 *    a *volume* award - reps actually logged - for exactly the reason
 *    src/components/progress/skill-breakdown.tsx gives: "HoopSync has no way to
 *    measure how good a player is at defense; a number implying otherwise would
 *    read as measured when it is not."
 *
 * Threshold sharing with BRD 7.15: the workouts/streak/sessions families take
 * their numbers from MILESTONE_THRESHOLDS in src/lib/notification-types.ts, so
 * a player never sees a "10 workouts done" notification alongside a badge at
 * some different number. Achievement-only extras are allowed (and marked) for
 * moments worth recording but not worth interrupting anyone over;
 * tests/unit/achievements.test.ts asserts every shared threshold still has a
 * badge, so the two catalogs cannot silently drift apart.
 */
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { MILESTONE_THRESHOLDS } from "@/lib/notification-types";
import { SKILL_CATEGORIES } from "@/lib/validation/onboarding";
import type { SkillCategory } from "@/types/db";

/** Drills in one skill before that skill's reps milestone is earned. */
export const SKILL_DRILL_THRESHOLD = 25;

export type AchievementFamily = "volume" | "streak" | "skill" | "milestone";

export const ACHIEVEMENT_FAMILY_LABELS: Record<AchievementFamily, string> = {
  volume: "Work put in",
  streak: "Consistency",
  skill: "Reps by skill",
  milestone: "The loop",
};

/**
 * Everything the evaluator needs, as plain numbers.
 *
 * Deliberately not a `UserStatsDoc`: keeping this a flat bag of primitives is
 * what lets the whole catalog stay isomorphic and unit-testable with no Mongo
 * types and no database. The service assembles it (src/server/services/
 * achievementService.ts).
 */
export interface AchievementInputs {
  totalWorkoutsCompleted: number;
  totalShotSessions: number;
  totalShotMakes: number;
  longestStreak: number;
  /** Per-skill completed drills. Never summed across skills - see training-xp.ts. */
  drillsCompletedBySkill: Partial<Record<SkillCategory, number>>;
  completedGoals: number;
  gameFilmAnalyses: number;
  /** Conversations anchored to a real shared item, i.e. Share With Coach. */
  coachShares: number;
}

export interface AchievementDefinition {
  key: AchievementKey;
  family: AchievementFamily;
  label: string;
  description: string;
  /**
   * Pure, total, no clock. Returns the real current value and target rather
   * than a bare boolean so a locked row can show "18 of 25 drills" - direction
   * the player can act on, instead of a padlock.
   */
  measure: (inputs: AchievementInputs) => { current: number; target: number };
}

export const ACHIEVEMENT_KEYS = [
  // Volume - workouts. 1 is an achievement-only extra (a first workout is
  // worth recording, not worth a notification); 10/25/50/100 are shared.
  "first_workout",
  "workouts_10",
  "workouts_25",
  "workouts_50",
  "workouts_100",
  // Volume - shots made. Achievement-only: BRD 7.15 has no makes milestones,
  // and tap-logged makes accumulate far too fast to interrupt anyone over.
  "makes_100",
  "makes_500",
  "makes_1000",
  "makes_5000",
  // Volume - sessions logged. All shared with MILESTONE_THRESHOLDS.
  "sessions_5",
  "sessions_10",
  "sessions_25",
  // Consistency. 3 is an achievement-only extra - an early win that is not
  // worth a push notification. 7/14/30/60/100 are shared.
  "streak_3",
  "streak_7",
  "streak_14",
  "streak_30",
  "streak_60",
  "streak_100",
  // Reps by skill - one per SkillCategory, generated below.
  "skill_shooting",
  "skill_ball_handling",
  "skill_finishing",
  "skill_defense",
  "skill_footwork",
  "skill_playmaking",
  "skill_athletic_development",
  // The connected loop. Achievement-only: these are one-time firsts, and the
  // point of recording them is to show the loop has been closed end to end.
  "first_session_analyzed",
  "first_goal_completed",
  "first_game_film",
  "first_coach_share",
] as const;

export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[number];

/** `skill_ball_handling` -> `ball_handling`. */
function skillAchievementKey(skill: SkillCategory): AchievementKey {
  return `skill_${skill}` as AchievementKey;
}

function countMeasure(
  read: (inputs: AchievementInputs) => number,
  target: number,
): AchievementDefinition["measure"] {
  return (inputs) => ({ current: read(inputs), target });
}

function workoutsAchievement(
  key: AchievementKey,
  label: string,
  target: number,
): AchievementDefinition {
  return {
    key,
    family: "volume",
    label,
    description: `${target} ${target === 1 ? "workout" : "workouts"} completed.`,
    measure: countMeasure((i) => i.totalWorkoutsCompleted, target),
  };
}

function makesAchievement(
  key: AchievementKey,
  label: string,
  target: number,
): AchievementDefinition {
  return {
    key,
    family: "volume",
    label,
    description: `${target.toLocaleString("en-US")} shots made across your logged sessions.`,
    measure: countMeasure((i) => i.totalShotMakes, target),
  };
}

function sessionsAchievement(
  key: AchievementKey,
  label: string,
  target: number,
): AchievementDefinition {
  return {
    key,
    family: "volume",
    label,
    description: `${target} shooting sessions logged.`,
    measure: countMeasure((i) => i.totalShotSessions, target),
  };
}

function streakAchievement(
  key: AchievementKey,
  label: string,
  target: number,
): AchievementDefinition {
  return {
    key,
    family: "streak",
    label,
    // Reads off longestStreak, so this stays earned after a rest day. A badge
    // that could un-earn itself overnight would punish taking a day off.
    description: `${target} days of training in a row, at your best run so far.`,
    measure: countMeasure((i) => i.longestStreak, target),
  };
}

function skillAchievement(skill: SkillCategory): AchievementDefinition {
  const label = SKILL_LABELS[skill];
  return {
    key: skillAchievementKey(skill),
    family: "skill",
    label: `${label} Reps: ${SKILL_DRILL_THRESHOLD}`,
    // Wording matters here. This counts work put in; it says nothing about how
    // good the player is, because the app cannot know that.
    description: `${SKILL_DRILL_THRESHOLD} ${label.toLowerCase()} drills completed. Counts the work you put in, not how good you are at it.`,
    measure: countMeasure(
      (i) => i.drillsCompletedBySkill[skill] ?? 0,
      SKILL_DRILL_THRESHOLD,
    ),
  };
}

function loopAchievement(
  key: AchievementKey,
  label: string,
  description: string,
  read: (inputs: AchievementInputs) => number,
): AchievementDefinition {
  return {
    key,
    family: "milestone",
    label,
    description,
    measure: countMeasure(read, 1),
  };
}

const DEFINITION_LIST: AchievementDefinition[] = [
  workoutsAchievement("first_workout", "On the Board", 1),
  workoutsAchievement("workouts_10", "Ten Deep", 10),
  workoutsAchievement("workouts_25", "Twenty-Five In", 25),
  workoutsAchievement("workouts_50", "Fifty Sessions Deep", 50),
  workoutsAchievement("workouts_100", "The Hundred", 100),

  makesAchievement("makes_100", "First Hundred Makes", 100),
  makesAchievement("makes_500", "Five Hundred Up", 500),
  makesAchievement("makes_1000", "A Thousand Makes", 1_000),
  makesAchievement("makes_5000", "Five Thousand Makes", 5_000),

  sessionsAchievement("sessions_5", "Five Sessions Logged", 5),
  sessionsAchievement("sessions_10", "Ten Sessions Logged", 10),
  sessionsAchievement("sessions_25", "Twenty-Five Sessions Logged", 25),

  streakAchievement("streak_3", "Three Days Straight", 3),
  streakAchievement("streak_7", "A Full Week", 7),
  streakAchievement("streak_14", "Two Weeks Unbroken", 14),
  streakAchievement("streak_30", "Thirty Days", 30),
  streakAchievement("streak_60", "Sixty Days", 60),
  streakAchievement("streak_100", "One Hundred Days", 100),

  ...SKILL_CATEGORIES.map((skill) => skillAchievement(skill)),

  loopAchievement(
    "first_session_analyzed",
    "First Session on Record",
    "You recorded a shooting session and logged real shots against it.",
    (i) => i.totalShotSessions,
  ),
  loopAchievement(
    "first_goal_completed",
    "Goal Closed Out",
    "You set a goal and finished it off real training activity.",
    (i) => i.completedGoals,
  ),
  loopAchievement(
    "first_game_film",
    "Film Reviewed",
    "You put game footage through Analyze and got a breakdown back.",
    (i) => i.gameFilmAnalyses,
  ),
  loopAchievement(
    "first_coach_share",
    "Took It to Coach",
    "You shared real session data with Coach and talked it through.",
    (i) => i.coachShares,
  ),
];

/**
 * Keyed by `AchievementKey`, not an array, so adding a key to
 * ACHIEVEMENT_KEYS without writing its definition fails `npm run typecheck`
 * rather than silently shipping a badge nobody can ever earn. Same
 * build-time-not-runtime guarantee as goalService.resolveMetric's `never` guard.
 */
export const ACHIEVEMENTS: Record<AchievementKey, AchievementDefinition> =
  Object.fromEntries(
    DEFINITION_LIST.map((definition) => [definition.key, definition]),
  ) as Record<AchievementKey, AchievementDefinition>;

export function achievementFor(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS[key as AchievementKey];
}

/**
 * Display labels for stamped rows, for the unlock toast.
 *
 * Takes `{ key }` rather than an `AchievementDoc` so this stays isomorphic, and
 * silently drops a key with no definition: a milestone retired from the catalog
 * leaves readable rows in the database (see `AchievementDoc.key`), and those
 * must not surface as "undefined" in a toast.
 */
export function achievementLabels(rows: readonly { key: string }[]): string[] {
  return rows
    .map((row) => achievementFor(row.key)?.label)
    .filter((label): label is string => Boolean(label));
}

export interface AchievementProgress {
  key: AchievementKey;
  definition: AchievementDefinition;
  current: number;
  target: number;
  met: boolean;
  /** 0-100, clamped, for a locked row's progress bar. */
  percent: number;
}

/**
 * Evaluates the whole catalog against real activity, in catalog order.
 *
 * Total and pure: every achievement is reported every time, met or not, so the
 * UI can render locked rows with genuine progress and the caller never has to
 * ask which keys exist.
 */
export function evaluateAchievements(
  inputs: AchievementInputs,
): AchievementProgress[] {
  return ACHIEVEMENT_KEYS.map((key) => {
    const definition = ACHIEVEMENTS[key];
    const { current, target } = definition.measure(inputs);
    return {
      key,
      definition,
      current,
      target,
      met: current >= target,
      percent:
        target <= 0
          ? 0
          : Math.max(0, Math.min(100, Math.round((current / target) * 100))),
    };
  });
}

/**
 * The closest unearned achievement, for "next up" copy.
 *
 * Ranked by how far along the player already is rather than by raw remaining
 * count, so a player 24 drills into a 25-drill milestone is pointed there
 * instead of at a 5,000-make target they have barely started.
 */
export function nextAchievement(
  progress: AchievementProgress[],
): AchievementProgress | null {
  const locked = progress.filter((entry) => !entry.met);
  if (locked.length === 0) return null;
  return locked.reduce((closest, entry) =>
    entry.percent > closest.percent ? entry : closest,
  );
}

/**
 * Every threshold this catalog shares with BRD 7.15's milestone notifications,
 * flattened for the alignment test. Exported rather than inlined in the test so
 * the relationship is visible from the catalog itself.
 */
export const SHARED_MILESTONE_THRESHOLDS = {
  workouts: MILESTONE_THRESHOLDS.workouts,
  streak: MILESTONE_THRESHOLDS.streak,
  shot_sessions: MILESTONE_THRESHOLDS.shot_sessions,
} as const;
