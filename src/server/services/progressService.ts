import "server-only";
import type { ObjectId } from "mongodb";
import {
  findStatsForUser,
  saveStats,
} from "@/server/repositories/userStatsRepository";
import {
  countCompletedWorkoutsForUser,
  listRecentCompletedWorkoutsForUser,
  listWorkoutsForUser,
} from "@/server/repositories/workoutRepository";
import { listRecentCompletedSessionsForUser } from "@/server/repositories/shotSessionRepository";
import { listRecentAnalysesForUser } from "@/server/repositories/gameFootageRepository";
import { getProfileByUserId } from "@/server/services/profileService";
import { computeNextStreak } from "@/lib/streak";
import {
  applyWorkoutToSkillMetrics,
  computeSkillMetricsFromWorkouts,
  type SkillMetrics,
} from "@/lib/skill-metrics";
import {
  SESSIONS_IN_SAMPLE,
  fgPercent,
  resolveStandingZoneSignals,
  type ZoneBreakdown,
  type ZoneSignal,
} from "@/lib/shot-zones";
import {
  mergeActivityHistory,
  type ActivityEntry,
} from "@/lib/activity-history";
import { notifyProgressMilestones } from "@/server/services/notificationService";
import type { SkillCategory, UserStatsDoc, WorkoutDoc } from "@/types/db";

export async function getStatsForUser(userId: ObjectId): Promise<UserStatsDoc | null> {
  return findStatsForUser(userId);
}

/**
 * The Train -> Progress connection (BRD 7.3/7.11): completing a workout
 * must update Progress with no manual re-entry. Called once, from
 * workoutService.completeWorkout - not from the route/action layer, so
 * every completion path (however Train evolves) stays consistent.
 *
 * Goal auto-tracking reads this same `userStats` document; this function
 * only owns the workout-completion side of it.
 */
export async function recordWorkoutCompletion(
  userId: ObjectId,
  workout?: Pick<WorkoutDoc, "drills" | "completedAt">,
): Promise<UserStatsDoc> {
  const existing = await findStatsForUser(userId);
  const today = new Date();

  const nextStreak = computeNextStreak(
    {
      currentStreak: existing?.currentStreak ?? 0,
      longestStreak: existing?.longestStreak ?? 0,
      lastActivityDate: existing?.lastActivityDate,
    },
    today,
  );

  // Only the fields this path owns. `saveStats` patches rather than replaces,
  // so the shooting totals maintained by recordShotSessionCompletion are left
  // untouched instead of being re-carried (and potentially zeroed) here.
  const next = await saveStats(userId, {
    currentStreak: nextStreak.currentStreak,
    longestStreak: nextStreak.longestStreak,
    totalWorkoutsCompleted: (existing?.totalWorkoutsCompleted ?? 0) + 1,
    ...(workout
      ? {
          skillMetrics: applyWorkoutToSkillMetrics(
            existing?.skillMetrics ?? {},
            workout,
            // The workout's own completion time, not a fresh `new Date()`, so
            // this write is bit-for-bit what recomputeSkillMetricsForUser
            // derives from the same record.
            workout.completedAt ?? today,
          ),
        }
      : {}),
    lastActivityDate: nextStreak.lastActivityDate,
    updatedAt: today,
  });

  // Milestones are raised here, with both the before and after documents in
  // hand, which is the whole reason they need no "already awarded" record:
  // a counter can only cross a threshold at the moment it moves past one.
  // Best-effort by construction (see notifyProgressMilestones) - a
  // notification must never cost the player their completed workout.
  await notifyProgressMilestones(userId, existing, next);

  return next;
}

/**
 * Reviewing game film is real training activity, so it keeps a streak alive
 * (BRD 7.11: Progress must be driven by real activity).
 *
 * Deliberately touches *only* the streak. It is not a shooting session, so it
 * must not increment `totalShotSessions` or the shot totals - a player who
 * uploaded game footage did not take any shots, and Progress would be lying
 * if it said otherwise.
 */
