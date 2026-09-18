import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";
import { ingestClip } from "@/server/services/adminContentService";
import { ingestContentSchema } from "@/lib/validation/content";
import {
  CONTENT_MAX_BYTES,
  CONTENT_SIZE_MESSAGE,
  CONTENT_TYPE_MESSAGE,
  CONTENT_VIDEO_TYPES,
} from "@/lib/content-ingest";

/**
 * Admin content ingestion (BRD 7.14 - "MVP for the content pipeline itself").
 *
 * A Route Handler rather than a Server Action because this is a file upload,
 * which is the split CLAUDE.md draws. Admin-gated the same way the roster
 * sync is.
 *
 * Note what this route does NOT accept: a URL to content hosted elsewhere.
 * Upload-only is the safer shape for a submission made before any licence is
 * signed - it is the one path that could otherwise put an unverified
 * third-party URL in the database on nothing but a hand-maintained denylist.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("You must be signed in.");
  }
  if (session.user.role !== "admin") {
    throw new ForbiddenError("Only admins can add library content.");
  }

  const formData = await request.formData();
  const file = formData.get("clip");
  if (!(file instanceof File)) {
    throw new ValidationError("No clip was provided.");
  }
  if (file.size === 0) {
    throw new ValidationError("That file is empty.");
  }
  if (file.size > CONTENT_MAX_BYTES) {
    throw new ValidationError(CONTENT_SIZE_MESSAGE);
  }
  if (!CONTENT_VIDEO_TYPES.includes(file.type as (typeof CONTENT_VIDEO_TYPES)[number])) {
    throw new ValidationError(CONTENT_TYPE_MESSAGE);
  }

  const parsed = ingestContentSchema.safeParse(
    Object.fromEntries(
      [
        "source",
        "contributor",
        "rightsHolder",
        "attribution",
        "sourceUrl",
        "licenseNotes",
        "title",
        "body",
        "durationSeconds",
      ]
        .map((key) => [key, formData.get(key)])
        .filter(([, value]) => value !== null && value !== ""),
    ),
  );
  if (!parsed.success) {
    throw new ValidationError(
      "Check the rights details.",
      parsed.error.flatten(),
    );
  }

  const asset = await ingestClip(
    new ObjectId(session.user.id),
    parsed.data,
    { buffer: Buffer.from(await file.arrayBuffer()), contentType: file.type },
  );

  return jsonOk(asset);
});
