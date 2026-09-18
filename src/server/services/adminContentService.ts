import "server-only";
import { ObjectId } from "mongodb";
import {
  findMediaAssetById,
  listMediaAssets,
  setRightsCleared,
  type ListMediaAssetsFilter,
} from "@/server/repositories/mediaAssetRepository";
import {
  insertLibraryFeedItem,
  setFeedItemMedia,
} from "@/server/repositories/feedRepository";
import { storeContentClip } from "@/server/services/contentStorageService";
import { disclosureFor, type MediaDisclosure } from "@/lib/media-provenance";
import { clearsOnIngest, pendingClearanceReason } from "@/lib/content-ingest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { IngestContentInput } from "@/lib/validation/content";
import type { MediaAssetDoc } from "@/types/db";

/**
 * The content pipeline BRD 7.14 prioritises: ingest -> capture rights ->
 * clear -> publish.
 *
 * The rule that makes it a pipeline rather than a schema with good intentions
 * is `requireClearedAsset`: nothing reaches a player's feed until a human has
 * said the rights are settled. Note *where* that gate sits - at publish time,
 * never at render. BRD 6.4 and 11.1 require the demo to work without a league
 * licence, so clearly-labeled placeholders must keep playing; gating the
 * render path would have broken the very thing the placeholder exists to
 * enable.
 */
export interface ContentAssetView {
  id: string;
  url: string;
  source: MediaAssetDoc["source"];
  contributor: MediaAssetDoc["contributor"];
  rightsHolder: string;
  attribution: string | null;
  sourceUrl: string | null;
  licenseNotes: string | null;
  durationSeconds: number | null;
  cleared: boolean;
  /** Why this is still waiting, phrased for the admin who has to act. */
  pendingReason: string | null;
  disclosure: MediaDisclosure;
  createdAt: string;
}

function toView(asset: MediaAssetDoc): ContentAssetView {
  const cleared = Boolean(asset.rightsClearedAt);
  return {
    id: asset._id.toString(),
    url: asset.url,
    source: asset.source,
    contributor: asset.contributor,
    rightsHolder: asset.rightsHolder,
    attribution: asset.attribution ?? null,
    sourceUrl: asset.sourceUrl ?? null,
    licenseNotes: asset.licenseNotes ?? null,
    durationSeconds: asset.durationSeconds ?? null,
    cleared,
    pendingReason: cleared
      ? null
      : pendingClearanceReason(asset.contributor ?? "hoopsync"),
    disclosure: disclosureFor(asset),
    createdAt: asset.createdAt.toISOString(),
  };
}

export async function listContentAssets(
  filter: ListMediaAssetsFilter = {},
): Promise<ContentAssetView[]> {
  return (await listMediaAssets(filter)).map(toView);
}

/**
 * Takes delivery of a clip and records the rights it arrived under.
 *
 * Whether it is immediately usable is not this function's decision - it is
 * `clearsOnIngest`, keyed on who supplied the content. HoopSync's own
 * material clears itself; a coach's, a licensor's or an institution's waits.
 */
export async function ingestClip(
  adminId: ObjectId,
  input: IngestContentInput,
  file: { buffer: Buffer; contentType: string },
): Promise<ContentAssetView> {
  const asset = await storeContentClip({
    adminId: adminId.toString(),
    buffer: file.buffer,
    contentType: file.contentType,
    source: input.source,
    contributor: input.contributor,
    rightsHolder: input.rightsHolder,
    attribution: input.attribution || undefined,
    sourceUrl: input.sourceUrl || undefined,
    licenseNotes: input.licenseNotes || undefined,
    durationSeconds: input.durationSeconds,
  });

  // The card is authored at the same time as the clip, but it is only pointed
  // at the asset once the rights are settled - so an uncleared upload creates
  // no player-visible content at all.
  let feedItemId: ObjectId | undefined;
  try {
    const item = await insertLibraryFeedItem({
      type: "drill_demo",
      title: input.title,
      body: input.body,
      tags: [],
      ...(clearsOnIngest(input.contributor) ? { mediaAssetId: asset._id } : {}),
    });
    feedItemId = item._id;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError("A library card with that title already exists.");
    }
    throw err;
  }

  logger.info(
    {
      assetId: asset._id.toString(),
      feedItemId: feedItemId.toString(),
      source: input.source,
      contributor: input.contributor,
      cleared: clearsOnIngest(input.contributor),
    },
    "Admin ingested a library clip",
  );

  return toView(asset);
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

/** Records (or withdraws) a human's confirmation that the rights are settled. */
export async function setAssetClearance(
  adminId: ObjectId,
  assetId: ObjectId,
  cleared: boolean,
): Promise<ContentAssetView> {
  const asset = await setRightsCleared(assetId, adminId, cleared);
  if (!asset) throw new NotFoundError("That asset no longer exists.");
  logger.info(
    { assetId: assetId.toString(), adminId: adminId.toString(), cleared },
    "Admin changed an asset's rights clearance",
  );
  return toView(asset);
}

/**
 * The gate. Publishing anything to a player's feed goes through here.
 *
 * Deliberately a *publish-time* check. Render-time would have been the
 * stricter-looking choice and the wrong one: it would stop the seeded
 * placeholder from playing, and BRD 6.4/11.1 require exactly that placeholder
 * to carry the demo while no league licence exists.
 */
async function requireClearedAsset(assetId: ObjectId): Promise<MediaAssetDoc> {
  const asset = await findMediaAssetById(assetId);
  if (!asset) throw new NotFoundError("That asset no longer exists.");
  if (!asset.rightsClearedAt) {
    throw new ValidationError(
      "That clip's rights haven't been cleared yet, so it can't be published. " +
        (asset.contributor
          ? pendingClearanceReason(asset.contributor)
          : "Confirm the rights first."),
    );
  }
  return asset;
}

/** Points a library card at a cleared asset, making it visible to players. */
export async function attachAssetToFeedItem(
  assetId: ObjectId,
  feedItemId: ObjectId,
): Promise<void> {
  await requireClearedAsset(assetId);
  const item = await setFeedItemMedia(feedItemId, assetId);
  if (!item) throw new NotFoundError("That feed item no longer exists.");
  logger.info(
    { assetId: assetId.toString(), feedItemId: feedItemId.toString() },
    "Admin published a clip to a library card",
  );
}
