import "server-only";
import { ObjectId } from "mongodb";
import { storeUpload } from "@/server/services/mediaStorageService";
import { clearsOnIngest } from "@/lib/content-ingest";
import type {
  MediaAssetContributor,
  MediaAssetDoc,
  MediaAssetSource,
} from "@/types/db";

function extensionFor(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  return "mp4";
}

/**
 * Library content lives for as long as the feed does, so its URL has to
 * outlive the 7-day default `uploadBufferToGcs` would otherwise apply. Same
 * reasoning and same value as session footage and avatars, and the same
 * caveat: a long-lived signed URL is a stopgap until the bucket's access
 * model is settled.
 */
const CONTENT_URL_TTL_MS = 1000 * 60 * 60 * 24 * 365;

export interface StoreContentClipInput {
  adminId: string;
  buffer: Buffer;
  contentType: string;
  source: MediaAssetSource;
  contributor: MediaAssetContributor;
  rightsHolder: string;
  attribution?: string;
  sourceUrl?: string;
  licenseNotes?: string;
  durationSeconds?: number;
}

/**
 * Stores an admin-ingested library clip with the rights it was declared under.
 *
 * The GCS-or-dev-local decision and the host policy both live below this, in
 * `mediaStorageService`/`createMediaAsset`; this only knows where library
 * content belongs and which uploads clear themselves.
 *
 * Auto-clearance is keyed on the contributor: HoopSync's own material is
 * cleared on arrival, and a third party's waits for a human to confirm a
 * release exists (BRD 7.14: "Production content must have cleared rights
 * before use").
 */
export async function storeContentClip({
  adminId,
  buffer,
  contentType,
  source,
  contributor,
  rightsHolder,
  attribution,
  sourceUrl,
  licenseNotes,
  durationSeconds,
}: StoreContentClipInput): Promise<MediaAssetDoc> {
  return storeUpload({
    userId: adminId,
    buffer,
    contentType,
    extension: extensionFor(contentType),
    gcsPrefix: "library",
    localDir: "library",
    type: "video",
    describe: `Admin-ingested library clip (${source})`,
    signedUrlTtlMs: CONTENT_URL_TTL_MS,
    rights: {
      source,
      contributor,
      rightsHolder,
      attribution,
      sourceUrl,
      durationSeconds,
      licenseNotes,
      ...(clearsOnIngest(contributor)
        ? { clearedBy: new ObjectId(adminId) }
        : {}),
    },
  });
}
