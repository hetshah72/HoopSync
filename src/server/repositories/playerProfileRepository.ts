import "server-only";
import type { ObjectId } from "mongodb";
import { playerProfilesCollection } from "@/server/db/collections";
import type { PlayerProfileDoc } from "@/types/db";

export async function findProfileByUserId(
  userId: ObjectId,
): Promise<PlayerProfileDoc | null> {
  const collection = await playerProfilesCollection();
  return collection.findOne({ userId });
}

export type ProfileWrite = Partial<
  Omit<PlayerProfileDoc, "_id" | "userId" | "createdAt" | "updatedAt">
>;

/**
 * Creates the profile on first onboarding submit, or updates it when the
 * player edits their answers later. Upserted by `userId` so it's safe to
 * call more than once.
 *
 * Key semantics, which the profile edit screen depends on:
 * - a key that is **absent** is left untouched (so editing a profile can't
 *   silently wipe `onboardingCompletedAt` and bounce the player back into
 *   the wizard);
 * - a key present with `undefined` is `$unset` - it clears the field.
 *
 * That second case is why this doesn't just spread into `$set`. The driver
 * is constructed without `ignoreUndefined` (`src/server/db/client.ts`), so
 * `$set: { teamName: undefined }` wrote BSON `null` into a field typed as
 * optional-absent - a player who left their team ended up with
 * `teamName: null` rather than no team name at all.
 */
export async function upsertProfile(
  userId: ObjectId,
  data: ProfileWrite,
): Promise<PlayerProfileDoc> {
  const collection = await playerProfilesCollection();
  const now = new Date();

  const set: Record<string, unknown> = { updatedAt: now };
  const unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) unset[key] = "";
    else set[key] = value;
  }

  const result = await collection.findOneAndUpdate(
    { userId },
    {
      $set: set,
      $setOnInsert: { userId, createdAt: now },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!result) {
    throw new Error("Failed to upsert player profile");
  }
  return result;
}
