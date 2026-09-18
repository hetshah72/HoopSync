import "server-only";
import { ObjectId } from "mongodb";
import { coachConversationsCollection } from "@/server/db/collections";
import type {
  CoachContextRef,
  CoachConversationDoc,
  CoachPersonality,
} from "@/types/db";

/**
 * Minimal conversation persistence needed to back Feed's "Ask Coach" action
 * (records real context so a later Coach session doesn't start from zero).
 * The chat engine itself (OpenAI integration, message exchange) is Coach's
 * own concern, built in a later phase.
 */
export async function createConversation(
  doc: Omit<CoachConversationDoc, "_id">,
): Promise<CoachConversationDoc> {
  const collection = await coachConversationsCollection();
  const full: CoachConversationDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

export async function countConversationsForUser(userId: ObjectId): Promise<number> {
  const collection = await coachConversationsCollection();
  return collection.countDocuments({ userId });
}

/**
 * Conversations started by a genuine Share With Coach hand-off, backing the
 * "Took It to Coach" achievement (BRD 7.13).
 *
 * Narrower than `countConversationsForUser` on purpose. Only a shared shot
 * session or game-film analysis counts: `workout` and `feed_item` context refs
 * come from "Ask Coach about this", which is a question rather than the BRD 7.8
 * hand-off, and an unanchored chat is neither.
 */
export async function countSharedAnalysisConversationsForUser(
  userId: ObjectId,
): Promise<number> {
  const collection = await coachConversationsCollection();
  return collection.countDocuments({
    userId,
    contextRefs: {
      $elemMatch: { type: { $in: ["shot_session", "game_footage_analysis"] } },
    },
  });
}

export async function listConversationsForUser(
  userId: ObjectId,
): Promise<CoachConversationDoc[]> {
  const collection = await coachConversationsCollection();
  return collection.find({ userId }).sort({ lastMessageAt: -1 }).toArray();
}

export async function findConversationByIdForUser(
  userId: ObjectId,
  conversationId: ObjectId,
): Promise<CoachConversationDoc | null> {
  const collection = await coachConversationsCollection();
  return collection.findOne({ _id: conversationId, userId });
}

/**
 * The most recent conversation already anchored to a specific thing.
 *
 * Lets an "Ask Coach" entry point resume the conversation about that item
 * instead of opening another one. Tapping Ask Coach on the same feed card
 * three times previously produced three separate empty chats (audit Bug
 * Feed-3 / FEED-06).
 */
export async function findConversationByContextRef(
  userId: ObjectId,
  type: CoachContextRef["type"],
  refId: ObjectId,
): Promise<CoachConversationDoc | null> {
  const collection = await coachConversationsCollection();
  return collection.findOne(
    { userId, contextRefs: { $elemMatch: { type, refId } } },
    { sort: { lastMessageAt: -1 } },
  );
}

/**
 * Both writers below filter on `userId` as well as `_id`.
 *
 * The service layer already checks ownership before calling either, so this
 * fixes no live exploit - but a repository method that will happily write to
 * any conversation given its id is one careless new call site away from being
 * one, and every reader in this file is scoped the same way. Defense in depth,
 * and it costs a single index-covered field.
 */
export async function touchConversationLastMessageAt(
  userId: ObjectId,
  conversationId: ObjectId,
): Promise<void> {
  const collection = await coachConversationsCollection();
  await collection.updateOne(
    { _id: conversationId, userId },
    { $set: { lastMessageAt: new Date() } },
  );
}

export async function updateConversationPersonality(
  userId: ObjectId,
  conversationId: ObjectId,
  personality: CoachPersonality,
): Promise<CoachConversationDoc | null> {
  const collection = await coachConversationsCollection();
  return collection.findOneAndUpdate(
    { _id: conversationId, userId },
    { $set: { personality } },
    { returnDocument: "after" },
  );
}
