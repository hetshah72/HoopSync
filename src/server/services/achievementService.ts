import "server-only";
import type { ObjectId } from "mongodb";
import {
  listAchievementsForUser,
  stampAchievements,
} from "@/server/repositories/achievementRepository";
import { countCompletedGoalsForUser } from "@/server/repositories/goalRepository";
import { countCompletedAnalysesForUser } from "@/server/repositories/gameFootageRepository";
import { countSharedAnalysisConversationsForUser } from "@/server/repositories/coachRepository";
import { findStatsForUser } from "@/server/repositories/userStatsRepository";
import {
  evaluateAchievements,
  nextAchievement,
  type AchievementInputs,
  type AchievementProgress,
} from "@/lib/achievements";
import { tierProgressForXp, xpFromInputs, type TierProgress } from "@/lib/training-xp";
import type { AchievementDoc, SkillCategory } from "@/types/db";

/**
 * Achievements and XP (BRD 7.13).
 *
 * The whole feature is *derived*: every read re-evaluates the catalog against
 * the player's real counters, and the only thing this service ever writes is a
 * date stamp for a criterion it has just seen become true. That is what makes
 * the numbers un-driftable and retroactive at the same time - see the note on
 * `AchievementDoc` in src/types/db.ts.
 *
 * Founder constraint on this feature (BRD 7.13): gamification "must never
 * become more prominent than the app's actual development/coaching value". This
 * service therefore raises no notifications of its own - milestone
 * interruptions belong to BRD 7.15 - and exposes only what the Progress tab,
 * the overview line and one low-priority feed card need.
 */

/**
 * Reads everything the catalog needs, in one round of parallel queries.
 *
 * `?? 0` on every optional counter for the documented reason on `UserStatsDoc`:
 * stats documents written before a field existed simply don't carry it, and a
 * player whose stats predate this feature must evaluate as "no progress yet"
 * rather than crash or read as NaN.
 */
export async function loadAchievementInputs(
  userId: ObjectId,
): Promise<AchievementInputs> {
  const [stats, completedGoals, gameFilmAnalyses, coachShares] = await Promise.all([
    findStatsForUser(userId),
    countCompletedGoalsForUser(userId),
    countCompletedAnalysesForUser(userId),
    countSharedAnalysisConversationsForUser(userId),
  ]);

  const drillsCompletedBySkill: Partial<Record<SkillCategory, number>> = {};
  for (const [skill, metric] of Object.entries(stats?.skillMetrics ?? {})) {
    if (metric) drillsCompletedBySkill[skill as SkillCategory] = metric.drillsCompleted;
  }

  return {
    totalWorkoutsCompleted: stats?.totalWorkoutsCompleted ?? 0,
    totalShotSessions: stats?.totalShotSessions ?? 0,
    totalShotMakes: stats?.totalShotMakes ?? 0,
    longestStreak: stats?.longestStreak ?? 0,
    drillsCompletedBySkill,
    completedGoals,
    gameFilmAnalyses,
    coachShares,
  };
}

export interface UnlockedAchievement extends AchievementProgress {
  /** Absent when we hold no stamp, or when the row is backfilled - in both
   *  cases we genuinely don't know when the work was done, so the UI shows no
   *  date rather than a misleading one. */
  earnedAt?: Date;
}

export interface AchievementState {
  xp: number;
  tier: TierProgress;
  unlocked: UnlockedAchievement[];
  locked: AchievementProgress[];
  unlockedCount: number;
  totalCount: number;
  /** The closest unearned achievement, for "next up" copy. Null once all are earned. */
  next: AchievementProgress | null;
  /** Most recently stamped genuine (non-backfilled) unlock, newest first. */
  latestUnlock: UnlockedAchievement | null;
}

/**
 * The read path. Pure with respect to the database: it never writes.
 *
 * That matters because the Progress page is a Server Component, and writing
 * during render is both a Next.js hazard and the kind of hidden side effect
 * that makes a page's behaviour depend on who looked at it. Stamping happens
 * only at the activity choke points below.
 */
export async function getAchievementStateForUser(
  userId: ObjectId,
): Promise<AchievementState> {
  const [inputs, rows] = await Promise.all([
    loadAchievementInputs(userId),
    listAchievementsForUser(userId),
  ]);

  const stamps = new Map(rows.map((row) => [row.key, row]));
  const progress = evaluateAchievements(inputs);

  const unlocked: UnlockedAchievement[] = [];
  const locked: AchievementProgress[] = [];
  for (const entry of progress) {
    if (!entry.met) {
      locked.push(entry);
      continue;
    }
    const row = stamps.get(entry.key);
    unlocked.push({
      ...entry,
      // A backfilled stamp records when we noticed, not when they earned it.
      earnedAt: row && !row.backfilled ? row.firstObservedAt : undefined,
    });
  }

  const latestUnlock =
    unlocked
      .filter((entry) => entry.earnedAt)
      .sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime())[0] ?? null;

  const xp = xpFromInputs(inputs);

  return {
    xp,
    tier: tierProgressForXp(xp),
    unlocked,
    locked,
    unlockedCount: unlocked.length,
    totalCount: progress.length,
    next: nextAchievement(progress),
    latestUnlock,
  };
}

/**
 * The write path, called from the activity choke points that already own the
 * Progress write (workoutService.completeWorkout,
 * shotSessionService.finalizeSession, gameFootageService.analyzeGameFootage) -
 * so no route or action can forget to run it, exactly as with
 * goalService.recalculateGoalsForUser.
 *
 * Returns only genuinely new, announceable unlocks, so a caller can toast them
 * without risking a false claim.
 *
 * The backfill case: an account with **no** stamps at all is one whose history
 * predates this feature (or its first activity under it). Everything already
 * met is stamped `backfilled` and *nothing* is returned - a player who passed
 * 25 workouts last month should see the badge, but must not be told they just
 * earned it. Only later unlocks are announced.
 */
export async function recordNewlyUnlockedAchievements(
  userId: ObjectId,
): Promise<AchievementDoc[]> {
  const [inputs, rows] = await Promise.all([
    loadAchievementInputs(userId),
    listAchievementsForUser(userId),
  ]);

  const stamped = new Set(rows.map((row) => row.key));
  const newlyMet = evaluateAchievements(inputs)
    .filter((entry) => entry.met && !stamped.has(entry.key))
    .map((entry) => entry.key);

  if (newlyMet.length === 0) return [];

  const isFirstEverEvaluation = rows.length === 0;
  const inserted = await stampAchievements(userId, newlyMet, {
    backfilled: isFirstEverEvaluation,
  });

  return isFirstEverEvaluation ? [] : inserted;
}
