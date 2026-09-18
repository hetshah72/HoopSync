import { ObjectId } from "mongodb";
import { after } from "next/server";
import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import { UnauthorizedError, ValidationError } from "@/server/errors";
import {
  runGameFootageAnalysis,
  startGameFootageAnalysis,
} from "@/server/services/gameFootageService";
import { checkRateLimit } from "@/server/lib/rateLimiter";
import { MAX_FRAMES, type GameFilmFrame } from "@/lib/game-film-vision";
import { logger } from "@/server/logger";

/**
 * Game footage is full-game or long-possession video rather than a short
 * shooting clip, so the ceiling is higher than the shot-session route's.
 */
const MAX_BYTES = 250 * 1024 * 1024;

/** Roughly 2MB of base64 per frame is far more than a 512px JPEG needs. */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/**
 * Analysis runs after the response via `after()`, which keeps the invocation
 * alive until it settles - so the route's own ceiling has to cover a
 * multi-frame vision call, not just the upload.
 */
export const maxDuration = 300;

/** A metered vision call per upload, so this needs a cost ceiling per player. */
const MAX_UPLOADS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function parseFrames(formData: FormData): GameFilmFrame[] {
  const raw = formData.get("frames");
  if (typeof raw !== "string" || raw.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A browser that couldn't decode the video is an expected, recoverable
    // case - the analysis just falls back - so this is not a 400.
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const base64 = record.base64;
      const at = Number(record.timestampInVideoSeconds);
      if (
        typeof base64 !== "string" ||
        base64.length === 0 ||
        base64.length > MAX_FRAME_BYTES ||
        !Number.isFinite(at) ||
        at < 0
      ) {
        return [];
      }
      return [{ base64, timestampInVideoSeconds: at }];
    })
    .slice(0, MAX_FRAMES);
}

function optionalText(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : undefined;
}

export const POST = withErrorHandling(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("You must be signed in.");
  }

  checkRateLimit(
    `game-footage:${session.user.id}`,
    MAX_UPLOADS_PER_WINDOW,
    RATE_WINDOW_MS,
  );

  const formData = await request.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new ValidationError("No video file was provided.");
  }
  if (file.size === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError(
      "That video is too large - keep game clips under 250MB for now.",
    );
  }
  if (!file.type.startsWith("video/")) {
    throw new ValidationError("Please upload a video file.");
  }

  const userId = new ObjectId(session.user.id);
  const buffer = Buffer.from(await file.arrayBuffer());
  const frames = parseFrames(formData);

  const analysis = await startGameFootageAnalysis(userId, buffer, file.type, {
    jerseyColor: optionalText(formData, "jerseyColor", 40),
    jerseyNumber: optionalText(formData, "jerseyNumber", 8),
  });

  // The player gets their analysis id - and the report screen - immediately;
  // the model call happens after this response has gone out.
  after(async () => {
    try {
      await runGameFootageAnalysis(userId, analysis._id, frames);
    } catch (err) {
      logger.error(
        { userId: session.user!.id, analysisId: analysis._id.toString(), err },
        "Post-response game footage analysis threw",
      );
    }
  });

  return jsonOk({ analysisId: analysis._id.toString() });
});
