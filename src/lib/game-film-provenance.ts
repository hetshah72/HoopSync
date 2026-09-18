/**
 * How a Game Film report describes its own origin.
 *
 * Every surface that shows or forwards a report - the results screen, the
 * upload form, the Coach context block, the Coach opening line - has to say
 * the same true thing about where the findings came from. Keeping that copy
 * here, isomorphic and unit-testable, is what stops those four surfaces from
 * drifting apart, which is exactly how an honesty rule quietly breaks.
 *
 * The bar (CLAUDE.md, BRD v1.1 §5): generated analysis must be visibly labeled
 * and never presented as if it were measured. That cuts two ways now that real
 * analysis exists:
 *
 *   - `vision_model` findings came from frames out of the player's own video,
 *     so they may describe the footage - but a vision model misreads things,
 *     so they are labeled as fallible AI rather than as measurement.
 *   - `heuristic` findings came from the player's profile and nothing else, so
 *     they must never imply anything was watched at all.
 */
import type { AnalysisProvenance, GameFilmSubject } from "@/types/db";

/**
 * Documents written before real analysis existed carry no `provenance`. They
 * were all generated, so absent means heuristic - never the other way round.
 * Defaulting the other direction would retroactively relabel old generated
 * reports as real footage analysis.
 */
export function resolveAnalysisProvenance(analysis: {
  provenance?: AnalysisProvenance;
}): AnalysisProvenance {
  return analysis.provenance ?? "heuristic";
}

export interface ProvenanceDisclosure {
  /** Card heading on the report. */
  headline: string;
  /** The honest sentence under it. */
  detail: string;
}

export function provenanceDisclosure(
  provenance: AnalysisProvenance,
  framesAnalyzed?: number,
): ProvenanceDisclosure {
  if (provenance === "vision_model") {
    const frames =
      framesAnalyzed && framesAnalyzed > 0
        ? `${framesAnalyzed} frames sampled from your video`
        : "frames sampled from your video";
    return {
      headline: "How this review was made",
      detail:
        `An AI model looked at ${frames} and wrote these findings from what it saw. ` +
        "It sees still frames rather than continuous play, and it can misread " +
        "what happened - treat this as a second opinion to check against the " +
        "tape, not as a measurement.",
    };
  }

  return {
    headline: "How this review was made",
    detail:
      "Nothing in your video was analysed. These are the habits most worth " +
      "checking for a player with your position, level and focus areas - a " +
      "coaching profile to compare your own tape against, not a report on it.",
  };
}

/**
 * The line the Coach conversation opens with. Composed here (not by the LLM)
 * so it is instant, works with no API key, and cannot overstate the report.
 */
export function provenanceOpeningLine(provenance: AnalysisProvenance): string {
  return provenance === "vision_model"
    ? "I've got your game film review. It came from an AI pass over frames from your video, so it's a read rather than a measurement - worth checking against the tape."
    : "I've got your game film review. Worth saying up front: nothing in the video was analysed - it's a coaching profile built from your position, level and focus areas, so treat it as a starting point rather than a verdict.";
}

/**
 * The instruction that rides along with the report in the Coach system prompt.
 * Written at the model, not the player.
 */
export function provenanceCoachPreamble(
  provenance: AnalysisProvenance,
  framesAnalyzed?: number,
): string {
  if (provenance === "vision_model") {
    const frames = framesAnalyzed && framesAnalyzed > 0 ? ` (${framesAnalyzed} frames)` : "";
    return (
      `IMPORTANT: these findings came from an AI vision pass over sampled frames${frames} of the player's video. ` +
      "They describe what the model believes it saw, which may be wrong. Reference them as observations to verify, never as measured fact."
    );
  }
  return (
    "IMPORTANT: this review is heuristic, generated from the player's profile - nothing here was detected in their video. " +
    "If you reference it, describe it as a starting point to discuss, never as something observed."
  );
}

/**
 * What to call the two findings columns.
 *
 * On the vision path these really are strengths and weaknesses read off the
 * footage. On the heuristic path they are neither - they are patterns worth
 * checking - and labelling them "Strengths" would assert something nobody
 * looked for. The headings carry that distinction so the observation copy
 * underneath doesn't have to repeat a disclaimer in every line.
 */
export function provenanceSectionHeadings(provenance: AnalysisProvenance): {
  strengths: string;
  weaknesses: string;
} {
  return provenance === "vision_model"
    ? { strengths: "Strengths", weaknesses: "Needs work" }
    : {
        strengths: "Likely strengths for your profile",
        weaknesses: "Most worth checking",
      };
}

/** Renders the subject the player named, e.g. "red jersey, #23". */
export function describeSubject(subject?: GameFilmSubject): string | undefined {
  if (!subject) return undefined;
  const parts: string[] = [];
  if (subject.jerseyColor) parts.push(`${subject.jerseyColor} jersey`);
  if (subject.jerseyNumber) parts.push(`#${subject.jerseyNumber}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}