export async function recordGameFilmActivity(
  userId: ObjectId,
): Promise<UserStatsDoc> {
  const existing = await findStatsForUser(userId);
  const today = new Date();

  const nextStreak = computeNextStreak(
    {
      currentStreak: existing?.currentStreak ?? 0,
      longestStreak: existing?.longestStreak ?? 0,
      lastActivityDate: existing?.lastActivityDate,
    },
    today,
  );

  const next = await saveStats(userId, {
    currentStreak: nextStreak.currentStreak,
    longestStreak: nextStreak.longestStreak,
    lastActivityDate: nextStreak.lastActivityDate,
    updatedAt: today,
  });

  // Film review extends the streak, so it can cross a streak milestone too -
  // the counters it doesn't own simply don't move, and `thresholdsCrossed`
  // returns nothing for them.
  await notifyProgressMilestones(userId, existing, next);

  return next;
}

/**
 * Rebuilds per-skill metrics from the `workouts` collection, which is the real
 * source of truth, and writes the result back.
 *
 * Two jobs: backfilling accounts whose stats predate skill tracking, and
 * giving tests a way to assert the incrementally-maintained counters match a
 * from-scratch recomputation - the guarantee that makes a denormalized counter
 * safe to read.
 */
export async function recomputeSkillMetricsForUser(
  userId: ObjectId,
): Promise<UserStatsDoc> {
  const workouts = await listWorkoutsForUser(userId);
  return saveStats(userId, {
    skillMetrics: computeSkillMetricsFromWorkouts(workouts),
    updatedAt: new Date(),
  });
}

/**
 * The Analyze -> Progress connection (BRD 7.11 / v1.1 §7 "Shot Session ->
 * Shooting Stats"). Called once, from shotSessionService.finalizeSession,
 * for the same reason recordWorkoutCompletion is called from the service
 * layer: every completion path stays consistent.
 *
 * A finalized shooting session counts as training activity, so it advances
 * the streak exactly like a completed workout does - otherwise a player who
 * only shoots would show a broken streak despite training every day.
 */
export async function recordShotSessionCompletion(
  userId: ObjectId,
  session: { totalAttempts: number; totalMakes: number },
): Promise<UserStatsDoc> {
  const existing = await findStatsForUser(userId);
  const today = new Date();

  const nextStreak = computeNextStreak(
    {
      currentStreak: existing?.currentStreak ?? 0,
      longestStreak: existing?.longestStreak ?? 0,
      lastActivityDate: existing?.lastActivityDate,
    },
    today,
  );

  // As above: only the fields this path owns. `totalWorkoutsCompleted` and
  // `skillMetrics` belong to the workout path and are deliberately absent.
  const next = await saveStats(userId, {
    currentStreak: nextStreak.currentStreak,
    longestStreak: nextStreak.longestStreak,
    totalShotSessions: (existing?.totalShotSessions ?? 0) + 1,
    totalShotAttempts:
      (existing?.totalShotAttempts ?? 0) + session.totalAttempts,
    totalShotMakes: (existing?.totalShotMakes ?? 0) + session.totalMakes,
    lastActivityDate: nextStreak.lastActivityDate,
    updatedAt: today,
  });

  await notifyProgressMilestones(userId, existing, next);

  return next;
}

/* ------------------------------------------------------------------ *
 * Read side: everything the Progress page renders (BRD 7.11).
 * ------------------------------------------------------------------ */

/** How many rows the session history shows before it needs paging. */
const HISTORY_LIMIT = 12;

/**
 * Everything BRD 7.11 requires Progress to display, read in one pass.
 *
 * Every field is either a counter the player's own activity wrote, or a
 * derivation over records they created. There is deliberately no generated
 * narrative here: the honesty bar that keeps `skillMetrics` a volume count
 * rather than a 0-100 rating applies just as much to "improvements and
 * remaining weaknesses", so the weakness surface is a real zone with its real
 * sample attached, or it is null.
 */
export interface ProgressOverview {
  stats: UserStatsDoc | null;

  /** Lifetime FG% - undefined when they have never logged an attempt. */
  lifetimeFgPercent?: number;
  /** Pooled zone totals across the recent sessions in the sample. */
  pooledZones: ZoneBreakdown;

  /**
   * Standing strength/weakness, or null when the sample is too thin to make
   * the claim honestly. Shared derivation with the Feed, so the two cannot
   * name different zones for the same player.
   */
  strength: ZoneSignal | null;
  weakness: ZoneSignal | null;
  sessionsInSample: number;
  totalAttemptsInSample: number;

