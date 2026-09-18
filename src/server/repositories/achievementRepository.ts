import "server-only";
import { ObjectId } from "mongodb";
import { achievementsCollection } from "@/server/db/collections";
import type { AchievementDoc } from "@/types/db";

/**
 * Persistence for `achievements` (BRD 7.13).
 *
 * Worth restating here because it inverts the usual shape of an achievement
 * table: these rows are **date stamps, not unlock state**. Whether an
 * achievement is earned is derived from the player's real counters every time
 * (`@/lib/achievements`), so a row missing from this collection means only that
 * no date was ever recorded. Nothing in this file may be read as the authority
 * on what a player has earned.
 */

export async function listAchievementsForUser(
  userId: ObjectId,
): Promise<AchievementDoc[]> {
  const collection = await achievementsCollection();
  return collection.find({ userId }).sort({ firstObservedAt: -1 }).toArray();
}

export async function countAchievementsForUser(
  userId: ObjectId,
): Promise<number> {
  const collection = await achievementsCollection();
  return collection.countDocuments({ userId });
}

/**
 * Records the first-observed date for each key, and returns only the rows this
 * call actually created.
 *
 * `$setOnInsert` plus the unique index on `{userId, key}` is what makes this
 * at-most-once: an existing stamp is never overwritten (so a date can't drift
 * later every time the player trains), and a concurrent second call inserts
 * nothing and therefore announces nothing. The returned array is the caller's
 * "what is genuinely new" signal - it drives the unlock toast and the feed
 * card, so it must never include a row that already existed.
 */
export async function stampAchievements(
  userId: ObjectId,
  keys: readonly string[],
  options: { backfilled?: boolean } = {},
): Promise<AchievementDoc[]> {
  if (keys.length === 0) return [];

  const collection = await achievementsCollection();
  const firstObservedAt = new Date();
  const inserted: AchievementDoc[] = [];

  for (const key of keys) {
    const doc: AchievementDoc = {
      _id: new ObjectId(),
      userId,
      key,
      firstObservedAt,
      ...(options.backfilled ? { backfilled: true } : {}),
    };

    const result = await collection.updateOne(
      { userId, key },
      { $setOnInsert: doc },
      { upsert: true },
    );

    // upsertedCount is 1 only when this call created the row. Anything else
    // means someone already stamped it, and re-announcing it would be a lie
    // about when it happened.
    if (result.upsertedCount === 1) inserted.push(doc);
  }

  return inserted;
}
