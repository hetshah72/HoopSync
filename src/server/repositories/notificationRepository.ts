import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { notificationsCollection } from "@/server/db/collections";
import type { NotificationDoc, NotificationType } from "@/types/db";

/** Newest first - what the notifications page renders (BRD 7.15). */
export async function listNotificationsForUser(
  userId: ObjectId,
  limit = 50,
): Promise<NotificationDoc[]> {
  const collection = await notificationsCollection();
  return collection
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Drives the unread badge in the app shell, so it runs on every page render. */
export async function countUnreadForUser(userId: ObjectId): Promise<number> {
  const collection = await notificationsCollection();
  return collection.countDocuments({ userId, readAt: { $exists: false } });
}

export interface NotificationInput {
  userId: ObjectId;
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
  facts: string[];
  createdAt?: Date;
}

/**
 * Raises a notification, or does nothing if one with the same key already
 * exists. Returns the document only when this call is the one that created it,
 * so a caller can tell "raised" from "already there" - which is what keeps the
 * delivery provider from re-sending a nudge on every Home render.
 *
 * `$setOnInsert` with `upsert` rather than find-then-insert: two concurrent
 * evaluations (a phone and a laptop rendering Home at once, or a workout
 * completing while Home is open) both miss a prior read, and only the unique
 * index on {userId, dedupeKey} can decide between them. The duplicate-key error
 * is the expected outcome of that race, not a failure - it means the other
 * caller won, so it is swallowed and reported as "not created".
 */
export async function insertIfAbsent(
  input: NotificationInput,
): Promise<NotificationDoc | null> {
  const collection = await notificationsCollection();
  const doc: NotificationDoc = {
    _id: new ObjectId(),
    userId: input.userId,
    type: input.type,
    dedupeKey: input.dedupeKey,
    title: input.title,
    body: input.body,
    href: input.href,
    facts: input.facts,
    createdAt: input.createdAt ?? new Date(),
  };

  try {
    const result = await collection.findOneAndUpdate(
      { userId: input.userId, dedupeKey: input.dedupeKey },
      { $setOnInsert: doc },
      { upsert: true, returnDocument: "after" },
    );
    // The upsert returns the winner either way, so identity of `_id` is what
    // distinguishes "we inserted this" from "it was already there".
    return result && result._id.equals(doc._id) ? result : null;
  } catch (err) {
    if (isDuplicateKeyError(err)) return null;
    throw err;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === 11000
  );
}

/** Scoped by userId so one account can never read another's notification. */
export async function markRead(
  userId: ObjectId,
  notificationId: ObjectId,
  readAt: Date = new Date(),
): Promise<NotificationDoc | null> {
  const collection = await notificationsCollection();
  return collection.findOneAndUpdate(
    { _id: notificationId, userId, readAt: { $exists: false } },
    { $set: { readAt } },
    { returnDocument: "after" },
  );
}

/** Returns how many were actually flipped, so the caller can skip a no-op refresh. */
export async function markAllRead(
  userId: ObjectId,
  readAt: Date = new Date(),
): Promise<number> {
  const collection = await notificationsCollection();
  const result = await collection.updateMany(
    { userId, readAt: { $exists: false } },
    { $set: { readAt } },
  );
  return result.modifiedCount;
}

export async function deleteNotification(
  userId: ObjectId,
  notificationId: ObjectId,
): Promise<boolean> {
  const collection = await notificationsCollection();
  const result = await collection.deleteOne({ _id: notificationId, userId });
  return result.deletedCount === 1;
}

/**
 * Whether a key has been used before, regardless of read state or deletion.
 *
 * Used only by the once-ever types. Dismissing a "you hit 25 workouts"
 * notification should not make it eligible to fire again, so this reads the
 * collection rather than trusting absence - and deletions are therefore a
 * tombstone-free design decision worth knowing about: a deleted milestone
 * *can* recur. See `deleteNotification`'s caller in notificationService, which
 * is why dismissal marks read instead of deleting for those types.
 */
export async function existsWithKey(
  userId: ObjectId,
  dedupeKey: string,
): Promise<boolean> {
  const collection = await notificationsCollection();
  const filter: Filter<NotificationDoc> = { userId, dedupeKey };
  return (await collection.countDocuments(filter, { limit: 1 })) > 0;
}
