import "server-only";
import { ObjectId } from "mongodb";
import { coachMessagesCollection } from "@/server/db/collections";
import type { CoachMessageDoc } from "@/types/db";

export async function createMessage(
  doc: Omit<CoachMessageDoc, "_id">,
): Promise<CoachMessageDoc> {
  const collection = await coachMessagesCollection();
  const full: CoachMessageDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

/** Oldest-first, capped to the most recent `limit` messages (bounds LLM context/cost). */
export async function listMessagesForConversation(
  conversationId: ObjectId,
  limit = 20,
): Promise<CoachMessageDoc[]> {
  const collection = await coachMessagesCollection();
  const recent = await collection
    .find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return recent.reverse();
}
