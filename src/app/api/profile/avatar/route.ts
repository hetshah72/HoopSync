import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { withErrorHandling, jsonOk } from "@/server/http";
import { ValidationError } from "@/server/errors";
import { clearAvatar, setAvatar } from "@/server/services/profileService";
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIZE_MESSAGE,
  AVATAR_TYPE_MESSAGE,
  sniffAvatarImageType,
} from "@/lib/avatar-image";

const SIGN_IN_MESSAGE = "You must be signed in to change your profile photo.";

/**
 * Profile photo upload.
 *
 * A Route Handler rather than a Server Action because the picker posts a
 * file from a client component and needs the stored URL back to settle its
 * own preview (CLAUDE.md: route handlers for anything a client hook fetches
 * and for file uploads).
 */
export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId(SIGN_IN_MESSAGE);

  const formData = await request.formData();
  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    throw new ValidationError("No image was provided.");
  }
  if (file.size === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }
  // Checked before the bytes are read into memory, so an oversized file
  // costs a rejection rather than a buffer.
  if (file.size > AVATAR_MAX_BYTES) {
    throw new ValidationError(AVATAR_SIZE_MESSAGE);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The part's declared Content-Type is whatever the client chose to send,
  // so what decides both "is this allowed" and the stored extension is read
  // out of the bytes instead.
  const contentType = sniffAvatarImageType(buffer);
  if (!contentType) {
    throw new ValidationError(AVATAR_TYPE_MESSAGE);
  }

  const profile = await setAvatar(new ObjectId(userId), buffer, contentType);
  return jsonOk({ avatarUrl: profile.avatarUrl });
});

/** Removes the uploaded photo. The stored object is left in place - it is
 * referenced by a media asset that records who uploaded it and when. */
export const DELETE = withErrorHandling(async () => {
  const userId = await requireUserId(SIGN_IN_MESSAGE);
  await clearAvatar(new ObjectId(userId));
  return jsonOk({ avatarUrl: null });
});