  /** Real week-over-week training volume - the only "improvement" claimed. */
  workoutsThisWeek: number;
  workoutsLastWeek: number;

  /**
   * The focus area the player chose at onboarding and has trained least.
   * Null when they declared no focus areas.
   */
  leastTrainedFocus: {
    skill: SkillCategory;
    drillsCompleted: number;
  } | null;

  history: ActivityEntry[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Least-trained declared focus area, by real completed drill volume.
 *
 * Reads `skillMetrics` rather than counting workouts, because that is what
 * the Skill Development panel above it shows - the two must not disagree
 * about which skill has had the least work.
 */
function leastTrainedFocusArea(
  focusAreas: SkillCategory[],
  skillMetrics: SkillMetrics,
): ProgressOverview["leastTrainedFocus"] {
  if (focusAreas.length === 0) return null;

  return focusAreas
    .map((skill) => ({
      skill,
      drillsCompleted: skillMetrics[skill]?.drillsCompleted ?? 0,
    }))
    .sort(
      (a, b) =>
        a.drillsCompleted - b.drillsCompleted || a.skill.localeCompare(b.skill),
    )[0];
}

function workoutMinutes(seconds?: number): string | undefined {
  if (!seconds) return undefined;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export async function getProgressOverview(
  userId: ObjectId,
): Promise<ProgressOverview> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const twoWeeksAgo = new Date(now.getTime() - 2 * WEEK_MS);

  const [
    stats,
    profile,
    sessions,
    recentWorkouts,
    recentFilms,
    workoutsThisWeek,
    workoutsLastWeek,
  ] = await Promise.all([
    findStatsForUser(userId),
    getProfileByUserId(userId),
    listRecentCompletedSessionsForUser(userId, SESSIONS_IN_SAMPLE),
    listRecentCompletedWorkoutsForUser(userId, HISTORY_LIMIT),
    listRecentAnalysesForUser(userId, HISTORY_LIMIT),
    countCompletedWorkoutsForUser(userId, { completedSince: weekAgo }),
    countCompletedWorkoutsForUser(userId, {
      completedSince: twoWeeksAgo,
      completedBefore: weekAgo,
    }),
  ]);

  const { pooled, best, weakest, totalAttempts } =
    resolveStandingZoneSignals(sessions);

  const attempts = stats?.totalShotAttempts ?? 0;
  const makes = stats?.totalShotMakes ?? 0;

  const history = mergeActivityHistory(
    [
      ...recentWorkouts.map((w) => ({
        id: w._id.toString(),
        kind: "workout" as const,
        // `completedAt` is set by setWorkoutStatus on completion; the filter
        // guarantees status "completed", so the fallback is defensive only.
        occurredAt: w.completedAt ?? w.createdAt,
        label: w.source.label,
        detail: workoutMinutes(w.actualDurationSeconds),
        href: `/train/${w._id.toString()}`,
      })),
      ...sessions.map((s) => ({
        id: s._id.toString(),
        kind: "shot_session" as const,
        occurredAt: s.recordedAt,
        label: "Shooting session",
        detail: `${s.totalMakes}/${s.totalAttempts} - ${s.fgPercent}%`,
        href: `/analyze/shooting/${s._id.toString()}`,
      })),
      // Listed as an activity the player really did. None of the analysis
      // itself appears here - those findings carry `isSimulated: true`.
      ...recentFilms.map((f) => ({
        id: f._id.toString(),
        kind: "game_film" as const,
        occurredAt: f.uploadedAt,
        label: "Game film review",
        href: `/analyze/game-film/${f._id.toString()}`,
      })),
    ],
    HISTORY_LIMIT,
  );

  return {
    stats,
    lifetimeFgPercent: attempts > 0 ? fgPercent(makes, attempts) : undefined,
    pooledZones: pooled,
    strength: best,
    weakness: weakest,
    sessionsInSample: sessions.length,
    totalAttemptsInSample: totalAttempts,
    workoutsThisWeek,
    workoutsLastWeek,
    leastTrainedFocus: leastTrainedFocusArea(
      profile?.focusAreas ?? [],
      stats?.skillMetrics ?? {},
    ),
    history,
  };
}
