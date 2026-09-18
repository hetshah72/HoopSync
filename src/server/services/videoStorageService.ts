import "server-only";
import { storeUpload } from "@/server/services/mediaStorageService";
import type { MediaAssetDoc } from "@/types/db";

function extensionFor(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  return "mp4";
}

/**
 * Session and game footage has to stay playable for as long as the session
 * exists - a shot chart whose replays 404 is exactly the "placeholder" BRD
 * 7.5 forbids, and the analysis above it never expires.
 *
 * `uploadBufferToGcs` defaults to 7 days, which would silently break every
 * replay a week after upload once GCS is configured. Same reasoning and same
 * value as avatarStorageService, and the same caveat: this is a long-lived
 * signed URL because the bucket's access model isn't settled yet.
 */
const VIDEO_URL_TTL_MS = 1000 * 60 * 60 * 24 * 365;

/**
 * Stores an uploaded shooting-session video and records its provenance.
 *
 * The GCS-or-dev-local decision lives in mediaStorageService; this only
 * knows where session footage belongs and what to call it.
 */
export async function storeSessionVideo(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<MediaAssetDoc> {
  return storeUpload({
    userId,
    buffer,
    contentType,
    extension: extensionFor(contentType),
    gcsPrefix: `shot-sessions/${userId}`,
    localDir: "videos",
    type: "video",
    describe: "Player-recorded shooting session footage",
    signedUrlTtlMs: VIDEO_URL_TTL_MS,
  });
}

/**
 * Stores an uploaded game clip and records its provenance.
 *
 * Kept separate from `storeSessionVideo` rather than reusing it: game footage
 * is a different kind of content in a different place, and BRD 7.14's
 * "every piece of content has a traceable, legitimate source" is only true if
 * the description actually matches what was stored.
 */
export async function storeGameFootageVideo(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<MediaAssetDoc> {
  return storeUpload({
    userId,
    buffer,
    contentType,
    extension: extensionFor(contentType),
    gcsPrefix: `game-footage/${userId}`,
    localDir: "game-footage",
    type: "video",
    describe: "Player-uploaded game footage",
    signedUrlTtlMs: VIDEO_URL_TTL_MS,
  });
}
