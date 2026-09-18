import "server-only";
import { ObjectId } from "mongodb";
import { gameFootageAnalysesCollection } from "@/server/db/collections";
import type { GameFootageAnalysisDoc } from "@/types/db";

/** Persistence for `gameFootageAnalyses` (BRD 7.7). */
export async function createAnalysis(
  doc: Omit<GameFootageAnalysisDoc, "_id">,
): Promise<GameFootageAnalysisDoc> {
  const collection = await gameFootageAnalysesCollection();
  // Same reason as workoutRepository.createWorkout: this driver's
  // OptionalUnlessRequiredId only relaxes `_id` when the schema declares it
  // optional, and ours requires it.
  const full: GameFootageAnalysisDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

export async function findAnalysisByIdForUser(
  userId: ObjectId,
  analysisId: ObjectId,
): Promise<GameFootageAnalysisDoc | null> {
  const collection = await gameFootageAnalysesCollection();
  return collection.findOne({ _id: analysisId, userId });
}

export async function listAnalysesForUser(
  userId: ObjectId,
): Promise<GameFootageAnalysisDoc[]> {
  const collection = await gameFootageAnalysesCollection();
  return collection.find({ userId }).sort({ uploadedAt: -1 }).toArray();
}

/**
 * How many game films this player has actually uploaded and had analysed.
 *
 * Completed analyses only. Backs the "Film Reviewed" achievement (BRD 7.13):
 * an upload that failed processing produced no breakdown, so crediting it
 * would claim the player reviewed film they never got back. Counts the real
 * act of reviewing film - never anything drawn from the analysis content
 * itself, whatever its provenance.
 */
export async function countCompletedAnalysesForUser(
  userId: ObjectId,
): Promise<number> {
  const collection = await gameFootageAnalysesCollection();
  return collection.countDocuments({ userId, status: "completed" });
}

/** A game film analysis minus its bulky observation arrays. */
export type GameFilmSummary = Omit<
  GameFootageAnalysisDoc,
  "events" | "strengths" | "weaknesses"
>;

/**
 * The player's most recent game film reviews, newest first - for Progress's
 * session history (BRD 7.11).
 *
 * Bounded and projected on the existing {userId, uploadedAt: -1} index. The
 * observation arrays are deliberately projected away: session history lists
 * the *activity* (a review that really happened), never the findings of it,
 * whatever their provenance.
 */
export async function listRecentAnalysesForUser(
  userId: ObjectId,
  limit: number,
): Promise<GameFilmSummary[]> {
  const collection = await gameFootageAnalysesCollection();
  return collection
    .find(
      { userId },
      {
        projection: { events: 0, strengths: 0, weaknesses: 0 },
        sort: { uploadedAt: -1 },
        limit,
      },
    )
    .toArray();
}


export async function completeAnalysis(
  analysisId: ObjectId,
  fields: Pick<
    GameFootageAnalysisDoc,
    | "strengths"
    | "weaknesses"
    | "recommendedWorkoutIds"
    | "basis"
    | "provenance"
    | "events"
    | "framesAnalyzed"
  >,
): Promise<GameFootageAnalysisDoc | null> {
  const collection = await gameFootageAnalysesCollection();
  return collection.findOneAndUpdate(
    { _id: analysisId },
    { $set: { ...fields, status: "completed" } },
    { returnDocument: "after" },
  );
}

export async function failAnalysis(
  analysisId: ObjectId,
  failureReason: string,
): Promise<GameFootageAnalysisDoc | null> {
  const collection = await gameFootageAnalysesCollection();
  return collection.findOneAndUpdate(
    { _id: analysisId },
    { $set: { status: "failed", failureReason } },
    { returnDocument: "after" },
  );
}
