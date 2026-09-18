import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { workoutsCollection } from "@/server/db/collections";
import type {
  SkillCategory,
  WorkoutDoc,
  WorkoutDrillSnapshot,
  WorkoutStatus,
} from "@/types/db";

/**
 * Persistence for the `workouts` collection - shared by Feed's "Start
 * Drill"/"Add to Workout" (P0.3), NBA Player's Signature-Move workout
 * (P0.4), and Train's rule-based multi-drill generation + Active Workout
 * session (P0.5). One collection, one shape, no parallel workout system.
 */
export async function findPendingWorkoutForUser(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne(
    { userId, status: "pending" },
    { sort: { createdAt: -1 } },
  );
}

/**
 * The most recently started workout the player never finished.
 *
 * `in_progress` specifically, not `pending`: a pending workout is one the app
 * generated and nobody has opened, which is just today's suggestion and is
 * already the whole point of the Home feed. An in-progress one is a session
 * they actually started and walked away from - the only one worth a
 * notification, because it names something they did rather than something we
 * suggested (BRD 7.15 "workout reminders").
 */
export async function findUnfinishedWorkoutForUser(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne(
    { userId, status: "in_progress" },
    { sort: { startedAt: -1 } },
  );
}

/**
 * A pending workout that is exactly this one drill.
 *
 * Backs "start this drill" idempotency: tapping the control on a feed card or
 * a signature move repeatedly should return the player to the same workout,
 * not stack up identical pending ones (audit Bug Feed-2 / FEED-07, TRN-13).
 */
export async function findPendingSingleDrillWorkout(
  userId: ObjectId,
  drillId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne(
    { userId, status: "pending", drills: { $size: 1 }, "drills.drillId": drillId },
    { sort: { createdAt: -1 } },
  );
}

export async function findWorkoutByIdForUser(
  userId: ObjectId,
  workoutId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne({ _id: workoutId, userId });
}

/**
 * Counts real completed workouts, optionally within a window or for one
 * skill. Backs goal auto-tracking (BRD 7.12) - counting here rather than
 * keeping yet another denormalized counter means a goal created today can
 * still reflect workouts completed before it existed.
 */
export async function countCompletedWorkoutsForUser(
  userId: ObjectId,
  options: {
    completedSince?: Date;
    /** Exclusive upper bound - with `completedSince`, bounds one window so
     * the feed can compare this week against last week (BRD 7.2 progress
     * summaries). */
    completedBefore?: Date;
    skillCategory?: SkillCategory;
  } = {},
): Promise<number> {
  const collection = await workoutsCollection();
  const filter: Filter<WorkoutDoc> = { userId, status: "completed" };

  if (options.completedSince || options.completedBefore) {
    filter.completedAt = {
      ...(options.completedSince ? { $gte: options.completedSince } : {}),
      ...(options.completedBefore ? { $lt: options.completedBefore } : {}),
    };
  }
  if (options.skillCategory) {
    filter.skillCategory = options.skillCategory;
  }

  return collection.countDocuments(filter);
}

/** Backs "you last trained on ..." feed copy. Uses {userId, completedAt: -1}. */
export async function findLastCompletedWorkoutForUser(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne(
    { userId, status: "completed" },
    { sort: { completedAt: -1 } },
  );
}

/**
 * The recommended workout already generated for this player today, if any.
 *
 * Paired with the unique partial index on {userId, dayStamp}, this is the
 * read half of "generate today's workout at most once" - see
 * `WorkoutDoc.dayStamp`.
 */
export async function findWorkoutForUserOnDay(
  userId: ObjectId,
  dayStamp: string,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne({ userId, dayStamp });
}

/**
 * Drill ids used by this player's most recent workouts, newest first.
 *
 * The daily generator subtracts these so a player doesn't get handed the
 * same four drills every morning - "feed content changes daily" (BRD 7.2)
 * has to survive contact with a deterministic generator that would
 * otherwise return an identical list forever.
 */
export async function listRecentDrillIdsForUser(
  userId: ObjectId,
  workoutLimit: number,
): Promise<ObjectId[]> {
  const collection = await workoutsCollection();
  const workouts = await collection
    .find(
      { userId },
      { projection: { "drills.drillId": 1 }, sort: { createdAt: -1 }, limit: workoutLimit },
    )
    .toArray();
  return workouts.flatMap((workout) => workout.drills.map((d) => d.drillId));
}

