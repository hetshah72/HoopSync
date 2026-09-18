import type { CoachPersonality } from "@/types/db";

/**
 * The personality setting, applied to text HoopSync composes itself.
 *
 * BRD 7.9 requires that changing the personality "must actually change Coach's
 * responses, not just relabel them". `PERSONALITY_PROMPTS` in
 * `coachPromptService` already does that for generated replies - but a large
 * amount of what Coach actually says is composed in code, not by the model:
 * every Share With Coach / Ask Coach opening line, and the whole keyless
 * fallback reply. All of that used to be byte-identical across all four
 * settings, which meant the very first thing Coach ever said ignored the
 * setting completely.
 *
 * This is the code-side counterpart to the prompt fragments, kept isomorphic so
 * it is unit-testable outside a Next server context and so the copy lives in
 * one place rather than being re-improvised at each call site.
 *
 * Only the *framing* varies. Every number, zone and fact these wrap is passed
 * in by the caller and is identical across personalities - a blunt Coach and a
 * warm Coach must never disagree about what happened.
 */
export interface CoachVoice {
  /** Opens a shared report before any of its numbers are stated. */
  openerLead: string;
  /** Closes an opening line - the invitation to reply. */
  openerClose: string;
  /** Introduces the player's real data in a composed (non-generated) reply. */
  dataLeadIn: string;
  /** Introduces the concrete next step. */
  nextStepLeadIn: string;
}

export const COACH_VOICES: Record<CoachPersonality, CoachVoice> = {
  encouraging: {
    openerLead: "Nice work getting this logged -",
    openerClose: "What would you like to look at together?",
    dataLeadIn: "Here's what I can already see from your own numbers:",
    nextStepLeadIn: "A good next step:",
  },
  balanced: {
    openerLead: "Got it -",
    openerClose: "What do you want to dig into?",
    dataLeadIn: "Here's what your real data shows:",
    nextStepLeadIn: "Suggested next step:",
  },
  direct: {
    openerLead: "",
    openerClose: "What's the question?",
    dataLeadIn: "Your numbers:",
    nextStepLeadIn: "Do this next:",
  },
  elite_trainer: {
    openerLead: "Let's look at the tape -",
    openerClose: "Where do you want to start?",
    dataLeadIn: "The numbers on record:",
    nextStepLeadIn: "Priority work:",
  },
};

export function coachVoice(personality: CoachPersonality): CoachVoice {
  return COACH_VOICES[personality] ?? COACH_VOICES.balanced;
}

/**
 * Prefixes a factual sentence with the voice's lead.
 *
 * `direct` deliberately has no lead at all - leading with the problem rather
 * than a preamble is the whole of that setting - so this has to cope with an
 * empty string without leaving a stray space or lowercasing the sentence.
 */
export function leadWith(lead: string, sentence: string): string {
  if (!lead) return sentence;
  return `${lead} ${decapitalize(sentence)}`;
}

/**
 * Lowercases the sentence's first letter so the lead reads as one sentence -
 * except where English says that capital wasn't a sentence-initial one.
 *
 * Two exceptions, both of which were live: "I" is always capitalised, and an
 * acronym ("FG% held up") is not a sentence case at all. Without them three of
 * the four personalities opened Share With Coach with "Got it - i've got your
 * shooting session", which is the first line Coach ever says. The shot-session,
 * workout and post-game openers all begin "I've got your ...".
 */
function decapitalize(sentence: string): string {
  if (/^I(?:'|\b)/.test(sentence)) return sentence;
  if (/^[A-Z]{2,}/.test(sentence)) return sentence;
  return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}
