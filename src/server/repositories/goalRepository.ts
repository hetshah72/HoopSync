import "server-only";
import { ObjectId } from "mongodb";
import { goalsCollection } from "@/server/db/collections";
import type { GoalDoc, GoalStatus } from "@/types/db";

export async function listActiveGoalsForUser(userId: ObjectId): Promise<GoalDoc[]> {
  const collection = await goalsCollection();
  return collection.find({ userId, status: "active" }).toArray();
}

/** Newest first - what the Goals tab renders (BRD 7.12). */
export async function listGoalsForUser(userId: ObjectId): Promise<GoalDoc[]> {
  const collection = await goalsCollection();
  return collection.find({ userId }).sort({ createdAt: -1 }).toArray();
}

/**
 * Goals this player has actually finished. Backs the "Goal Closed Out"
 * achievement (BRD 7.13), and rides the existing {userId, status} index.
 */
export async function countCompletedGoalsForUser(
  userId: ObjectId,
): Promise<number> {
  const collection = await goalsCollection();
  return collection.countDocuments({ userId, status: "completed" });
}

export async function findGoalByIdForUser(
  userId: ObjectId,
  goalId: ObjectId,
): Promise<GoalDoc | null> {
  const collection = await goalsCollection();
  return collection.findOne({ _id: goalId, userId });
}

export async function createGoal(
  doc: Omit<GoalDoc, "_id">,
): Promise<GoalDoc> {
  const collection = await goalsCollection();
  const full: GoalDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

/**
 * Writes a recomputed value (and possibly a status flip to "completed").
 * Scoped by userId so a goal can never be advanced by another account.
 */
export async function updateGoalProgress(
  userId: ObjectId,
  goalId: ObjectId,
  fields: { currentValue: number; status: GoalStatus },
): Promise<GoalDoc | null> {
  const collection = await goalsCollection();
  return collection.findOneAndUpdate(
    { _id: goalId, userId },
    { $set: { ...fields, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function setGoalStatus(
  userId: ObjectId,
  goalId: ObjectId,
  status: GoalStatus,
): Promise<GoalDoc | null> {
  const collection = await goalsCollection();
  return collection.findOneAndUpdate(
    { _id: goalId, userId },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function deleteGoal(
  userId: ObjectId,
  goalId: ObjectId,
): Promise<boolean> {
  const collection = await goalsCollection();
  const result = await collection.deleteOne({ _id: goalId, userId });
  return result.deletedCount === 1;
}