/**
 * The player's onboarding starting plan, whatever state it's in.
 *
 * Exactly one is ever created (BRD 7.1's "initial personalized
 * recommendation / starting plan"), so this doubles as the idempotency
 * check for generating it and the read for Home's card.
 */
export async function findOnboardingWorkoutForUser(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOne(
    { userId, "source.type": "onboarding" },
    { sort: { createdAt: -1 } },
  );
}

export async function createWorkout(
  doc: Omit<WorkoutDoc, "_id">,
): Promise<WorkoutDoc> {
  const collection = await workoutsCollection();
  // This driver version's OptionalUnlessRequiredId only relaxes `_id` when
  // the schema type declares it optional; ours requires it, so we generate
  // it ourselves rather than relying on driver-side auto-assignment.
  const full: WorkoutDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

export async function appendDrillToWorkout(
  workoutId: ObjectId,
  drill: WorkoutDrillSnapshot,
  estimatedDurationMinutes: number,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOneAndUpdate(
    { _id: workoutId },
    { $push: { drills: drill }, $set: { estimatedDurationMinutes } },
    { returnDocument: "after" },
  );
}

export async function setWorkoutStatus(
  workoutId: ObjectId,
  status: WorkoutStatus,
  extra: Partial<
    Pick<WorkoutDoc, "startedAt" | "completedAt" | "actualDurationSeconds">
  > = {},
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOneAndUpdate(
    { _id: workoutId },
    { $set: { status, ...extra } },
    { returnDocument: "after" },
  );
}

/**
 * Marking a drill done also clears `skipped`: the two are mutually exclusive
 * states of the same drill, and leaving a stale `skipped: true` on a completed
 * drill would misreport what the player actually did.
 */
export async function setDrillCompletion(
  workoutId: ObjectId,
  order: number,
  completed: boolean,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOneAndUpdate(
    { _id: workoutId, "drills.order": order },
    { $set: { "drills.$.completed": completed, "drills.$.skipped": false } },
    { returnDocument: "after" },
  );
}

export async function setDrillSkipped(
  workoutId: ObjectId,
  order: number,
  skipped: boolean,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOneAndUpdate(
    { _id: workoutId, "drills.order": order },
    skipped
      ? { $set: { "drills.$.skipped": true, "drills.$.completed": false } }
      : { $set: { "drills.$.skipped": false } },
    { returnDocument: "after" },
  );
}

/**
 * Accumulates real time spent on a drill. `$inc` rather than `$set` because
 * the client reports a *delta* since its last report - a player who leaves a
 * drill and comes back should add to their time, not restart it.
 */
export async function addDrillElapsedSeconds(
  workoutId: ObjectId,
  order: number,
  deltaSeconds: number,
): Promise<WorkoutDoc | null> {
  const collection = await workoutsCollection();
  return collection.findOneAndUpdate(
    { _id: workoutId, "drills.order": order },
    { $inc: { "drills.$.elapsedSeconds": deltaSeconds } },
    { returnDocument: "after" },
  );
}

export async function listWorkoutsForUser(userId: ObjectId): Promise<WorkoutDoc[]> {
  const collection = await workoutsCollection();
  return collection.find({ userId }).sort({ createdAt: -1 }).toArray();
}

/** A completed workout minus its embedded drill snapshots. */
export type CompletedWorkoutSummary = Omit<WorkoutDoc, "drills">;

/**
 * The player's most recently completed workouts, newest first - the Progress
 * page's session history (BRD 7.11).
 *
 * Bounded and projected, and hits the existing {userId, completedAt: -1}
 * index. Progress previously reached for `listWorkoutsForUser`, which loads
 * every workout the account has ever had, each carrying its full drill
 * snapshot array, in order to render a handful of rows.
 */
export async function listRecentCompletedWorkoutsForUser(
  userId: ObjectId,
  limit: number,
): Promise<CompletedWorkoutSummary[]> {
  const collection = await workoutsCollection();
  return collection
    .find(
      { userId, status: "completed" },
      { projection: { drills: 0 }, sort: { completedAt: -1 }, limit },
    )
    .toArray();
}
