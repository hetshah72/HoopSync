import "server-only";
import { ObjectId } from "mongodb";
import { confidenceCheckinsCollection } from "@/server/db/collections";
import type { ConfidenceCheckinDoc } from "@/types/db";

/** Persistence for `confidenceCheckins` (BRD 7.10). */
export async function createCheckin(
  doc: Omit<ConfidenceCheckinDoc, "_id">,
): Promise<ConfidenceCheckinDoc> {
  const collection = await confidenceCheckinsCollection();
  const full: ConfidenceCheckinDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

/**
 * `_id` breaks the tie on `createdAt`. Two check-ins can land in the same
 * millisecond - a player tapping through feelings does exactly that - and
 * without a tiebreak "latest" would be whichever the index happened to
 * return. ObjectIds increase with insertion order, so this is stable.
 */
const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

export async function findLatestCheckinForUser(
  userId: ObjectId,
  type: ConfidenceCheckinDoc["type"],
): Promise<ConfidenceCheckinDoc | null> {
  const collection = await confidenceCheckinsCollection();
  return collection.findOne({ userId, type }, { sort: NEWEST_FIRST });
}

/** Ownership-scoped, so a Coach context ref can only ever load its own player's check-in. */
export async function findCheckinByIdForUser(
  userId: ObjectId,
  checkinId: ObjectId,
): Promise<ConfidenceCheckinDoc | null> {
  const collection = await confidenceCheckinsCollection();
  return collection.findOne({ _id: checkinId, userId });
}

export async function listCheckinsForUser(
  userId: ObjectId,
  limit = 20,
): Promise<ConfidenceCheckinDoc[]> {
  const collection = await confidenceCheckinsCollection();
  return collection.find({ userId }).sort(NEWEST_FIRST).limit(limit).toArray();
}

/**
 * One pre-game check-in per player per day, replaced in place.
 *
 * A player picks a feeling, reads the routine, changes their mind, picks
 * another - that is one check-in being revised, not four. Appending a row per
 * tap buried the recovery plan below the read limit and made the history
 * unreadable, so today's row is overwritten instead.
 *
 * Two games in one day would share a row. That is a knowingly accepted
 * trade at this tier: the alternative costs the player a legible history
 * every day to serve a case that mostly doesn't happen.
 */
export async function upsertTodaysPreGameCheckin(
  userId: ObjectId,
  fields: { feeling: ConfidenceCheckinDoc["feeling"]; routine: string },
  window: { dayStart: Date; dayEnd: Date; now: Date },
): Promise<ConfidenceCheckinDoc> {
  const collection = await confidenceCheckinsCollection();
  const result = await collection.findOneAndUpdate(
    // Bounded at both ends. A `$gte dayStart` filter alone would match rows
    // stamped *after* the day being written - which is what a backdated write
    // hits - and silently revise a later day's check-in instead.
    {
      userId,
      type: "pre_game",
      createdAt: { $gte: window.dayStart, $lt: window.dayEnd },
    },
    {
      $set: { ...fields, createdAt: window.now },
      $setOnInsert: { userId, type: "pre_game" as const },
    },
    { upsert: true, returnDocument: "after", sort: NEWEST_FIRST },
  );
  // `returnDocument: "after"` with `upsert` always yields a document.
  return result as ConfidenceCheckinDoc;
}
