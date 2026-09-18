/**
 * The real analysis layer for Game Film (BRD 7.7's "process an uploaded game
 * video and identify relevant events").
 *
 * Everything here is pure: prompt construction, the response schema, and
 * parsing/validating what comes back. The network call itself lives in
 * `@/server/external/openaiClient`, and the provider that ties the two
 * together is `@/server/services/gameFootageAnalysisProvider`. Keeping the
 * hard part - what we ask for and what we accept back - isomorphic means it is
 * unit-testable with no API key and no server context.
 *
 * Two rules shape the prompt, and both exist because the alternative is a
 * confident lie:
 *
 *   1. The model sees *still frames*, not video. It cannot see what happened
 *      between them, so it is told to report only what a frame shows and to
 *      cite only timestamps we actually sent. An "event" invented between
 *      frames would be indistinguishable to the player from a real one.
 *   2. A game clip has ten players in it. Without knowing which one is the
 *      user, any report is about a stranger. The subject description is
 *      therefore load-bearing, and the model is told to say so rather than
 *      guess when it can't find them.
 */
import {
  GAME_ANALYSIS_CATEGORIES,
  GAME_CATEGORY_LABELS,
  type GameAnalysisCategory,
} from "@/lib/game-film-categories";
import type { CompetitiveLevel, GameEvent, GameFilmSubject } from "@/types/db";

export const GAME_EVENT_TYPES = [
  "shot",
  "turnover",
  "assist",
  "drive",
  "defensive_stop",
  "off_ball_movement",
] as const;

/** One still lifted out of the player's upload, with where it came from. */
export interface GameFilmFrame {
  /** Bare base64 JPEG payload - no `data:` prefix. */
  base64: string;
  timestampInVideoSeconds: number;
}

export interface VisionPromptInput {
  frames: GameFilmFrame[];
  subject?: GameFilmSubject;
  position?: string;
  competitiveLevel?: CompetitiveLevel;
}

/**
 * How many frames are worth sending. Enough to cover a few possessions,
 * few enough to keep one analysis inside a couple of cents and well under the
 * request timeout. Sampling is even across the clip rather than clustered, so
 * a long upload is represented end to end.
 */
export const MAX_FRAMES = 12;
export const FRAME_WIDTH_PX = 512;

/** Evenly spaced sample points across a clip, avoiding the very first frame
 * (often black) and the very last (often a freeze). */
export function frameTimestamps(
  durationSeconds: number,
  count: number = MAX_FRAMES,
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const usable = Math.max(1, Math.min(count, Math.floor(durationSeconds)));
  const step = durationSeconds / (usable + 1);
  return Array.from({ length: usable }, (_, i) =>
    Number((step * (i + 1)).toFixed(2)),
  );
}

const CATEGORY_LIST = GAME_ANALYSIS_CATEGORIES.map(
  (c) => `"${c}" (${GAME_CATEGORY_LABELS[c]})`,
).join(", ");

export function buildSystemPrompt(): string {
  return [
    "You are a basketball development analyst reviewing a youth or teen player's game footage.",
    "",
    "You are shown a series of STILL FRAMES sampled from one video. Each frame is labelled with its timestamp in seconds. You are not watching video: you cannot see motion, and you cannot see anything that happened between two frames.",
    "",
    "Rules you must follow:",
    "- Describe only what is visible in a frame you were given. Never infer a play, a make, a miss, or a turnover that you did not see.",
    "- Every timestamp you cite must be one of the labelled frame timestamps. Never invent a timestamp.",
    "- If you cannot confidently identify the subject player, set subjectFound to false and return no events and no observations. Do not analyse a different player instead.",
    "- If the footage is not basketball, is too dark or distant to read, or shows no players, set usable to false and explain briefly in unusableReason.",
    "- Prefer fewer, well-grounded findings over a full list. It is correct to return two weaknesses instead of three if only two are supported by the frames.",
    "",
    `Every observation must be filed under exactly one of these categories: ${CATEGORY_LIST}.`,
    "",
    "Write observations in second person, addressed to the player, and make them specific and actionable - name the mechanism, not a grade. Each weakness must carry a recommendation that describes a concrete thing to practise.",
    "",
    "Respond with a single JSON object and nothing else.",
  ].join("\n");
}

