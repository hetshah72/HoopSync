import "server-only";
import type { ObjectId } from "mongodb";
import {
  findMediaAssetById,
  listMediaAssetsByIds,
} from "@/server/repositories/mediaAssetRepository";
import {
  allowedHostsFromEnv,
  classifyMediaUrl,
} from "@/lib/media-url-policy";
import { disclosureFor, type MediaDisclosure } from "@/lib/media-provenance";
import { logger } from "@/server/logger";
import type { MediaAssetDoc, MediaAssetType } from "@/types/db";

/**
 * The one way media reaches the UI (BRD 7.14 "traceable, legitimate source").
 *
 * Resolution returns `null` rather than a bare URL whenever the content
 * cannot be vouched for: the asset id is missing, the row is gone, or the
 * host is one HoopSync has no right to load from. Callers render their honest
 * "no clip yet" state instead. That is the runtime half of the enforcement -
 * the other halves are the write-time check in `createMediaAsset`, the
 * `$jsonSchema` validator, and `npm run content:audit`.
 *
 * Scope, stated plainly so nobody over-claims it: this gate covers
 * asset-backed media. The legacy URL-only fields (`playerProfiles.avatarUrl`,
 * `nbaPlayers.playerImageUrl`, `drills.videoUrl`) are paired with a new
 * `*AssetId` sibling and reported on by the audit, but a row that predates
 * the pairing still renders from its URL.
 */
export interface MediaView {
  assetId: string;
  url: string;
  type: MediaAssetType;
  disclosure: MediaDisclosure;
  /** Present when known; lets a surface honour BRD 7.14's "short-form" bar. */
  durationSeconds?: number;
}

/**
 * The denylist is re-applied on read, not just on write.
 *
 * A URL that predates the policy - or that arrived through the seed, or a
 * direct database write - has never passed `createMediaAsset`. Checking again
 * here is what makes "no league-owned footage" true of what actually reaches
 * a screen, rather than merely true of what this codebase inserted.
 *
 * Read-time uses `denyOnly`: refusing an already-stored asset because its
 * host is merely *unlisted* would brick content that was legitimately
 * accepted when the allowlist was configured differently. A league host is
 * refused however it got in; an unfamiliar one is the audit's problem.
 */
function toView(asset: MediaAssetDoc): MediaView | null {
  const verdict = classifyMediaUrl(asset.url, {
    denyOnly: true,
    extraHosts: allowedHostsFromEnv(process.env.MEDIA_ALLOWED_HOSTS),
  });

  if (!verdict.ok) {
    logger.error(
      { assetId: asset._id.toString(), reason: verdict.reason },
      "Refusing to render a media asset whose host is not permitted (BRD 7.14)",
    );
    return null;
  }

  return {
    assetId: asset._id.toString(),
    url: asset.url,
    type: asset.type,
    disclosure: disclosureFor(asset),
    ...(asset.durationSeconds !== undefined
      ? { durationSeconds: asset.durationSeconds }
      : {}),
  };
}

export async function resolveMediaAsset(
  assetId: ObjectId | undefined | null,
): Promise<MediaView | null> {
  if (!assetId) return null;
  const asset = await findMediaAssetById(assetId);
  if (!asset) return null;
  return toView(asset);
}

/**
 * Batched resolution, keyed by asset id string. Surfaces that render a list
 * (the feed, the reel) resolve every card's media in one query rather than
 * one per card.
 */
export async function resolveMediaAssets(
  assetIds: ObjectId[],
): Promise<Map<string, MediaView>> {
  const assets = await listMediaAssetsByIds(assetIds);
  const byId = new Map<string, MediaView>();
  for (const asset of assets) {
    const view = toView(asset);
    if (view) byId.set(asset._id.toString(), view);
  }
  return byId;
}
