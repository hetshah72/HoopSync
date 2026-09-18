import "server-only";
import type { ObjectId } from "mongodb";
import {
  countUnreadForUser,
  deleteNotification as deleteNotificationRepo,
  insertIfAbsent,
  listNotificationsForUser,
  markAllRead as markAllReadRepo,
  markRead as markReadRepo,
  type NotificationInput,
} from "@/server/repositories/notificationRepository";
import { findUnfinishedWorkoutForUser } from "@/server/repositories/workoutRepository";
import { countDrillsCreatedSince } from "@/server/repositories/drillRepository";
import { countLibraryFeedItemsCreatedSince } from "@/server/repositories/feedRepository";
import {
  findProfileByUserId,
  upsertProfile,
} from "@/server/repositories/playerProfileRepository";
import { getNotificationDeliveryProvider } from "@/server/services/notificationDeliveryProvider";
import {
  dedupeKeyFor,
  isTypeEnabled,
  MILESTONE_THRESHOLDS,
  thresholdsCrossed,
  type MilestoneMetric,
} from "@/lib/notification-types";
import {
  gameFilmRecommendationCopy,
  goalCompletedCopy,
  milestoneCopy,
  newContentCopy,
  sessionRecommendationCopy,
  streakAtRiskCopy,
  trainingGapCopy,
  unfinishedWorkoutCopy,
  type NotificationCopy,
} from "@/lib/notification-templates";
import { isWithinQuietHours } from "@/lib/quiet-hours";
import { streakStatus } from "@/lib/streak";
import { daysSince, todayStamp } from "@/lib/day-stamp";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import type {
  GoalDoc,
  NotificationDoc,
  NotificationPreferences,
  NotificationType,
  PlayerProfileDoc,
  UserStatsDoc,
} from "@/types/db";

/**
 * Notifications (BRD 7.15).
 *
 * Two kinds of trigger, and the split is the whole design:
 *
 *   event-triggered   raised from the service choke points that already know
 *                     what changed - a workout completing, a goal flipping to
 *                     completed, an analysis finishing. Because those call
 *                     sites hold the *previous* value as well as the new one,
 *                     a milestone can be detected at the moment it is crossed.
 *
 *   time-triggered    raised on read, from the signals Home already loaded,
 *                     keyed by calendar day so each can fire at most once a
 *                     day.
 *
 * That split is what removes the need for any backfill bookkeeping. There is no
 * "already awarded" set and no migration: a counter can only cross a threshold
 * while it is moving, so a player who already has 40 workouts the day this
 * ships is never told they reached 10. And a day-keyed reminder cannot be
 * raised for a day that has passed. The unique index on {userId, dedupeKey}
 * does the rest.
 *
 * There is still no scheduler in this codebase and this does not add one - the
 * same trade recorded on `FeedItemDoc.signalsFingerprint` and in
 * feedGenerationService's header. The cost is that a time-triggered nudge
 * appears when the player next opens the app rather than at 6pm sharp, which
 * for an in-app notification centre is exactly when they could have seen it
 * anyway.
 */

/** A day with no training at all before we mention the gap. */
const TRAINING_GAP_DAYS = 3;

/** A streak worth protecting. One day is not a streak worth pressuring a kid about. */
const MIN_STREAK_FOR_REMINDER = 2;

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  facts: string[];
  read: boolean;
  createdAt: string;
}

