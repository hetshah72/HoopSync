import "server-only";
import type { ObjectId } from "mongodb";
import {
  createCheckin,
  findCheckinByIdForUser,
  findLatestCheckinForUser,
  listCheckinsForUser as listCheckinsRepo,
  upsertTodaysPreGameCheckin,
} from "@/server/repositories/confidenceRepository";
import { dayStampToDate, todayStamp } from "@/lib/day-stamp";
import { listRecentCompletedSessionsForUser } from "@/server/repositories/shotSessionRepository";
import { countCompletedWorkoutsForUser } from "@/server/repositories/workoutRepository";
import { findStatsForUser } from "@/server/repositories/userStatsRepository";
import { routineFor, routineToStoredText } from "@/lib/confidence-routines";
import {
  buildRecoveryPlan,
  type RecoveryPlan,
} from "@/lib/confidence-recovery";
import { rankSkillsByVolume } from "@/lib/skill-metrics";
import type { ConfidenceCheckinDoc, ConfidenceFeeling } from "@/types/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "Before the Game" (BRD 7.10): the player says how they feel, and gets a
 * routine matched to that answer.
 *
 * The routine is stored alongside the feeling rather than looked up on read,
 * so the record shows what the player was actually given at the time even if
 * the routine text is later edited.
 *
 * Revising today's answer replaces today's row rather than appending - see
 * `upsertTodaysPreGameCheckin` for why.
 */
export async function recordPreGameCheckin(
  userId: ObjectId,
  feeling: ConfidenceFeeling,
  now: Date = new Date(),
): Promise<ConfidenceCheckinDoc> {
  const routine = routineFor(feeling);
  const dayStart = dayStampToDate(todayStamp(now));
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return upsertTodaysPreGameCheckin(
    userId,
    { feeling, routine: routineToStoredText(routine) },
    { dayStart, dayEnd, now },
  );
}

/**
 * "After a poor game" (BRD 7.10): positives, areas to improve, and a recovery
 * plan built from the player's *actual* data.
 *
 * Everything is read from real records - the last completed shooting session,
 * workouts finished this week, the streak, and which skills have real drill
 * volume behind them. Nothing is generated, so this is factual, instant, and
 * works with no OpenAI key configured.
 */
export async function createRecoveryCheckin(
  userId: ObjectId,
): Promise<{ checkin: ConfidenceCheckinDoc; plan: RecoveryPlan }> {
  const [sessions, workoutsThisWeek, stats] = await Promise.all([
    listRecentCompletedSessionsForUser(userId, 1),
    countCompletedWorkoutsForUser(userId, {
      completedSince: new Date(Date.now() - WEEK_MS),
    }),
    findStatsForUser(userId),
  ]);

  const session = sessions[0];
  const plan = buildRecoveryPlan({
    session: session
      ? {
          id: session._id.toString(),
          recordedAt: session.recordedAt,
          totalAttempts: session.totalAttempts,
          totalMakes: session.totalMakes,
          fgPercent: session.fgPercent,
          bestZone: session.bestZone,
          weakestZone: session.weakestZone,
          zoneBreakdown: session.zoneBreakdown,
          recommendedWorkoutId: session.recommendedWorkoutId?.toString(),
        }
      : undefined,
    workoutsThisWeek,
    currentStreak: stats?.currentStreak ?? 0,
    topSkills: rankSkillsByVolume(stats?.skillMetrics ?? {}).map((entry) => ({
      skill: entry.skill,
      drillsCompleted: entry.metric.drillsCompleted,
    })),
  });

  const checkin = await createCheckin({
    userId,
    type: "post_game",
    recoveryPlan: {
      positives: plan.positives,
      areasToImprove: plan.areasToImprove,
      planSteps: plan.planSteps,
      isDataBacked: plan.isDataBacked,
    },
    // BRD 7.10: "can recommend reviewing the last session" - stored so the
    // report can link straight to the real session it drew its numbers from,
    // and to the workout that session already generated.
    ...(session ? { relatedSessionId: session._id } : {}),
    ...(session?.recommendedWorkoutId
      ? { relatedWorkoutId: session.recommendedWorkoutId }
      : {}),
    createdAt: new Date(),
  });

  return { checkin, plan };
}

/**
 * The most recent recovery plan.
 *
 * Deliberately an indexed `findOne` rather than scanning a capped list: the
 * page used to read the 20 newest check-ins of *any* type and pick the
 * post-game one out in JS, so enough pre-game check-ins pushed the plan off
 * the end of the window and it silently vanished from the page.
 */
export async function getLatestRecoveryCheckin(
  userId: ObjectId,
): Promise<ConfidenceCheckinDoc | null> {
  const checkin = await findLatestCheckinForUser(userId, "post_game");
  return checkin?.recoveryPlan ? checkin : null;
}

/** One check-in, ownership-scoped - backs the "Talk to Coach" hand-off. */
export async function getCheckinForUser(
  userId: ObjectId,
  checkinId: ObjectId,
): Promise<ConfidenceCheckinDoc | null> {
  return findCheckinByIdForUser(userId, checkinId);
}

export async function getLatestPreGameCheckin(
  userId: ObjectId,
): Promise<ConfidenceCheckinDoc | null> {
  return findLatestCheckinForUser(userId, "pre_game");
}

export async function listCheckinsForUser(
  userId: ObjectId,
): Promise<ConfidenceCheckinDoc[]> {
  return listCheckinsRepo(userId);
}
