import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import { UnauthorizedError, ValidationError } from "@/server/errors";
import { startSession } from "@/server/services/shotSessionService";
import { MAX_SESSION_VIDEO_BYTES } from "@/lib/shot-session-upload";

// Shared with the client so an over-long in-app recording is rejected before
// it's pushed up the wire, not after.
const MAX_BYTES = MAX_SESSION_VIDEO_BYTES;

export const POST = withErrorHandling(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("You must be signed in.");
  }

  const formData = await request.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new ValidationError("No video file was provided.");
  }
  if (file.size === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError("That video is too large - keep clips under 100MB for now.");
  }
  if (!file.type.startsWith("video/")) {
    throw new ValidationError("Please upload a video file.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const shotSession = await startSession(
    new ObjectId(session.user.id),
    buffer,
    file.type,
  );

  return jsonOk({ sessionId: shotSession._id.toString() });
});