export function buildUserPrompt(input: VisionPromptInput): string {
  const lines: string[] = [];

  const subjectParts: string[] = [];
  if (input.subject?.jerseyColor) {
    subjectParts.push(`wearing a ${input.subject.jerseyColor} jersey`);
  }
  if (input.subject?.jerseyNumber) {
    subjectParts.push(`number ${input.subject.jerseyNumber}`);
  }

  lines.push(
    subjectParts.length > 0
      ? `The player to analyse is the one ${subjectParts.join(", ")}. Analyse only that player.`
      : "The player did not say which uniform they are wearing. If you cannot tell which player is the subject, set subjectFound to false rather than guessing.",
  );

  if (input.position) lines.push(`They play ${input.position}.`);
  if (input.competitiveLevel) {
    lines.push(`They compete at ${input.competitiveLevel.replace(/_/g, " ")} level.`);
  }

  lines.push(
    "",
    `${input.frames.length} frames follow, in chronological order. Their timestamps are: ${input.frames
      .map((f) => `${f.timestampInVideoSeconds}s`)
      .join(", ")}.`,
  );

  lines.push(
    "",
    "Return JSON shaped exactly like this:",
    JSON.stringify(
      {
        usable: true,
        unusableReason: null,
        subjectFound: true,
        events: [
          {
            type: GAME_EVENT_TYPES[0],
            timestampInVideoSeconds: 0,
            description: "what is visible in that frame",
          },
        ],
        strengths: [{ category: GAME_ANALYSIS_CATEGORIES[0], text: "..." }],
        weaknesses: [
          {
            category: GAME_ANALYSIS_CATEGORIES[0],
            text: "...",
            recommendation: "...",
          },
        ],
      },
      null,
      2,
    ),
  );

  return lines.join("\n");
}

export interface VisionObservation {
  category: GameAnalysisCategory;
  text: string;
  recommendation?: string;
}

export interface ParsedVisionAnalysis {
  usable: boolean;
  unusableReason?: string;
  subjectFound: boolean;
  events: GameEvent[];
  strengths: VisionObservation[];
  weaknesses: VisionObservation[];
}

function isCategory(value: unknown): value is GameAnalysisCategory {
  return (
    typeof value === "string" &&
    (GAME_ANALYSIS_CATEGORIES as readonly string[]).includes(value)
  );
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseObservations(
  raw: unknown,
  { requireRecommendation }: { requireRecommendation: boolean },
): VisionObservation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<GameAnalysisCategory>();
  const out: VisionObservation[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (!isCategory(record.category)) continue;
    const text = cleanText(record.text);
    if (!text) continue;
    // One finding per category keeps the report readable and keeps the
    // weakness -> workout mapping one-to-one.
    if (seen.has(record.category)) continue;

    const recommendation = cleanText(record.recommendation);
    if (requireRecommendation && !recommendation) continue;

    seen.add(record.category);
    out.push({ category: record.category, text, ...(recommendation ? { recommendation } : {}) });
  }

  return out;
}

/**
 * Turns the model's reply into something safe to persist.
 *
 * Every field is treated as untrusted. The timestamp check is the important
 * one: an event is dropped unless it names a frame we actually sent, which is
 * what stops a hallucinated moment from being rendered as a seekable point in
 * the player's own video.
 */
export function parseVisionResponse(
  raw: string,
  sentTimestamps: number[],
): ParsedVisionAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      usable: false,
      unusableReason: "The analysis came back in a format we couldn't read.",
      subjectFound: false,
      events: [],
      strengths: [],
      weaknesses: [],
    };
  }

  const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;

  const usable = record.usable !== false;
  const subjectFound = record.subjectFound !== false;

  if (!usable || !subjectFound) {
    return {
      usable,
      unusableReason: cleanText(record.unusableReason),
      subjectFound,
      events: [],
      strengths: [],
      weaknesses: [],
    };
  }

  const allowed = new Set(sentTimestamps.map((t) => Number(t.toFixed(2))));
  const events: GameEvent[] = Array.isArray(record.events)
    ? record.events.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const e = entry as Record<string, unknown>;
        const type = e.type;
        const description = cleanText(e.description);
        const at = Number(e.timestampInVideoSeconds);
        if (
          typeof type !== "string" ||
          !(GAME_EVENT_TYPES as readonly string[]).includes(type) ||
          !description ||
          !Number.isFinite(at) ||
          !allowed.has(Number(at.toFixed(2)))
        ) {
          return [];
        }
        return [
          {
            type: type as GameEvent["type"],
            timestampInVideoSeconds: Number(at.toFixed(2)),
            description,
          },
        ];
      })
    : [];

  return {
    usable: true,
    subjectFound: true,
    events,
    strengths: parseObservations(record.strengths, { requireRecommendation: false }),
    weaknesses: parseObservations(record.weaknesses, { requireRecommendation: true }),
  };
}

/** What the report says its findings rest on, on the vision path. */
export function describeVisionBasis(
  framesAnalyzed: number,
  subject?: GameFilmSubject,
): string {
  const who = [
    subject?.jerseyColor ? `${subject.jerseyColor} jersey` : undefined,
    subject?.jerseyNumber ? `#${subject.jerseyNumber}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return who
    ? `Read from ${framesAnalyzed} frames sampled across your clip, following the player in the ${who}.`
    : `Read from ${framesAnalyzed} frames sampled across your clip.`;
}
