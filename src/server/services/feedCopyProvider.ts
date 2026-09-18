import "server-only";
import {
  createChatCompletion,
  isOpenAiConfigured,
} from "@/server/external/openaiClient";
import { PERSONALITY_PROMPTS } from "@/server/services/coachPromptService";
import { logger } from "@/server/logger";
import type { FeedCardCopy } from "@/lib/feed-copy-templates";
import type { CoachPersonality } from "@/types/db";

/**
 * Writes the prose for generated feed cards.
 *
 * Behind an interface for the same reason `ShotMechanicalAnalysisProvider`
 * is: the implementation is swappable and nothing above this layer knows or
 * cares which one ran. Here the two implementations are "use the
 * deterministic templates as-is" and "let a language model rewrite them",
 * and the choice is made by whether an API key is configured - so Home works
 * identically, with no dead cards, on a machine that has never seen
 * OPENAI_API_KEY.
 *
 * The contract that makes an AI rewrite safe: the templates have already
 * computed every number from the player's own records, and the rewriter may
 * only restate them. `groundedOrNull` enforces that mechanically rather than
 * trusting the prompt - a rewrite that introduces a figure nobody measured
 * is discarded and the template copy stands. This is the structural answer
 * to the audit's highest-severity finding, a card that stated a fabricated
 * weakness to every account (P0_FINAL_QA §2.3, Bug Feed-1).
 */

export interface FeedCopyRequest {
  /** Unique within a batch - the card's kind. */
  key: string;
  /** What this card is for, in one line, to steer the rewrite. */
  purpose: string;
  /** Measured, player-owned figures this card may cite. May be empty. */
  facts: string[];
  /** Deterministic copy, already correct. The rewrite must not contradict it. */
  fallback: FeedCardCopy;
}

export interface FeedCopyContext {
  personality: CoachPersonality;
  /** One line of real profile facts, or null if the player has no profile. */
  profileSummary: string | null;
}

export interface FeedCopyProvider {
  /** Returns copy per request key. Always returns an entry for every request. */
  write(
    requests: FeedCopyRequest[],
    context: FeedCopyContext,
  ): Promise<Map<string, FeedCardCopy>>;
}

const TITLE_MAX = 70;
const BODY_MAX = 280;
const MAX_TOKENS = 1200;
const TIMEOUT_MS = 12_000;

function fallbackMap(requests: FeedCopyRequest[]): Map<string, FeedCardCopy> {
  return new Map(requests.map((request) => [request.key, request.fallback]));
}

/** Every distinct numeric literal in a string, as written. */
function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Accepts a rewrite only if every number in it was already present in the
 * card's measured facts or its template copy.
 *
 * The rewriter's job is to reword, not to compute. Any figure it introduces
 * is one nobody derived from the player's records, so the whole rewrite is
 * rejected rather than partially trusted.
 */
function groundedOrNull(
  candidate: FeedCardCopy,
  request: FeedCopyRequest,
): FeedCardCopy | null {
  const allowed = new Set([
    ...request.facts.flatMap(numbersIn),
    ...numbersIn(request.fallback.title),
    ...numbersIn(request.fallback.body),
  ]);

  const title = candidate.title.trim();
  const body = candidate.body.trim();
  if (!title || !body) return null;
  if (title.length > TITLE_MAX || body.length > BODY_MAX) return null;

  const introduced = [...numbersIn(title), ...numbersIn(body)].filter(
    (value) => !allowed.has(value),
  );
  if (introduced.length > 0) return null;

  return { title, body };
}

const SYSTEM_PROMPT = [
  "You write short cards for the Home feed of HoopSync, a basketball training app for youth and teen players.",
  "You will be given cards that already have correct copy and a list of measured facts about this specific player.",
  "Rewrite each card's title and body so the feed reads fresh and personal.",
  "",
  "Hard rules:",
  "- Never introduce a number, statistic, percentage, date or count that is not already in that card's facts or its current copy. If you are unsure, reuse the existing wording.",
  "- Never claim the player did something the facts do not state. Never invent sessions, games, results or trends.",
  "- Keep the same meaning and the same call to action as the current copy.",
  `- Title: at most ${TITLE_MAX} characters, no trailing period, no emoji.`,
  `- Body: at most ${BODY_MAX} characters, one or two sentences, second person ("you").`,
  "- Plain language a 13-year-old reads easily. No hype, no exclamation marks, no hashtags.",
  "",
  'Reply with JSON only: {"cards":[{"key":"...","title":"...","body":"..."}]} covering every key you were given.',
].join("\n");

class AiFeedCopyProvider implements FeedCopyProvider {
  async write(
    requests: FeedCopyRequest[],
    context: FeedCopyContext,
  ): Promise<Map<string, FeedCardCopy>> {
    const result = fallbackMap(requests);
    if (requests.length === 0) return result;

    const userPrompt = JSON.stringify({
      player: context.profileSummary ?? "No profile details on file.",
      cards: requests.map((request) => ({
        key: request.key,
        purpose: request.purpose,
        measuredFacts: request.facts,
        currentTitle: request.fallback.title,
        currentBody: request.fallback.body,
      })),
    });

    let raw: string;
    try {
      raw = await createChatCompletion(
        [
          {
            role: "system",
            content: `${SYSTEM_PROMPT}\n\nMatch this coaching tone:\n${PERSONALITY_PROMPTS[context.personality]}`,
          },
          { role: "user", content: userPrompt },
        ],
        { json: true, maxTokens: MAX_TOKENS, temperature: 0.8, timeoutMs: TIMEOUT_MS },
      );
    } catch (err) {
      // Home must still render. Template copy is already correct, just less
      // varied, so a failed rewrite is a cosmetic loss and never an error
      // the player sees.
      logger.warn({ err }, "Feed copy rewrite failed; using template copy");
      return result;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn("Feed copy rewrite returned unparseable JSON; using template copy");
      return result;
    }

    const cards = (parsed as { cards?: unknown })?.cards;
    if (!Array.isArray(cards)) return result;

    const byKey = new Map(requests.map((request) => [request.key, request]));
    let rejected = 0;

    for (const card of cards) {
      const { key, title, body } = (card ?? {}) as Record<string, unknown>;
      if (typeof key !== "string" || typeof title !== "string" || typeof body !== "string") {
        continue;
      }
      const request = byKey.get(key);
      if (!request) continue;

      const grounded = groundedOrNull({ title, body }, request);
      if (grounded) {
        result.set(key, grounded);
      } else {
        rejected++;
      }
    }

    if (rejected > 0) {
      logger.warn(
        { rejected },
        "Discarded feed copy rewrites that introduced ungrounded numbers",
      );
    }
    return result;
  }
}

class TemplateFeedCopyProvider implements FeedCopyProvider {
  async write(requests: FeedCopyRequest[]): Promise<Map<string, FeedCardCopy>> {
    return fallbackMap(requests);
  }
}

/**
 * Which provider ran is recorded per card as `provenance.copySource`, so the
 * UI can label AI-written prose without having to ask this module.
 */
export function getFeedCopyProvider(): {
  provider: FeedCopyProvider;
  copySource: "template" | "ai";
} {
  return isOpenAiConfigured()
    ? { provider: new AiFeedCopyProvider(), copySource: "ai" }
    : { provider: new TemplateFeedCopyProvider(), copySource: "template" };
}
