import "server-only";
import type { ObjectId } from "mongodb";
import {
  createChatCompletion,
  isOpenAiConfigured,
} from "@/server/external/openaiClient";
import { logger } from "@/server/logger";
import type {
  MechanicalBreakdown,
  MechanicalFinding,
  ShotFeedback,
  ShotZone,
} from "@/types/db";
import {
  drillSlugForBreakdown as computeDrillSlugForBreakdown,
  generateMechanicalBreakdown,
  type MechanicalAnalysisInput,
  type ZoneStats,
} from "@/lib/shot-mechanical-templates";
import {
  generateFindings,
  PARAMETER_LABELS,
  type MechanicsInput,
} from "@/lib/shot-mechanics";
import {
  generateFeedbackForSession,
  headlineFor,
  type ShotFeedbackInput,
} from "@/lib/shot-feedback";

/**
 * Generates the "why did you miss" narrative layer. Shot make/miss/location
 * is real (manual tap-to-log) - this provider only ever touches the generated
 * mechanical explanation on top of that real data, and the service marks the
 * result before it reaches the UI. A real pose-estimation provider
 * implementing this same interface is Phase 2 (BRD v1.1 §5) - nothing above
 * the service layer changes when that lands.
 *
 * Two implementations, chosen the way `feedCopyProvider` chooses: the
 * templates compute every finding first, and the AI implementation may only
 * *reword* what they produced. That ordering is what makes the AI path safe -
 * the structure, the drill and every number are already fixed before a model
 * sees them, and `rewriteOrNull` discards any rewrite that breaks them.
 *
 * The template banks live in the isomorphic `@/lib/shot-mechanics` and
 * `@/lib/shot-mechanical-templates` so scripts and unit tests can reach them
 * outside a Next.js server context.
 */
export type { ZoneStats, MechanicalAnalysisInput, ShotFeedbackInput };

/** A finding as generated - the service resolves `drillId` from `drillSlug`. */
export type GeneratedFinding = Omit<MechanicalFinding, "drillId">;

export interface ShotMechanicalAnalysisProvider {
  generateBreakdown(
    input: MechanicalAnalysisInput,
  ): Promise<
    Omit<MechanicalBreakdown, "targetZone" | "isSimulated" | "findings">
  >;
  /**
   * The one-line identity of a shot ("Miss - Right Wing 3"), available the
   * moment it is logged - before the session context full feedback needs
   * exists.
   */
  headlineForShot(zone: ShotZone, made: boolean): string;
  /**
   * Four-part feedback for every shot in the session, keyed by shot id
   * (BRD 7.6 requires the structure in *every* piece of feedback). Runs at
   * finalize because the observation quotes session-wide zone tallies.
   */
  generateShotFeedback(
    shots: (MechanicsInput["shots"][number] & { id: string })[],
  ): Map<string, ShotFeedback>;
  /**
   * The nine-parameter form analysis BRD 7.6 requires. `focusZone` is the
   * session's weakest zone, whose real tally the generated observations cite.
   */
  generateFindings(
    input: MechanicsInput,
    focusZone: ShotZone,
  ): Promise<GeneratedFinding[]>;
}

// ---------------------------------------------------------------------------
// Guards - enforced in code, never trusted to the prompt
// ---------------------------------------------------------------------------

/** Every distinct numeric literal in a string, as written. */
function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Phrasing that would present generated coaching inference as an observed or
 * clinical fact.
 *
 * This is BRD 7.6's "must not present uncertain computer-vision conclusions as
 * medical or scientific fact" turned into something a test can assert. No
 * pose-estimation model runs in this codebase, so a rewrite claiming anything
 * was seen, detected or measured in the video is false on its face - and
 * injury/diagnosis phrasing is a claim a training app has no standing to make
 * about a young player at all.
 */
const BANNED_PHRASES = [
  "we measured",
  "we detected",
  "we observed",
  "analysis detected",
  "the video shows",
  "your video shows",
  "footage shows",
  "frame-by-frame",
  "detected in your",
  "measured at",
  "clinically",
  "diagnos",
  "injur",
  "proves",
  "scientifically",
  "medically",
];

const OBSERVATION_MAX = 420;
const CORRECTION_MAX = 320;

/**
 * Accepts a rewrite only if it kept every number, said nothing it has no
 * standing to say, and stayed the right length. The rewriter rewords; it does
 * not compute, conclude, or restructure.
 */
export function rewriteOrNull(
  candidate: { observation: string; correction: string },
  original: GeneratedFinding,
): { observation: string; correction: string } | null {
  const observation = candidate.observation?.trim();
  const correction = candidate.correction?.trim();
  if (!observation || !correction) return null;
  if (
    observation.length > OBSERVATION_MAX ||
    correction.length > CORRECTION_MAX
  ) {
    return null;
  }

  // Same contract as feedCopyProvider's groundedOrNull: a figure nobody
  // derived from the player's records is a fabrication, so the whole rewrite
  // goes rather than being partially trusted.
  const allowed = new Set([
    ...numbersIn(original.observation),
    ...numbersIn(original.correction),
  ]);
  const introduced = [
    ...numbersIn(observation),
    ...numbersIn(correction),
  ].filter((value) => !allowed.has(value));
  if (introduced.length > 0) return null;

  // A measured observation is the player's own logged numbers. Dropping one
  // turns a measured claim into a vague one still wearing the "from your
  // logged shots" badge, so every figure has to survive.
  if (original.basis === "measured") {
    const kept = new Set(numbersIn(observation));
    if (numbersIn(original.observation).some((value) => !kept.has(value)))
      return null;
  }

  const haystack = `${observation} ${correction}`.toLowerCase();
  if (BANNED_PHRASES.some((phrase) => haystack.includes(phrase))) return null;

  return { observation, correction };
}

