import "server-only";
import {
  generateGameFilmAnalysis,
  type GameFilmAnalysisInput,
  type GeneratedGameFilmAnalysis,
} from "@/lib/game-film-templates";
import {
  buildSystemPrompt,
  buildUserPrompt,
  describeVisionBasis,
  parseVisionResponse,
} from "@/lib/game-film-vision";
import {
  createVisionCompletion,
  isOpenAiConfigured,
} from "@/server/external/openaiClient";
import { logger } from "@/server/logger";

/**
 * Produces the strengths/weaknesses/recommendations layer for Game Film
 * (BRD 7.7), behind the interface the implementation plan specified alongside
 * ShotMechanicalAnalysisProvider.
 *
 * Two implementations sit behind this seam, and which one ran is reported back
 * on the result as `provenance` - never assumed by the caller:
 *
 *   - `VisionGameFootageAnalysisProvider` sends stills sampled from the
 *     player's own upload to a vision model and reports what it read off them,
 *     including timestamped events. This is what makes BRD 7.7's "identify
 *     relevant events" real rather than empty.
 *   - `SimulatedGameFootageAnalysisProvider` is the fallback for when no model
 *     is configured, the browser couldn't decode the video, or the vision pass
 *     fails. It never claims anything was watched (BRD v1.1 §5).
 *
 * As with the shot provider, the real logic lives in isomorphic `@/lib`
 * modules so it stays unit-testable outside a Next.js server context; this
 * file is only the seam plus the fallback decision.
 */
export type { GameFilmAnalysisInput, GeneratedGameFilmAnalysis };

export interface GameFootageAnalysisProvider {
  analyze(input: GameFilmAnalysisInput): Promise<GeneratedGameFilmAnalysis>;
}

export class SimulatedGameFootageAnalysisProvider
  implements GameFootageAnalysisProvider
{
  async analyze(
    input: GameFilmAnalysisInput,
  ): Promise<GeneratedGameFilmAnalysis> {
    return generateGameFilmAnalysis(input);
  }
}

/**
 * Thrown when the frames themselves are the problem - wrong sport, too dark,
 * subject not identifiable. Distinct from a transport failure because the
 * player can act on it: re-upload a clearer clip, or say which jersey to
 * follow.
 */
export class UnusableFootageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableFootageError";
  }
}

export class VisionGameFootageAnalysisProvider
  implements GameFootageAnalysisProvider
{
  async analyze(
    input: GameFilmAnalysisInput,
  ): Promise<GeneratedGameFilmAnalysis> {
    const frames = input.frames ?? [];
    if (frames.length === 0) {
      throw new Error("No frames were supplied for vision analysis.");
    }

    const raw = await createVisionCompletion(
      buildSystemPrompt(),
      buildUserPrompt({
        frames,
        subject: input.subject,
        position: input.position,
        competitiveLevel: input.competitiveLevel,
      }),
      frames.map((frame) => ({
        base64: frame.base64,
        label: `Frame at ${frame.timestampInVideoSeconds}s:`,
      })),
    );

    const parsed = parseVisionResponse(
      raw,
      frames.map((f) => f.timestampInVideoSeconds),
    );

    if (!parsed.usable) {
      throw new UnusableFootageError(
        parsed.unusableReason ??
          "We couldn't make out enough in that clip to review it.",
      );
    }
    if (!parsed.subjectFound) {
      throw new UnusableFootageError(
        "We couldn't pick you out in that clip. Re-upload it and tell us your jersey colour and number so we know who to follow.",
      );
    }
    // A pass that reads the footage but finds nothing worth saying is not a
    // useful report. Falling back gives the player something actionable
    // instead of an empty page.
    if (parsed.weaknesses.length === 0 && parsed.strengths.length === 0) {
      throw new UnusableFootageError(
        "The review came back empty - there wasn't enough visible play in that clip.",
      );
    }

    return {
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      events: parsed.events,
      provenance: "vision_model",
      framesAnalyzed: frames.length,
      basis: describeVisionBasis(frames.length, input.subject),
    };
  }
}

/** True when a real analysis pass is possible for this upload. */
export function canRunVisionAnalysis(input: GameFilmAnalysisInput): boolean {
  return isOpenAiConfigured() && (input.frames?.length ?? 0) > 0;
}

export function getGameFootageAnalysisProvider(
  input: GameFilmAnalysisInput,
): GameFootageAnalysisProvider {
  return canRunVisionAnalysis(input)
    ? new VisionGameFootageAnalysisProvider()
    : new SimulatedGameFootageAnalysisProvider();
}

/**
 * Runs the best available analysis, degrading rather than failing.
 *
 * A transport hiccup or an unreadable clip shouldn't leave the player with
 * nothing - they still get the profile-based review, correctly labelled as
 * such, so the report is honest about having fallen back rather than silently
 * presenting heuristics as a real read of their footage.
 */
export async function analyzeWithBestProvider(
  input: GameFilmAnalysisInput,
): Promise<GeneratedGameFilmAnalysis> {
  if (!canRunVisionAnalysis(input)) {
    return new SimulatedGameFootageAnalysisProvider().analyze(input);
  }

  try {
    return await new VisionGameFootageAnalysisProvider().analyze(input);
  } catch (err) {
    logger.warn(
      {
        analysisId: input.analysisId,
        unusable: err instanceof UnusableFootageError,
        err,
      },
      "Vision analysis failed - falling back to the profile-based review",
    );
    return new SimulatedGameFootageAnalysisProvider().analyze(input);
  }
}
