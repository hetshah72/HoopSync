import "server-only";
import { composeFallbackReply } from "@/lib/coach-fallback";
import {
  createChatCompletion,
  isOpenAiConfigured,
  type ChatMessage,
} from "@/server/external/openaiClient";
import { logger } from "@/server/logger";
import type { CoachPersonality, CoachReplySource } from "@/types/db";

/**
 * Produces Coach's reply to a player message (BRD 7.9), behind the same seam
 * the other three AI surfaces already use.
 *
 * Coach was the one generated surface calling `createChatCompletion` directly,
 * which had two consequences. Architecturally it was the only AI path that
 * couldn't be swapped or tested at the seam. Practically it meant Coach had no
 * fallback: with no key configured it returned an error string and nothing
 * else, so the central feature of the app was a dead button - while Feed and
 * Game Film both degraded to something real.
 *
 * Two implementations sit behind this, and which one ran is reported back on
 * the result as `source` rather than assumed by the caller, exactly as
 * `GameFootageAnalysisProvider` reports `provenance`:
 *
 *   - `AiCoachResponseProvider` - the real model call.
 *   - `FallbackCoachResponseProvider` - composes a reply in code from the
 *     player's own records when no model is configured or the call fails. It
 *     states plainly that it is not a generated answer (`@/lib/coach-fallback`).
 *
 * As with the other providers, the composition logic lives in isomorphic
 * `@/lib` so it stays unit-testable outside a Next server context; this file is
 * only the seam plus the fallback decision.
 */
export type { CoachReplySource };

export interface CoachResponseInput {
  personality: CoachPersonality;
  /** The assembled system prompt (see `coachPromptService`). */
  systemPrompt: string;
  /** Prior turns, oldest first. */
  history: ChatMessage[];
  /**
   * Real, already-computed statements about this player, for the keyless path.
   * The fallback renders these verbatim and never computes its own.
   */
  fallbackFacts: string[];
  fallbackNextStep?: string;
  /** Included in failure logs so a broken conversation can be found again. */
  conversationId: string;
}

export interface CoachReply {
  content: string;
  source: CoachReplySource;
}

export interface CoachResponseProvider {
  respond(input: CoachResponseInput): Promise<CoachReply>;
}

export class AiCoachResponseProvider implements CoachResponseProvider {
  async respond(input: CoachResponseInput): Promise<CoachReply> {
    const content = await createChatCompletion([
      { role: "system", content: input.systemPrompt },
      ...input.history,
    ]);
    return { content, source: "ai" };
  }
}

export class FallbackCoachResponseProvider implements CoachResponseProvider {
  async respond(input: CoachResponseInput): Promise<CoachReply> {
    return {
      content: composeFallbackReply({
        personality: input.personality,
        facts: input.fallbackFacts,
        nextStep: input.fallbackNextStep,
      }),
      source: "fallback",
    };
  }
}

/** True when a real generated reply is possible. */
export function canRunAiCoach(): boolean {
  return isOpenAiConfigured();
}

export function getCoachResponseProvider(): CoachResponseProvider {
  return canRunAiCoach()
    ? new AiCoachResponseProvider()
    : new FallbackCoachResponseProvider();
}

/**
 * Runs the best available provider, degrading rather than failing.
 *
 * Mirrors `analyzeWithBestProvider`. A missing key, an outage, a quota error or
 * a timeout all land the player in the same place - a real, honest, persisted
 * reply built from their own data - instead of a message that hangs unanswered.
 *
 * The `logger.warn` here is the only place an AI failure is recorded. Without
 * it a bad key, an outage and an exhausted quota were indistinguishable from
 * each other and from a working install that nobody had configured (audit
 * finding: Coach's catch block swallowed every failure silently).
 */
export async function respondWithBestProvider(
  input: CoachResponseInput,
): Promise<CoachReply> {
  if (!canRunAiCoach()) {
    return new FallbackCoachResponseProvider().respond(input);
  }

  try {
    return await new AiCoachResponseProvider().respond(input);
  } catch (err) {
    logger.warn(
      { conversationId: input.conversationId, err },
      "Coach reply generation failed - falling back to the composed reply",
    );
    return new FallbackCoachResponseProvider().respond(input);
  }
}