const SYSTEM_PROMPT = [
  "You reword shooting-form feedback for HoopSync, a basketball training app for youth and teen players.",
  "Each finding already has correct content. Reword only its observation and its correction so the report reads less templated.",
  "",
  "Hard rules:",
  "- Never introduce a number, percentage, count or measurement that is not already in that finding's text. Reuse every number exactly as written.",
  "- Never claim anything was seen, detected, measured or analysed in the player's video. No computer vision runs here. Findings marked as inference are coaching judgement, not observation.",
  "- Never make a medical, injury or diagnostic claim, and never state a mechanical cause as proven.",
  "- Keep the observation an observation, and the correction one concrete instruction the player can act on today.",
  "- Keep the same meaning. Never soften a correction into encouragement and never add motivational filler.",
  '- Plain language a 13-year-old reads easily. Second person ("you"). No exclamation marks, no hype, no emoji.',
  "",
  'Reply with JSON only: {"findings":[{"parameter":"...","observation":"...","correction":"..."}]} covering every parameter you were given.',
].join("\n");

const MAX_TOKENS = 2000;
const TIMEOUT_MS = 12_000;

export class TemplateShotMechanicalAnalysisProvider implements ShotMechanicalAnalysisProvider {
  async generateBreakdown(input: MechanicalAnalysisInput) {
    return generateMechanicalBreakdown(input);
  }

  headlineForShot(zone: ShotZone, made: boolean): string {
    return headlineFor(zone, made);
  }

  generateShotFeedback(
    shots: (MechanicsInput["shots"][number] & { id: string })[],
  ): Map<string, ShotFeedback> {
    return generateFeedbackForSession(shots);
  }

  async generateFindings(
    input: MechanicsInput,
    focusZone: ShotZone,
  ): Promise<GeneratedFinding[]> {
    return generateFindings(input, focusZone);
  }
}

export class AiShotMechanicalAnalysisProvider implements ShotMechanicalAnalysisProvider {
  private readonly templates = new TemplateShotMechanicalAnalysisProvider();

  async generateBreakdown(input: MechanicalAnalysisInput) {
    return this.templates.generateBreakdown(input);
  }

  headlineForShot(zone: ShotZone, made: boolean): string {
    return this.templates.headlineForShot(zone, made);
  }

  generateShotFeedback(
    shots: (MechanicsInput["shots"][number] & { id: string })[],
  ): Map<string, ShotFeedback> {
    // Per-shot feedback is not rewritten by the model: there are up to a
    // hundred of them per session, they're short, and the structure matters
    // more than the prose. The rewrite budget goes to the nine findings.
    return this.templates.generateShotFeedback(shots);
  }

  async generateFindings(
    input: MechanicsInput,
    focusZone: ShotZone,
  ): Promise<GeneratedFinding[]> {
    const findings = await this.templates.generateFindings(input, focusZone);

    const userPrompt = JSON.stringify({
      findings: findings.map((finding) => ({
        parameter: finding.parameter,
        label: PARAMETER_LABELS[finding.parameter],
        basis:
          finding.basis === "measured"
            ? "computed from the player's own logged shots - keep every number exactly"
            : "coaching inference - no video was analysed",
        observation: finding.observation,
        correction: finding.correction,
      })),
    });

    let raw: string;
    try {
      raw = await createChatCompletion(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        {
          json: true,
          maxTokens: MAX_TOKENS,
          temperature: 0.7,
          timeoutMs: TIMEOUT_MS,
        },
      );
    } catch (err) {
      // Template findings are already correct, just more uniform, so a failed
      // rewrite is a cosmetic loss and never an error the player sees.
      logger.warn(
        { err },
        "Shot mechanics rewrite failed; using template findings",
      );
      return findings;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(
        "Shot mechanics rewrite returned unparseable JSON; using templates",
      );
      return findings;
    }

    const rows = (parsed as { findings?: unknown })?.findings;
    if (!Array.isArray(rows)) return findings;

    const byParameter = new Map<unknown, Record<string, unknown>>(
      rows
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => [row.parameter, row]),
    );
    let rejected = 0;

    const result = findings.map((finding) => {
      const row = byParameter.get(finding.parameter);
      if (!row) return finding;

      const accepted = rewriteOrNull(
        {
          observation:
            typeof row.observation === "string" ? row.observation : "",
          correction: typeof row.correction === "string" ? row.correction : "",
        },
        finding,
      );
      if (!accepted) {
        rejected++;
        return finding;
      }
      return { ...finding, ...accepted };
    });

    if (rejected > 0) {
      logger.warn(
        { rejected },
        "Discarded shot mechanics rewrites that broke grounding or hedging rules",
      );
    }
    return result;
  }
}

/**
 * Which implementation ran is reported alongside the provider, exactly as
 * `getFeedCopyProvider` reports `copySource`, so the UI can label AI-worded
 * prose without having to ask this module.
 */
export function getShotMechanicalAnalysisProvider(): {
  provider: ShotMechanicalAnalysisProvider;
  narrativeSource: "template" | "ai";
} {
  return isOpenAiConfigured()
    ? {
        provider: new AiShotMechanicalAnalysisProvider(),
        narrativeSource: "ai",
      }
    : {
        provider: new TemplateShotMechanicalAnalysisProvider(),
        narrativeSource: "template",
      };
}

export function drillSlugForBreakdown(
  weakestZone: ShotZone,
  sessionId: ObjectId,
): string {
  return computeDrillSlugForBreakdown(weakestZone, sessionId);
}
