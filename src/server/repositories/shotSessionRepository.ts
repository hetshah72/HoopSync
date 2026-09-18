import "server-only";
import { ObjectId } from "mongodb";
import { shotSessionsCollection } from "@/server/db/collections";
import type { MechanicalBreakdown, ShotRecord, ShotSessionDoc, ShotZone } from "@/types/db";

export async function createSession(
  doc: Omit<ShotSessionDoc, "_id">,
): Promise<ShotSessionDoc> {
  const collection = await shotSessionsCollection();
  const full: ShotSessionDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

export async function findSessionByIdForUser(
  userId: ObjectId,
  sessionId: ObjectId,
): Promise<ShotSessionDoc | null> {
  const collection = await shotSessionsCollection();
  return collection.findOne({ _id: sessionId, userId });
}

export async function listSessionsForUser(userId: ObjectId): Promise<ShotSessionDoc[]> {
  const collection = await shotSessionsCollection();
  return collection.find({ userId }).sort({ recordedAt: -1 }).toArray();
}

/**
 * A finalized session minus its embedded `shots` array.
 *
 * Every analysis field the feed needs (zone breakdown, best/weakest zone,
 * FG%, trend call-outs) is computed at finalize time and stored on the
 * session itself, so the per-shot records - by far the largest part of the
 * document - are dead weight for a Home page render.
 */
export type ShotSessionSummary = Omit<ShotSessionDoc, "shots">;

/**
 * The player's most recent finalized sessions, newest first. Hits the
 * existing {userId, recordedAt: -1} index and, unlike `listSessionsForUser`,
 * is bounded and projected - a feed must not load a player's entire shooting
 * history, with every shot, to say one thing about their last session.
 *
 * Filters to `completed` because a session still being tap-logged has no
 * zone breakdown or weakest zone yet.
 */
export async function listRecentCompletedSessionsForUser(
  userId: ObjectId,
  limit: number,
): Promise<ShotSessionSummary[]> {
  const collection = await shotSessionsCollection();
  return collection
    .find(
      { userId, status: "completed" },
      { projection: { shots: 0 }, sort: { recordedAt: -1 }, limit },
    )
    .toArray();
}

/**
 * Lifetime attempts/makes across a set of zones, summed from every completed
 * session's real `zoneBreakdown`. Backs the 3PT% goal (BRD 7.12) - derived
 * from the shots the player actually logged rather than a separate counter
 * that could drift out of sync with them.
 */
export async function aggregateZoneStatsForUser(
  userId: ObjectId,
  zones: readonly ShotZone[],
): Promise<{ attempts: number; makes: number }> {
  const collection = await shotSessionsCollection();
  const sessions = await collection
    .find({ userId, status: "completed" }, { projection: { zoneBreakdown: 1 } })
    .toArray();

  let attempts = 0;
  let makes = 0;
  for (const session of sessions) {
    for (const zone of zones) {
      const stats = session.zoneBreakdown?.[zone];
      if (!stats) continue;
      attempts += stats.attempts;
      makes += stats.makes;
    }
  }
  return { attempts, makes };
}

/**
 * The running totals are kept in step with the shots array on every append
 * and remove, not just at finalize - otherwise a session still being logged
 * reports "0/0 logged so far" on the Analyze hub while its `shots` array
 * already holds real attempts. `finalizeSession` still recomputes both from
 * `shots` authoritatively, so any drift heals there.
 */
export async function appendShot(
  sessionId: ObjectId,
  shot: ShotRecord,
): Promise<ShotSessionDoc | null> {
  const collection = await shotSessionsCollection();
  return collection.findOneAndUpdate(
    { _id: sessionId },
    {
      $push: { shots: shot },
      $inc: { totalAttempts: 1, totalMakes: shot.made ? 1 : 0 },
    },
    { returnDocument: "after" },
  );
}

export async function removeShot(
  sessionId: ObjectId,
  shotId: string,
): Promise<ShotSessionDoc | null> {
  const collection = await shotSessionsCollection();
  // Read the shot first so the counters can be decremented by the right
  // amount - $pull alone can't tell us whether it was a make.
  const existing = await collection.findOne(
    { _id: sessionId },
    { projection: { shots: { $elemMatch: { id: shotId } } } },
  );
  const removed = existing?.shots?.[0];
  if (!removed) return collection.findOne({ _id: sessionId });

  return collection.findOneAndUpdate(
    { _id: sessionId },
    {
      $pull: { shots: { id: shotId } },
      $inc: { totalAttempts: -1, totalMakes: removed.made ? -1 : 0 },
    },
    { returnDocument: "after" },
  );
}

export interface FinalizeFields {
  status: "completed";
  /**
   * Rewritten wholesale at finalize so each shot carries its four-part
   * `feedback` (BRD 7.6). Safe because finalize is the terminal transition -
   * `requireOwnedProcessingSession` rejects a second one, and no shot can be
   * appended after it.
   */
  shots?: ShotRecord[];
  totalAttempts: number;
  totalMakes: number;
  fgPercent: number;
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>;
  bestZone?: ShotZone;
  weakestZone?: ShotZone;
  trendCallouts: string[];
  mechanicalBreakdown?: MechanicalBreakdown;
}

export async function finalizeSession(
  sessionId: ObjectId,
  fields: FinalizeFields,
): Promise<ShotSessionDoc | null> {
  const collection = await shotSessionsCollection();
  return collection.findOneAndUpdate(
    { _id: sessionId },
    { $set: fields },
    { returnDocument: "after" },
  );
}

export async function setRecommendedWorkout(
  sessionId: ObjectId,
  workoutId: ObjectId,
): Promise<void> {
  const collection = await shotSessionsCollection();
  await collection.updateOne(
    { _id: sessionId },
    { $set: { recommendedWorkoutId: workoutId } },
  );
}
