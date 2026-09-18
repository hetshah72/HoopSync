/**
 * One definition of what counts as an uploadable profile photo, shared by
 * the client-side picker and the route handler that receives the bytes -
 * the same reason the Zod schemas live under `src/lib` (see CLAUDE.md).
 *
 * A limit enforced only on the client is not a limit; a limit worded only on
 * the server reaches the player as a failed upload rather than a file that
 * was never sent.
 */

/** 5MB. Comfortably above a phone camera shot, well below a video clip. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Deliberately no SVG. An avatar is stored and then served back - from our
 * own origin in the local-fallback case - and SVG is the one image format
 * that is really a document and can carry script.
 */
export const AVATAR_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AvatarImageType = (typeof AVATAR_IMAGE_TYPES)[number];

/** `accept` for the file input, so the picker filters before a file is chosen. */
export const AVATAR_ACCEPT = AVATAR_IMAGE_TYPES.join(",");

export const AVATAR_TYPE_MESSAGE =
  "Profile photos need to be a JPEG, PNG or WebP image.";

export const AVATAR_SIZE_MESSAGE = `That image is too large - keep your photo under ${Math.round(
  AVATAR_MAX_BYTES / 1024 / 1024,
)}MB.`;

const EXTENSIONS: Record<AvatarImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function avatarExtensionFor(type: AvatarImageType): string {
  return EXTENSIONS[type];
}

/** True when `signature` appears at `offset`; a short buffer is simply false. */
function hasSignature(
  bytes: Uint8Array,
  signature: number[],
  offset = 0,
): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Identifies an image from its leading bytes rather than its declared type.
 *
 * The `Content-Type` on a multipart part is whatever the client chose to put
 * there, so trusting it would let anything at all be stored under an image
 * extension and served back from our origin. Sniffing decides both *whether*
 * the upload is allowed and the extension it is written under, which means
 * the stored file's name can never disagree with its contents.
 *
 * Returns `null` for anything that isn't one of the three accepted formats.
 */
export function sniffAvatarImageType(
  bytes: Uint8Array,
): AvatarImageType | null {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // WebP is a RIFF container: "RIFF" <4-byte length> "WEBP".
  if (
    hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}
