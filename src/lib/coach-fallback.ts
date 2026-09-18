import type { CoachPersonality } from "@/types/db";
import { coachVoice } from "@/lib/coach-voice";

/**
 * The reply Coach gives when no language model is available.
 *
 * Coach used to be the one AI surface in the app with no fallback at all: with
 * no `OPENAI_API_KEY` configured, sending a message persisted the player's
 * words and then returned nothing but an error string, which vanished on
 * reload. That left a dead button in the middle of the MVP loop (CLAUDE.md's
 * acceptance bar) and made BRD 7.9's headline success criterion - a
 * side-by-side personality comparison - impossible to demonstrate at all.
 *
 * Feed already solved this shape of problem with `TemplateFeedCopyProvider`,
 * and Confidence with `confidence-recovery.ts`: compose it in code from the
 * player's own records, so it is factual, instant, and works with no key.
 *
 * Two rules hold this together:
 *
 *   - It never impersonates a generated answer. It says plainly that
 *     conversational replies are offline and that what follows is the player's
 *     own recorded data, not an answer to what they asked. The caller also
 *     stamps the message `source: "fallback"` so the UI can label it - the same
 *     two-layer disclosure (in the copy *and* in the provenance) that Game Film
 *     uses for heuristic reports.
 *   - Every fact in it is passed in by the caller from real documents. This
 *     module composes and orders; it never computes a number and never invents
 *     one.
 */
export interface CoachFallbackInput {
  personality: CoachPersonality;
  /**
   * Real, already-computed statements about this player - "Shared session:
   * 4/5 (80%)", "Current streak: 3 days". Rendered verbatim.
   */
  facts: string[];
  /** The most useful concrete thing to do next, if one is derivable. */
  nextStep?: string;
}

/**
 * The honest opening, in the selected voice.
 *
 * Kept per-personality rather than shared because this sentence is the one the
 * player is most likely to read twice, and a single neutral sentence here would
 * undercut the setting exactly where it is most visible.
 */
const OFFLINE_NOTICE: Record<CoachPersonality, string> = {
  encouraging:
    "I can't talk this one through with you right now - my conversation model isn't connected yet. I don't want to leave you with nothing, though.",
  balanced:
    "Heads up: my conversation model isn't connected right now, so I can't answer that properly. Here's what I can still give you from your own records.",
  direct:
    "My conversation model isn't connected, so I can't answer that. What I do have is your own data.",
  elite_trainer:
    "Conversation model's offline, so I won't pretend to coach you through that question. What stands is the record.",
};

export function composeFallbackReply(input: CoachFallbackInput): string {
  const voice = coachVoice(input.personality);
  const parts: string[] = [OFFLINE_NOTICE[input.personality] ?? OFFLINE_NOTICE.balanced];

  if (input.facts.length > 0) {
    parts.push(`${voice.dataLeadIn}\n${input.facts.map((f) => `- ${f}`).join("\n")}`);
  }

  if (input.nextStep) {
    parts.push(`${voice.nextStepLeadIn} ${input.nextStep}`);
  }

  // Said last so it is the thing the player is left holding. Without it the
  // reply reads as a permanent limitation rather than a missing credential.
  parts.push(
    "Once a model is configured I'll be able to answer questions like that directly.",
  );

  return parts.join("\n\n");
}
