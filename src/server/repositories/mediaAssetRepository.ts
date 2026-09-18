import "server-only";
import { ObjectId } from "mongodb";
import { mediaAssetsCollection } from "@/server/db/collections";
import {
  allowedHostsFromEnv,
  classifyMediaUrl,
  mediaUrlRejectionMessage,
} from "@/lib/media-url-policy";
import { ValidationError } from "@/server/errors";
import type { MediaAssetDoc, MediaAssetSource } from "@/types/db";

/**
 * Every media asset in the system is created here, which is why the host
 * policy is enforced here (BRD 7.14: "No league-owned footage is used before
 * the pending license is in place").
 *
 * The check is inlined rather than delegated to a service on purpose:
 * repositories are a leaf layer, and calling a service from one would create
 * a `repository -> service -> repository` import cycle - this repository is
 * the very thing `mediaProvenanceService` imports. `@/server/errors` is a
 * leaf, so importing it here costs nothing structurally.
 */
export async function createMediaAsset(
  doc: Omit<MediaAssetDoc, "_id">,
): Promise<MediaAssetDoc> {
  assertPermittedMediaUrl(doc.url);

  const collection = await mediaAssetsCollection();
  const full: MediaAssetDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

/** Throws a `ValidationError` if the URL is somewhere we have no right to load from. */
export function assertPermittedMediaUrl(url: string): void {
  const verdict = classifyMediaUrl(url, {
    extraHosts: allowedHostsFromEnv(process.env.MEDIA_ALLOWED_HOSTS),
  });
  if (!verdict.ok) {
    throw new ValidationError(mediaUrlRejectionMessage(verdict));
  }
}

export async function findMediaAssetById(
  id: ObjectId,
): Promise<MediaAssetDoc | null> {
  const collection = await mediaAssetsCollection();
  return collection.findOne({ _id: id });
}

/**
 * Batched lookup for surfaces that resolve many assets at once - the feed
 * resolves one per card. Mirrors `listFeedItemsByIds`, including the
 * empty-array short-circuit that keeps a no-media feed from issuing a query.
 */
export async function listMediaAssetsByIds(
  ids: ObjectId[],
): Promise<MediaAssetDoc[]> {
  if (ids.length === 0) return [];
  const collection = await mediaAssetsCollection();
  return collection.find({ _id: { $in: ids } }).toArray();
}

export interface ListMediaAssetsFilter {
  source?: MediaAssetSource;
  /** "cleared" / "uncleared" filter for the admin inventory. */
  cleared?: boolean;
}

/** Newest first - what the admin content inventory renders. */
export async function listMediaAssets(
  filter: ListMediaAssetsFilter = {},
  limit = 100,
): Promise<MediaAssetDoc[]> {
  const collection = await mediaAssetsCollection();
  const query: Record<string, unknown> = {};
  if (filter.source) query.source = filter.source;
  if (filter.cleared !== undefined) {
    query.rightsClearedAt = { $exists: filter.cleared };
  }
  return collection.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
}

/**
 * The shared placeholder study clip. Roster-synced players have no authored
 * footage of their own, so their archetype call-outs play over this - and
 * because the asset's own `source` is "placeholder", the UI disclosure
 * (BRD 6.4/7.14) stays accurate rather than being hardcoded.
 *
 * Sorted oldest-first so the result is deterministic: an unsorted `findOne`
 * would let a superseded placeholder row win non-deterministically after a
 * re-seed, which is how a study clip could silently resolve to an orphaned
 * asset.
 */
export async function findFirstPlaceholderVideoAsset(): Promise<MediaAssetDoc | null> {
  const collection = await mediaAssetsCollection();
  return collection.findOne(
    { type: "video", source: "placeholder" },
    { sort: { createdAt: 1 } },
  );
}

/**
 * Records that a human confirmed the rights on this asset (BRD 7.14:
 * "Production content must have cleared rights before use").
 *
 * Presence of `rightsClearedAt` IS the cleared state - there is no boolean to
 * disagree with it. Returns null when the asset is gone, and the service
 * translates that into a NotFoundError.
 */
export async function setRightsCleared(
  assetId: ObjectId,
  clearedBy: ObjectId,
  cleared: boolean,
): Promise<MediaAssetDoc | null> {
  const collection = await mediaAssetsCollection();
  return collection.findOneAndUpdate(
    { _id: assetId },
    cleared
      ? { $set: { rightsClearedAt: new Date(), rightsClearedBy: clearedBy } }
      : { $unset: { rightsClearedAt: "", rightsClearedBy: "" } },
    { returnDocument: "after" },
  );
}
