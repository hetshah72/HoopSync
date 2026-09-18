/**
 * "I want to play more like Paul George" (BRD 7.3) - deciding which skills a
 * workout modelled on a given NBA player should actually target.
 *
 * The previous implementation sorted the six editorial skill ratings and took
 * the top two. Roster-synced players are created with every rating set to 50,
 * so "top two" was really `Object.entries` insertion order - every unauthored
 * player produced the same arbitrary pair, dressed up as their strengths
 * (audit Bug NBA-3). The `length === 0` guard meant to catch this could never
 * fire, because slicing a six-key object always yields two entries.
 *
 * So tendencies are resolved in tiers, strongest real signal first, and the
 * tier used is reported back so the UI can be honest about how much it
 * actually knows about a player.
 *
 * Pure and isomorphic - unit-testable without a database.
 */
import type { NbaPlayerSkillRatings, SkillCategory } from "@/types/db";

export type TendencyBasis =
  | "signature_moves"
  | "strengths"
  | "skill_ratings"
  | "position"
  | "none";

export interface PlayerTendencies {
  skills: SkillCategory[];
  basis: TendencyBasis;
}

const MAX_TENDENCY_SKILLS = 3;

/**
 * Ratings this flat carry no information. An unauthored player is all-50
 * (spread 0); anything under this is noise rather than a real profile.
 */
const MIN_MEANINGFUL_RATING_SPREAD = 5;

/** How close to the top rating still counts as one of a player's strengths. */
const RATING_TOP_BAND = 10;

const RATING_TO_SKILL: Record<keyof NbaPlayerSkillRatings, SkillCategory> = {
  shooting: "shooting",
  finishing: "finishing",
  ballHandling: "ball_handling",
  playmaking: "playmaking",
  defense: "defense",
  athleticism: "athletic_development",
};

/**
 * Keyword map over hand-authored editorial prose. Deliberately conservative:
 * a missed keyword falls through to a weaker tier, which is safe, whereas a
 * loose one would invent a tendency the editor never claimed.
 */
const SKILL_KEYWORDS: Record<SkillCategory, string[]> = {
  shooting: [
    "shoot", "shot", "jumper", "pull-up", "three", "3pt", "range", "release",
    "catch-and-shoot", "stroke", "scoring touch",
  ],
  ball_handling: [
    "handle", "dribble", "hesitation", "crossover", "ball security",
    "ball-handling", "shifty", "change of pace",
  ],
  finishing: [
    "finish", "rim", "layup", "contact", "floater", "at the basket", "dunk",
  ],
  defense: [
    "defen", "closeout", "steal", "block", "guard multiple", "rim protection",
    "on-ball", "lockdown",
  ],
  footwork: [
    "footwork", "off-ball", "relocat", "screen", "pivot", "spacing",
    "movement",
  ],
  playmaking: [
    "pass", "playmak", "assist", "kick-out", "read", "vision", "facilitat",
  ],
  athletic_development: [
    "athletic", "explosive", "speed", "vertical", "length", "first step",
    "burst", "motor",
  ],
};

function skillsFromText(lines: string[]): SkillCategory[] {
  const haystack = lines.join(" ").toLowerCase();
  return (Object.keys(SKILL_KEYWORDS) as SkillCategory[]).filter((skill) =>
    SKILL_KEYWORDS[skill].some((keyword) => haystack.includes(keyword)),
  );
}

function skillsFromRatings(ratings: NbaPlayerSkillRatings): SkillCategory[] {
  const entries = Object.entries(ratings) as Array<
    [keyof NbaPlayerSkillRatings, number]
  >;
  const values = entries.map(([, value]) => value);
  const spread = Math.max(...values) - Math.min(...values);

  // The NBA-3 fix: undifferentiated ratings are treated as no signal at all
  // rather than as a ranking.
  if (spread < MIN_MEANINGFUL_RATING_SPREAD) return [];

  const top = Math.max(...values);
  return entries
    .filter(([, value]) => value >= top - RATING_TOP_BAND)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_TENDENCY_SKILLS)
    .map(([key]) => RATING_TO_SKILL[key]);
}

/**
 * Position is real data for a synced player (it comes from the roster feed),
 * so it beats guessing - but it describes a role, not this player's game, and
 * the caller is expected to say so.
 */
const POSITION_SKILLS: Array<[RegExp, SkillCategory[]]> = [
  [/point\s*guard|^pg$/i, ["ball_handling", "playmaking"]],
  [/shooting\s*guard|^sg$/i, ["shooting", "ball_handling"]],
  [/small\s*forward|^sf$/i, ["shooting", "finishing"]],
  [/power\s*forward|^pf$/i, ["finishing", "athletic_development"]],
  [/cent(er|re)|^c$/i, ["finishing", "defense"]],
  [/guard|^g(-f)?$/i, ["ball_handling", "shooting"]],
  [/forward|^f(-c)?$/i, ["finishing", "athletic_development"]],
];

function skillsFromPosition(position: string): SkillCategory[] {
  const match = POSITION_SKILLS.find(([pattern]) => pattern.test(position.trim()));
  return match ? [...match[1]] : [];
}

export interface TendencyInput {
  /** `skillTags` of the drills linked to the player's signature moves. */
  signatureMoveSkillTags: SkillCategory[][];
  strengths: string[];
  skills: NbaPlayerSkillRatings;
  position: string;
}

export function derivePlayerTendencies(input: TendencyInput): PlayerTendencies {
  // Tier 1 + 2 blend: an editor linking a drill to a signature move is the
  // strongest statement of what defines a player's game; their authored
  // strengths prose is the next strongest.
  const fromMoves = [...new Set(input.signatureMoveSkillTags.flat())];
  const fromStrengths = skillsFromText(input.strengths);
  const authored = [
    ...fromMoves,
    ...fromStrengths.filter((skill) => !fromMoves.includes(skill)),
  ].slice(0, MAX_TENDENCY_SKILLS);

  if (authored.length > 0) {
    return {
      skills: authored,
      basis: fromMoves.length > 0 ? "signature_moves" : "strengths",
    };
  }

  const fromRatings = skillsFromRatings(input.skills);
  if (fromRatings.length > 0) {
    return { skills: fromRatings, basis: "skill_ratings" };
  }

  const fromPosition = skillsFromPosition(input.position);
  if (fromPosition.length > 0) {
    return { skills: fromPosition, basis: "position" };
  }

  return { skills: [], basis: "none" };
}

/**
 * Disclosure appended to a modelled workout's label when the basis is weak, so
 * "Modeled after X" never implies analysis that doesn't exist.
 */
export function tendencyBasisNote(basis: TendencyBasis): string | undefined {
  if (basis === "position") {
    return "Based on their listed position - we don't have a skill breakdown for them yet.";
  }
  if (basis === "skill_ratings") {
    return "Based on their skill ratings.";
  }
  return undefined;
}
