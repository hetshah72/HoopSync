import "server-only";
import type { ObjectId } from "mongodb";
import {
  countCompletedWorkoutsForUser,
  findLastCompletedWorkoutForUser,
  listRecentDrillIdsForUser,
} from "@/server/repositories/workoutRepository";
import {
  listRecentCompletedSessionsForUser,
  type ShotSessionSummary,
} from "@/server/repositories/shotSessionRepository";
import { listActiveGoalsForUser } from "@/server/repositories/goalRepository";
import { countCompletedAnalysesForUser } from "@/server/repositories/gameFootageRepository";
import { getProfileByUserId } from "@/server/services/profileService";
import { getStatsForUser } from "@/server/services/progressService";
import {
  getAchievementStateForUser,
  type AchievementState,
} from "@/server/services/achievementService";
import { hashKey } from "@/lib/deterministic";
import { dayStampToDate } from "@/lib/day-stamp";
import {
  SESSIONS_IN_SAMPLE,
  resolveStandingZoneSignals,
  type ZoneSignal,
} from "@/lib/shot-zones";
import type {
  GoalDoc,
  PlayerProfileDoc,
  SkillCategory,
  UserStatsDoc,
  WorkoutDoc,
} from "@/types/db";

/** Re-exported so existing `FeedSignals` consumers keep one import site. */
export type { ZoneSignal };

/**
 * Everything the feed is allowed to say about a player, read once.
 *
 * The rule this module exists to enforce: a feed card may only make a claim
 * that appears here, because everything here came out of the player's own
 * records. The audit's worst finding (P0_FINAL_QA §2.3, Bug Feed-1) was a
 * card telling every account - including brand-new ones - that their right
 * wing percentage trailed their left. Signals are nullable precisely so the
 * generator has to handle "we don't know that yet" instead of inventing it.
 */

/** Recent workouts whose drills the daily generator should avoid repeating. */
const RECENT_WORKOUTS_FOR_VARIETY = 3;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface FeedSignals {
  dayStamp: string;
  profile: PlayerProfileDoc | null;
  stats: UserStatsDoc | null;
  activeGoals: GoalDoc[];

  /** Newest finalized session, or null if they've never completed one. */
  latestSession: ShotSessionSummary | null;
  /** Pooled across the last few sessions, not just the newest one. */
  weakestZone: ZoneSignal | null;
  bestZone: ZoneSignal | null;
  sessionsInSample: number;
  totalAttemptsInSample: number;

  lastCompletedWorkout: WorkoutDoc | null;
  workoutsThisWeek: number;
  workoutsLastWeek: number;

  /** Drill ids to avoid when building today's workout. */
  recentDrillIds: ObjectId[];
  /** What today's workout should target, and why. */
  targetSkills: SkillCategory[];
  targetReason: "weak_zone" | "least_trained_focus" | "focus_areas" | "default";

  /** Completed game film reviews - the third kind of real training activity. */
  gameFilmReviews: number;

  /** False for a player who has completed nothing at all yet. */
  hasActivity: boolean;

  /**
   * Achievements/XP (BRD 7.13). Derived, so these are as real as any counter
   * above. `latestUnlock` is the newest *genuinely* earned milestone - never a
   * backfilled one, since the feed must not claim a player just hit something
   * they passed before this feature existed.
   */
  achievements: AchievementState;

  /**
   * Changes exactly when something the activity-derived cards depend on
   * changes. See `FeedItemDoc.signalsFingerprint`.
   */
  fingerprint: string;
}


/**
 * Picks the focus area the player has trained least.
 *
 * Deliberately counts real completed workouts per skill rather than reading
 * `focusAreas` order - a player who declared three focus areas at onboarding
 * and has only ever trained one of them should be pointed at the other two.
 */
async function leastTrainedFocusArea(
  userId: ObjectId,
  focusAreas: SkillCategory[],
): Promise<SkillCategory | null> {
  if (focusAreas.length === 0) return null;

  const counts = await Promise.all(
    focusAreas.map(async (skill) => ({
      skill,
      count: await countCompletedWorkoutsForUser(userId, { skillCategory: skill }),
    })),
  );
  counts.sort((a, b) => a.count - b.count || a.skill.localeCompare(b.skill));
  return counts[0].skill;
}