function toView(doc: NotificationDoc): NotificationView {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    href: doc.href,
    facts: doc.facts,
    read: Boolean(doc.readAt),
    createdAt: doc.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listNotifications(
  userId: ObjectId,
): Promise<NotificationView[]> {
  return (await listNotificationsForUser(userId)).map(toView);
}

/**
 * The unread badge.
 *
 * Called from the app-shell layout, which renders on every signed-in page, so
 * it is one indexed count and nothing more. The layout wraps it so a database
 * failure shows no badge rather than taking down every screen - see the note
 * there.
 */
export async function countUnreadNotifications(
  userId: ObjectId,
): Promise<number> {
  return countUnreadForUser(userId);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function markNotificationRead(
  userId: ObjectId,
  notificationId: ObjectId,
): Promise<void> {
  // A no-op when it was already read - re-marking is not an error, and the
  // player may well have it open in two tabs.
  await markReadRepo(userId, notificationId);
}

export async function markAllNotificationsRead(
  userId: ObjectId,
): Promise<number> {
  return markAllReadRepo(userId);
}

export async function dismissNotification(
  userId: ObjectId,
  notificationId: ObjectId,
): Promise<void> {
  const deleted = await deleteNotificationRepo(userId, notificationId);
  if (!deleted) {
    throw new NotFoundError("Notification not found.");
  }
}

/**
 * Raises a batch, skipping anything switched off or already present, then hands
 * whatever was genuinely new to the delivery provider.
 *
 * Preference filtering happens here rather than at each call site so a type
 * that is off is off everywhere, including from the event triggers.
 */
async function raise(
  userId: ObjectId,
  preferences: NotificationPreferences | undefined,
  drafts: Array<{
    type: NotificationType;
    dedupeKey: string;
    href: string;
    copy: NotificationCopy;
  }>,
  now: Date,
): Promise<NotificationDoc[]> {
  const created: NotificationDoc[] = [];

  for (const draft of drafts) {
    if (!isTypeEnabled(draft.type, preferences)) continue;

    const input: NotificationInput = {
      userId,
      type: draft.type,
      dedupeKey: draft.dedupeKey,
      title: draft.copy.title,
      body: draft.copy.body,
      href: draft.href,
      facts: draft.copy.facts,
      createdAt: now,
    };
    const doc = await insertIfAbsent(input);
    if (doc) created.push(doc);
  }

  if (created.length > 0) {
    await getNotificationDeliveryProvider().deliver(created, {
      preferences,
      now,
    });
  }

  return created;
}

/**
 * Event and time triggers alike run off the back of something else - a workout
 * completing, a Home render - and none of them is worth failing that operation
 * for. Every public entry point below funnels through this.
 */
async function bestEffort<T>(
  label: string,
  userId: ObjectId,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    logger.error({ userId: userId.toString(), err }, `Notifications: ${label}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event triggers
// ---------------------------------------------------------------------------

/**
 * Milestones, detected at the moment a counter moves past them.
 *
 * Takes the stats document from *before* the activity as well as after, which
 * is what `progressService` already has in hand on both completion paths. That
 * is the entire reason milestones need no "already awarded" record.
 *
 * The longest-streak milestone is handled separately from the streak-length
 * one: "30 days in a row" is about the run, "your longest streak yet" is about
 * beating a personal best, and a player can do both at once.
 */
export async function notifyProgressMilestones(
  userId: ObjectId,
  previous: UserStatsDoc | null,
  next: UserStatsDoc,
): Promise<void> {
  await bestEffort("milestone emit failed", userId, async () => {
    const preferences = (await findProfileByUserId(userId))
      ?.notificationPreferences;
    const now = new Date();

    const crossings: Array<{ metric: MilestoneMetric; threshold: number }> = [];

    const push = (metric: Exclude<MilestoneMetric, "longest_streak">, from: number, to: number) => {
      for (const threshold of thresholdsCrossed(
        MILESTONE_THRESHOLDS[metric],
        from,
        to,
      )) {
        crossings.push({ metric, threshold });
      }
    };

    push("streak", previous?.currentStreak ?? 0, next.currentStreak);
    push(
      "workouts",
      previous?.totalWorkoutsCompleted ?? 0,
      next.totalWorkoutsCompleted,
    );
    push(
      "shot_sessions",
      previous?.totalShotSessions ?? 0,
      next.totalShotSessions,
    );

    // A personal best only counts once it is worth remarking on; congratulating
    // someone on a "longest streak" of 2 is noise.
    const previousLongest = previous?.longestStreak ?? 0;
    if (next.longestStreak > previousLongest && next.longestStreak >= 7) {
      crossings.push({
        metric: "longest_streak",
        threshold: next.longestStreak,
      });
    }

    await raise(
      userId,
      preferences,
      crossings.map(({ metric, threshold }) => ({
        type: "progress_milestone" as const,
        dedupeKey: dedupeKeyFor.milestone(metric, threshold),
        href: "/progress",
        copy: milestoneCopy({ metric, threshold }),
      })),
      now,
    );
  });
}

/**
 * Goals that just finished.
 *
 * Fed from `recalculateGoalsForUser`'s return value, which is a genuine
 * transition to completed. Deliberately not fired from goal *creation*, which
 * seeds `currentValue` from activity that already happened and can therefore
 * mint a goal that is complete on its first day - that is not an achievement to
 * announce.
 */
export async function notifyGoalsCompleted(
  userId: ObjectId,
  goals: GoalDoc[],
): Promise<void> {
  if (goals.length === 0) return;

  await bestEffort("goal emit failed", userId, async () => {
    const preferences = (await findProfileByUserId(userId))
      ?.notificationPreferences;

    await raise(
      userId,
      preferences,
      goals.map((goal) => ({
        type: "goal_update" as const,
        dedupeKey: dedupeKeyFor.goalCompleted(goal._id.toString()),
        href: "/progress",
        copy: goalCompletedCopy({
          goalTitle: goal.title,
          targetValue: goal.targetValue,
          unit: goal.unit,
        }),
      })),
      new Date(),
    );
  });
}

/** The startable workout a finalized shooting session produced. */
export async function notifySessionRecommendation(input: {
  userId: ObjectId;
  sessionId: ObjectId;
  zoneLabel: string;
  makes: number;
  attempts: number;
  fgPercent: number;
}): Promise<void> {
  const { userId, sessionId, ...stats } = input;

  await bestEffort("session recommendation emit failed", userId, async () => {
    const preferences = (await findProfileByUserId(userId))
      ?.notificationPreferences;

    await raise(
      userId,
      preferences,
      [
        {
          type: "coach_recommendation" as const,
          dedupeKey: dedupeKeyFor.coachRecommendation(sessionId.toString()),
          href: `/analyze/shooting/${sessionId.toString()}`,
          copy: sessionRecommendationCopy(stats),
        },
      ],
      new Date(),
    );
  });
}

/** The same, for a completed game film analysis. */
export async function notifyGameFilmRecommendation(input: {
  userId: ObjectId;
  analysisId: ObjectId;
  weaknessLabel: string;
  workoutCount: number;
}): Promise<void> {
  const { userId, analysisId, ...details } = input;

  await bestEffort("game film recommendation emit failed", userId, async () => {
    const preferences = (await findProfileByUserId(userId))
      ?.notificationPreferences;

    await raise(
      userId,
      preferences,
      [
        {
          type: "coach_recommendation" as const,
          dedupeKey: dedupeKeyFor.coachRecommendation(analysisId.toString()),
          href: `/analyze/game-film/${analysisId.toString()}`,
          copy: gameFilmRecommendationCopy(details),
        },
      ],
      new Date(),
    );
  });
}

// ---------------------------------------------------------------------------
// Time triggers
// ---------------------------------------------------------------------------

/**
 * What the time-triggered evaluators need. A deliberately small subset of
 * `FeedSignals` so the caller can hand over what it already loaded without this
 * module depending on the feed's shape.
 */
export interface ScheduledSignals {
  stats: UserStatsDoc | null;
  lastCompletedWorkoutAt?: Date;
  hasActivity: boolean;
}

/**
 * The three reminders, evaluated against signals the caller already has.
 *
 * Called from `feedService.getPersonalizedFeed`, which computes exactly these
 * signals for feed generation - so this costs three guarded upserts and no
 * extra reads. Home is also the right place for it: it is where a returning
 * player lands.
 *
 * Quiet hours applies here and only here. An event-triggered notification is a
 * receipt for something the player just did, and withholding that until morning
 * would be odd; a reminder is exactly the thing someone means to silence.
 */
export async function evaluateScheduledNotifications(
  userId: ObjectId,
  signals: ScheduledSignals,
  now: Date = new Date(),
): Promise<NotificationDoc[]> {
  const result = await bestEffort("scheduled evaluation failed", userId, async () => {
    const profile = await findProfileByUserId(userId);
    const preferences = profile?.notificationPreferences;

    if (isWithinQuietHours(now, preferences)) return [];

    const dayStamp = todayStamp(now);
    const drafts: Array<{
      type: NotificationType;
      dedupeKey: string;
      href: string;
      copy: NotificationCopy;
    }> = [];

    const workout = await draftWorkoutReminder(userId, signals, dayStamp, now);
    if (workout) drafts.push(workout);

    const streak = draftStreakReminder(signals, dayStamp, now);
    if (streak) drafts.push(streak);

    const content = await draftNewContent(profile, dayStamp, now);
    if (content) drafts.push(content);

    const created = await raise(userId, preferences, drafts, now);

    // The content watermark moves only once a notification about that content
    // genuinely exists. Advancing it at draft time instead looks equivalent and
    // isn't: the day-keyed dedupe means a second Home view on the same day
    // produces a draft that is then dropped, and anything added between the two
    // views would have been stepped over and never announced at all.
    if (content && created.some((doc) => doc.type === "new_content")) {
      await upsertProfile(userId, { notificationsContentSeenAt: now });
    }

    return created;
  });

  return result ?? [];
}

async function draftWorkoutReminder(
  userId: ObjectId,
  signals: ScheduledSignals,
  dayStamp: string,
  now: Date,
) {
  // A session they actually started beats a generic "come back" every time, so
  // it is checked first and wins outright.
  const unfinished = await findUnfinishedWorkoutForUser(userId);
  if (unfinished) {
    // `skipped` is deliberately distinct from "not completed" on this shape:
    // a skipped drill was passed over on purpose, so it isn't work remaining.
    const remaining = unfinished.drills.filter(
      (drill) => !drill.completed && !drill.skipped,
    ).length;
    if (remaining > 0) {
      return {
        type: "workout_reminder" as const,
        dedupeKey: dedupeKeyFor.workoutReminder(dayStamp),
        href: `/train/${unfinished._id.toString()}`,
        copy: unfinishedWorkoutCopy({
          label: unfinished.source.label,
          drillsRemaining: remaining,
          daysSinceStarted: unfinished.startedAt
            ? daysSince(unfinished.startedAt, now)
            : 0,
        }),
      };
    }
  }

  // Nothing half-finished. Only mention a gap for someone who has trained
  // before - telling a player who has never completed a workout that it has
  // been three days is both useless and faintly rude, and the feed's own
  // "start with one workout" card already covers them.
  if (!signals.hasActivity || !signals.lastCompletedWorkoutAt) return null;

  const gap = daysSince(signals.lastCompletedWorkoutAt, now);
  if (gap < TRAINING_GAP_DAYS) return null;

  return {
    type: "workout_reminder" as const,
    dedupeKey: dedupeKeyFor.workoutReminder(dayStamp),
    href: "/train",
    copy: trainingGapCopy({ daysSinceLastWorkout: gap }),
  };
}

function draftStreakReminder(
  signals: ScheduledSignals,
  dayStamp: string,
  now: Date,
) {
  const stats = signals.stats;
  if (!stats) return null;

  // `streakStatus` rather than `currentStreak`: the stored counter decays
  // lazily, so a lapsed streak still reads as whatever it was on its last day.
  // "at_risk" is the single day where the reminder is both true and useful.
  const status = streakStatus(
    {
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      lastActivityDate: stats.lastActivityDate,
    },
    now,
  );
  if (status !== "at_risk") return null;
  if (stats.currentStreak < MIN_STREAK_FOR_REMINDER) return null;

  return {
    type: "streak_reminder" as const,
    dedupeKey: dedupeKeyFor.streakReminder(dayStamp),
    href: "/train",
    copy: streakAtRiskCopy({ currentStreak: stats.currentStreak }),
  };
}

/**
 * New library content since the player last heard about any.
 *
 * Pure of writes apart from the first-run case: the caller advances the
 * watermark only if the notification this returns actually gets created. See
 * the note at that call site for why the distinction matters.
 *
 * The first evaluation sets the watermark and announces nothing, so nobody is
 * ever told that the entire seeded library is new. That write is unconditional
 * because there is no notification to tie it to.
 */
async function draftNewContent(
  profile: PlayerProfileDoc | null,
  dayStamp: string,
  now: Date,
) {
  if (!profile) return null;

  const watermark = profile.notificationsContentSeenAt;
  if (!watermark) {
    await upsertProfile(profile.userId, { notificationsContentSeenAt: now });
    return null;
  }

  const [drillCount, lessonCount] = await Promise.all([
    countDrillsCreatedSince(watermark),
    countLibraryFeedItemsCreatedSince(watermark),
  ]);
  if (drillCount + lessonCount === 0) return null;

  return {
    type: "new_content" as const,
    dedupeKey: dedupeKeyFor.newContent(dayStamp),
    href: drillCount > 0 ? "/train" : "/home",
    copy: newContentCopy({ drillCount, lessonCount }),
  };
}
