import "server-only";
import type { ObjectId } from "mongodb";
import { userStatsCollection } from "@/server/db/collections";
import type { UserStatsDoc } from "@/types/db";

export async function findStatsForUser(userId: ObjectId): Promise<UserStatsDoc | null> {
  const collection = await userStatsCollection();
  return collection.findOne({ userId });
}

/**
 * Partial by design. This used to require the *whole* field object, so every
 * caller had to re-carry every counter (`existing?.x ?? 0`) and any field a
 * caller forgot was silently zeroed by the other completion path. Taking a
 * patch means a writer only states what it actually owns.
 */
export async function saveStats(
  userId: ObjectId,
  fields: Partial<Omit<UserStatsDoc, "_id" | "userId">>,
): Promise<UserStatsDoc> {
  const collection = await userStatsCollection();

  // Because a patch may legitimately omit counters it doesn't own, a brand-new
  // document has to be seeded with every required counter - otherwise a player
  // whose first-ever activity is a shooting session would get a stats document
  // with no `totalWorkoutsCompleted` at all, which the type says is a number.
  // Only applied on insert, so it can never reset a live counter.
  const defaults: Partial<UserStatsDoc> = {
    currentStreak: 0,
    longestStreak: 0,
    totalWorkoutsCompleted: 0,
    totalShotSessions: 0,
    totalShotAttempts: 0,
    totalShotMakes: 0,
  };
  const insertOnly = Object.fromEntries(
    Object.entries(defaults).filter(([key]) => !(key in fields)),
  );

  const result = await collection.findOneAndUpdate(
    { userId },
    { $set: fields, $setOnInsert: { userId, ...insertOnly } },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) {
    throw new Error("Failed to upsert user stats");
  }
  return result;
}
