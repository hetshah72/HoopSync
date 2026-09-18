import "server-only";
import { storeUpload } from "@/server/services/mediaStorageService";
import { avatarExtensionFor, type AvatarImageType } from "@/lib/avatar-image";
import type { MediaAssetDoc } from "@/types/db";

/**
 * A year, against the seven days session footage gets.
 *
 * An avatar URL is written onto the profile and read back on every screen
 * that renders the player, so it has to outlive the upload by a long way.
 * The durable answer is a public/CDN-fronted object or re-signing on read;
 * until the bucket's access model is settled, a long-lived signed URL is
 * what keeps avatars from silently breaking.
 */
const AVATAR_URL_TTL_MS = 1000 * 60 * 60 * 24 * 365;

/**
 * Stores an uploaded profile photo and records its provenance.
 *
 * `contentType` is the *sniffed* type (see `sniffAvatarImageType`), which is
 * also what picks the extension - so the stored object's name can never
 * disagree with its bytes.
 */
export async function storeAvatarImage(
  userId: string,
  buffer: Buffer,
  contentType: AvatarImageType,
): Promise<MediaAssetDoc> {
  return storeUpload({
    userId,
    buffer,
    contentType,
    extension: avatarExtensionFor(contentType),
    gcsPrefix: `avatars/${userId}`,
    localDir: "avatars",
    type: "image",
    describe: "Player-uploaded profile photo",
    signedUrlTtlMs: AVATAR_URL_TTL_MS,
  });
}
