import "server-only";
import { ObjectId } from "mongodb";
import {
  dailyQuotesCollection,
  feedInteractionsCollection,
  feedItemsCollection,
} from "@/server/db/collections";
import { dayIndex } from "@/lib/day-stamp";
import type {
  DailyQuoteDoc,
  FeedInteractionAction,
  FeedInteractionDoc,
  FeedItemDoc,
  FeedItemKind,
} from "@/types/db";

/**
 * The authored, global content library - the cards every player can see.
 *
 * Generated per-user cards live in the same collection (so `findFeedItemById`
 * stays a single unscoped lookup and Ask Coach works on both) and are
 * excluded here by the absence of a `userId`.
 */
export async function listLibraryFeedItems(): Promise<FeedItemDoc[]> {
  const collection = await feedItemsCollection();
  return collection
    .find({ userId: { $exists: false } })
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Library cards added since a given instant, for the "new content"
 * notification.
 *
 * Scoped to library items the same way `listLibraryFeedItems` is - by the
 * absence of a `userId`. Without that clause this would count the player's own
 * generated cards, which are written fresh every single day, and the
 * notification would fire every day claiming the feed's own output as new
 * library content.
 */
export async function countLibraryFeedItemsCreatedSince(
  since: Date,
): Promise<number> {
  const collection = await feedItemsCollection();
  return collection.countDocuments({
    userId: { $exists: false },
    createdAt: { $gt: since },
  });
}

/** One player's generated cards for one day. */
export async function listGeneratedFeedItems(
  userId: ObjectId,
  generatedForDate: string,
): Promise<FeedItemDoc[]> {
  const collection = await feedItemsCollection();
  return collection.find({ userId, generatedForDate }).toArray();
}

export async function findFeedItemById(
  feedItemId: ObjectId,
): Promise<FeedItemDoc | null> {
  const collection = await feedItemsCollection();
  return collection.findOne({ _id: feedItemId });
}

export async function listFeedItemsByIds(
  ids: ObjectId[],
): Promise<FeedItemDoc[]> {
  if (ids.length === 0) return [];
  const collection = await feedItemsCollection();
  return collection.find({ _id: { $in: ids } }).toArray();
}

export type GeneratedFeedItemInput = Omit<FeedItemDoc, "_id" | "createdAt"> & {
  userId: ObjectId;
  generatedForDate: string;
  kind: FeedItemKind;
};

/**
 * Writes one generated card, at most once per {user, day, kind}.
 *
 * `$setOnInsert` plus the unique partial index means concurrent first-views
 * of the day cannot produce duplicates: the loser's update matches the
 * winner's document and changes nothing. Returns the card that is now
 * stored, which for a loser is the winner's - so both renders show the same
 * feed.
 */
export async function upsertGeneratedFeedItem(
  input: GeneratedFeedItemInput,
): Promise<FeedItemDoc> {
  const collection = await feedItemsCollection();
  const result = await collection.findOneAndUpdate(
    {
      userId: input.userId,
      generatedForDate: input.generatedForDate,
      kind: input.kind,
    },
    { $setOnInsert: { ...input, _id: new ObjectId(), createdAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  // `returnDocument: "after"` on an upsert always yields a document.
  return result!;
}

/**
 * Replaces a generated card whose underlying data has moved on, preserving
 * its `_id` so likes, saves and any Coach conversation that references it
 * keep pointing at a card that still exists.
 */
export async function replaceGeneratedFeedItem(
  feedItemId: ObjectId,
  input: GeneratedFeedItemInput,
): Promise<FeedItemDoc | null> {
  const collection = await feedItemsCollection();
  return collection.findOneAndUpdate(
    { _id: feedItemId },
    { $set: { ...input } },
    { returnDocument: "after" },
  );
}

/**
 * Removes a generated card that no longer applies - e.g. the "log your first
 * session" prompt once they have. Only ever called for generated kinds; the
 * authored library is never deleted from the app.
 */
export async function deleteGeneratedFeedItem(feedItemId: ObjectId): Promise<void> {
  const collection = await feedItemsCollection();
  await collection.deleteOne({ _id: feedItemId, userId: { $exists: true } });
}

// ---------------------------------------------------------------------------
// Daily quote
// ---------------------------------------------------------------------------

/**
 * The quote for a given day.
 *
 * Quotes are seeded with an explicit `dateAssigned`, which is honoured first
 * so a deliberately scheduled quote still wins. The fallback is what stops
 * the card vanishing: the seeder only stamps a couple of weeks ahead, and
 * the previous exact-match-only lookup returned null forever afterwards
 * (audit Bug Feed-5 / FEED-11 - "the quote card vanishes entirely, no
 * fallback, no error"). Rotating the whole pool by day index means the card
 * keeps working indefinitely, still changes every day, and is still the same
 * quote for every player on a given day.
 */
export async function findQuoteForDay(
  dayStamp: string,
): Promise<DailyQuoteDoc | null> {
  const collection = await dailyQuotesCollection();

  const assigned = await collection.findOne({ dateAssigned: dayStamp });
  if (assigned) return assigned;

  const total = await collection.countDocuments();
  if (total === 0) return null;

  // Ordered by `dateAssigned` so the rotation is stable across restarts and
  // independent of insertion order.
  const [quote] = await collection
    .find()
    .sort({ dateAssigned: 1 })
    .skip(((dayIndex(dayStamp) % total) + total) % total)
    .limit(1)
    .toArray();
  return quote ?? null;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export async function listInteractionsForUser(
  userId: ObjectId,
): Promise<FeedInteractionDoc[]> {
  const collection = await feedInteractionsCollection();
  return collection.find({ userId }).toArray();
}

/** Newest-first interactions of one kind - backs the Saved screen. */
export async function listInteractionsForUserByAction(
  userId: ObjectId,
  action: FeedInteractionAction,
): Promise<FeedInteractionDoc[]> {
  const collection = await feedInteractionsCollection();
  return collection.find({ userId, action }).sort({ createdAt: -1 }).toArray();
}

/** Toggles like/save: removes if present, inserts if absent. Returns the new state. */
export async function toggleInteraction(
  userId: ObjectId,
  feedItemId: ObjectId,
  action: "like" | "save",
): Promise<boolean> {
  const collection = await feedInteractionsCollection();
  const existing = await collection.findOne({ userId, feedItemId, action });

  if (existing) {
    await collection.deleteOne({ _id: existing._id });
    return false;
  }

  await collection.insertOne({
    _id: new ObjectId(),
    userId,
    feedItemId,
    action,
    createdAt: new Date(),
  });
  return true;
}

/** Share is an at-most-once record per user/item, not a toggle. */
export async function recordShareOnce(
  userId: ObjectId,
  feedItemId: ObjectId,
): Promise<void> {
  const collection = await feedInteractionsCollection();
  await collection.updateOne(
    { userId, feedItemId, action: "share" as FeedInteractionAction },
    { $setOnInsert: { userId, feedItemId, action: "share", createdAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Publishes an admin-authored library card.
 *
 * Library items are distinguished from generated ones by having no `userId`,
 * and `kind: "library"` is written explicitly rather than left to the
 * defaulting reader so the row is self-describing to anything that queries by
 * kind.
 *
 * The duplicate-key error is deliberately not translated here - repositories
 * return data or raise the driver's own error, and `adminContentService`
 * decides it means ConflictError.
 */
export async function insertLibraryFeedItem(input: {
  type: FeedItemDoc["type"];
  title: string;
  body: string;
  tags: string[];
  mediaAssetId?: ObjectId;
  relatedDrillId?: ObjectId;
}): Promise<FeedItemDoc> {
  const collection = await feedItemsCollection();
  const doc: FeedItemDoc = {
    _id: new ObjectId(),
    kind: "library",
    createdAt: new Date(),
    ...input,
  };
  await collection.insertOne(doc);
  return doc;
}

/** Points an existing library card at a media asset. */
export async function setFeedItemMedia(
  feedItemId: ObjectId,
  mediaAssetId: ObjectId,
): Promise<FeedItemDoc | null> {
  const collection = await feedItemsCollection();
  return collection.findOneAndUpdate(
    { _id: feedItemId },
    { $set: { mediaAssetId } },
    { returnDocument: "after" },
  );
}