export async function loadFeedSignals(
  userId: ObjectId,
  dayStamp: string,
): Promise<FeedSignals> {
  const startOfToday = dayStampToDate(dayStamp);
  const weekAgo = new Date(startOfToday.getTime() - WEEK_MS);
  const twoWeeksAgo = new Date(startOfToday.getTime() - 2 * WEEK_MS);

  const [
    profile,
    stats,
    activeGoals,
    sessions,
    lastCompletedWorkout,
    workoutsThisWeek,
    workoutsLastWeek,
    recentDrillIds,
    achievements,
    gameFilmReviews,
  ] = await Promise.all([
    getProfileByUserId(userId),
    getStatsForUser(userId),
    listActiveGoalsForUser(userId),
    listRecentCompletedSessionsForUser(userId, SESSIONS_IN_SAMPLE),
    findLastCompletedWorkoutForUser(userId),
    countCompletedWorkoutsForUser(userId, { completedSince: weekAgo }),
    countCompletedWorkoutsForUser(userId, {
      completedSince: twoWeeksAgo,
      completedBefore: weekAgo,
    }),
    listRecentDrillIdsForUser(userId, RECENT_WORKOUTS_FOR_VARIETY),
    getAchievementStateForUser(userId),
    // Derived from the analyses collection rather than a denormalised counter:
    // it is already indexed by {userId, uploadedAt}, and a count read from the
    // source of truth can't drift out of step with it.
    countCompletedAnalysesForUser(userId),
  ]);

  // Shared with the Progress page so the two can never name different zones
  // for the same player. Enforces MIN_ATTEMPTS_FOR_CALLOUT as a hard floor,
  // which `findBestAndWeakestZones` alone does not - it relaxes its threshold
  // to guarantee a pair, which is right for one session's report but would let
  // a 1-attempt zone become a standing claim here.
  const {
    best,
    weakest,
    totalAttempts: totalAttemptsInSample,
  } = resolveStandingZoneSignals(sessions);

  const focusAreas = profile?.focusAreas ?? [];

  // What today's workout targets, strongest real signal first. Every branch
  // is traceable to something the player did or chose - there is no
  // "surprise me" path.
  let targetSkills: SkillCategory[];
  let targetReason: FeedSignals["targetReason"];
  if (weakest) {
    // All nine zones of the fixed taxonomy are shooting locations, so a zone
    // weakness maps to exactly one skill.
    targetSkills = ["shooting"];
    targetReason = "weak_zone";
  } else {
    const leastTrained = await leastTrainedFocusArea(userId, focusAreas);
    if (leastTrained) {
      targetSkills = [leastTrained];
      targetReason = "least_trained_focus";
    } else if (focusAreas.length > 0) {
      targetSkills = focusAreas;
      targetReason = "focus_areas";
    } else {
      targetSkills = ["shooting"];
      targetReason = "default";
    }
  }

  // Reviewing game film is training activity. Without this a player whose
  // only activity is Game Film reads as having done nothing at all, and every
  // activity-derived card silently declines to render - the feed would be
  // telling them to get started on the day they just uploaded a game.
  const hasActivity =
    (stats?.totalWorkoutsCompleted ?? 0) > 0 ||
    (stats?.totalShotSessions ?? 0) > 0 ||
    gameFilmReviews > 0;

  // Only the values the activity-derived cards actually quote. Adding a
  // field here makes those cards rebuild sooner; omitting one the copy
  // quotes would let the copy go stale.
  const fingerprint = String(
    hashKey(
      [
        stats?.totalWorkoutsCompleted ?? 0,
        stats?.totalShotSessions ?? 0,
        stats?.totalShotMakes ?? 0,
        stats?.totalShotAttempts ?? 0,
        stats?.currentStreak ?? 0,
        sessions[0]?._id.toString() ?? "",
        weakest ? `${weakest.zone}:${weakest.makes}/${weakest.attempts}` : "",
        workoutsThisWeek,
        activeGoals
          .map((goal) => `${goal._id.toString()}:${goal.currentValue}`)
          .join(","),
        // The milestone card needs its own inputs rather than riding the
        // counters above: an unlock can be driven by a completed goal, a game
        // film analysis, or per-skill drill counts, none of which appear here.
        // Without these, finishing a goal would leave yesterday's milestone
        // card in place.
        achievements.latestUnlock?.key ?? "",
        achievements.unlockedCount,
        // A new game film review can flip `hasActivity`, so the cards that
        // depend on it have to rebuild when this moves.
        gameFilmReviews,
      ].join("|"),
    ),
  );

  return {
    dayStamp,
    profile,
    stats,
    activeGoals,
    latestSession: sessions[0] ?? null,
    weakestZone: weakest,
    bestZone: best,
    sessionsInSample: sessions.length,
    totalAttemptsInSample,
    lastCompletedWorkout,
    workoutsThisWeek,
    workoutsLastWeek,
    recentDrillIds,
    targetSkills,
    targetReason,
    gameFilmReviews,
    hasActivity,
    achievements,
    fingerprint,
  };
}
