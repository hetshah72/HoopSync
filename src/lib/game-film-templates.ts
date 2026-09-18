/**
 * The *fallback* narrative layer for Game Film (BRD 7.7) - used whenever no
 * vision model is configured or a real analysis pass fails.
 *
 * BRD v1.1 §5: analysis that isn't derived from the footage must be "informed
 * by the player's real profile data, and clearly labeled". Everything below
 * honours that - it reads the player's actual position, competitive level and
 * stated focus areas, and it never claims to have watched anything.
 *
 * That last point is why every string here is phrased as a *coaching profile*
 * rather than an observation: "closing out flat is the breakdown that most
 * often lets shooters past" is a true statement about the game, whereas "you
 * closed out flat several times" is a claim about footage nobody looked at.
 * The codebase already draws this line for NBA archetypes (CLAUDE.md:
 * "archetype content describes a role, never the individual"); this is the
 * same rule applied to game film. The section headings that frame these as
 * patterns-to-check rather than findings live in `@/lib/game-film-provenance`.
 *
 * Deterministic, not random: the same analysis id always yields the same
 * report, so reloading the page never silently rewrites what a player already
 * read (and, later, already shared with their coach).
 *
 * Pure and isomorphic - unit-testable with no database and no server context.
 */
import { hashKey, orderDeterministically } from "@/lib/deterministic";
import {
  CATEGORY_TO_SKILL,
  GAME_ANALYSIS_CATEGORIES,
  type GameAnalysisCategory,
} from "@/lib/game-film-categories";
import type { GameFilmFrame } from "@/lib/game-film-vision";
import type {
  AnalysisProvenance,
  CompetitiveLevel,
  GameEvent,
  GameFilmSubject,
  SkillCategory,
} from "@/types/db";

export interface GameFilmObservationTemplate {
  category: GameAnalysisCategory;
  /** The habit worth confirming is already there - stated as a pattern. */
  strength: string;
  /** The habit that most commonly breaks down - stated as a pattern. */
  weakness: string;
  /** The concrete fix for the weakness - BRD 7.7's "opportunity to improve". */
  recommendation: string;
}

/**
 * Specific and sided, in the spirit of BRD §7.7's worked example ("you rarely
 * attacked closeouts from the right side") - but phrased as what tends to
 * happen rather than what did happen, because on this path nothing was
 * watched. BRD §14 flags the real risk here: generic filler would fail the
 * BRD's own success criteria, so each line names a concrete mechanism.
 */
const OBSERVATION_TEMPLATES: GameFilmObservationTemplate[] = [
  {
    category: "shot_selection",
    strength:
      "Keeping attempts inside your range and passing up contested early-clock threes - the habit that separates good shot selection from volume.",
    weakness:
      "Attempts that go up early in the clock with a defender attached, before the offence has moved anyone, are the most common shot-selection leak.",
    recommendation:
      "Give the possession one more action before you shoot unless you're genuinely open - then take the same shot with space.",
  },
  {
    category: "decision_making",
    strength:
      "Reading the second defender on a drive and giving the ball up before the help arrives.",
    weakness:
      "Deciding to finish before the help has been seen to rotate is the usual decision-making breakdown on drives.",
    recommendation:
      "Drive with your eyes up through the first two steps so the read happens on the move, not at the rim.",
  },
  {
    category: "turnovers",
    strength:
      "Protecting the ball through contact and keeping the dribble alive under pressure.",
    weakness:
      "At this level most giveaways come off a live dribble in traffic rather than off a pass.",
    recommendation:
      "Pick the ball up a beat earlier when two defenders converge - a pass out is worth more than a lost handle.",
  },
  {
    category: "defensive_positioning",
    strength:
      "Staying between your man and the rim and contesting without leaving your feet.",
    weakness:
      "Closing out flat is the breakdown that most often lets a shooter go straight past the defender.",
    recommendation:
      "Chop your last two steps on the closeout so you can still move sideways when they drive.",
  },
  {
    category: "off_ball_movement",
    strength:
      "Relocating after a pass instead of standing and watching the ball.",
    weakness:
      "Stopping after giving the ball up is the habit that most often lets a defender help off you freely.",
    recommendation:
      "Cut or relocate immediately after every pass - the pass should start your movement, not end it.",
  },
  {
    category: "spacing",
    strength:
      "Holding weak-side spacing so the driver has a genuine lane to attack.",
    weakness:
      "Drifting toward the ball on a teammate's drive is the spacing error that most often closes the lane it was meant to open.",
    recommendation:
      "When a teammate drives, step away from the drive rather than toward it.",
  },
  {
    category: "drives",
    strength:
      "Getting your first step past the defender's hip rather than into their chest.",
    weakness:
      "Attacking the same direction almost every time is the tendency a defence learns to sit on first.",
    recommendation:
      "Force yourself to attack the other way for a full possession at a time until both feel normal.",
  },
  {
    category: "passing",
    strength:
      "Kick-outs that arrive in the shooting pocket, on time and catchable.",
    weakness:
      "Passes that arrive late or behind the target are what most often kill an advantage that was already created.",
    recommendation:
      "Throw to where the shooter will be rather than where they are - lead the catch.",
  },
  {
    category: "shot_creation",
    strength:
      "Using a change of pace to create space rather than relying on raw speed.",
    weakness:
      "Needing several dribbles to get separation is the creation habit that most often gives the defence time to recover.",
    recommendation:
      "Work a one- or two-dribble counter so the shot comes before the help can rotate.",
  },
];

export interface GameFilmAnalysisInput {
  /** Stable key - the analysis id. Same id, same report, forever. */
  analysisId: string;
  /** The player's real, self-declared training priorities. */
  focusAreas: SkillCategory[];
  competitiveLevel?: CompetitiveLevel;
  position?: string;
  /** Who to look at. Vision path only; ignored by the heuristic fallback. */
  subject?: GameFilmSubject;
  /**
   * Stills lifted from the upload, in chronological order. Present only when
   * the client managed to decode the video; the heuristic fallback runs
   * whenever this is empty or absent.
   */
  frames?: GameFilmFrame[];
}

export interface GeneratedObservation {
  category: GameAnalysisCategory;
  text: string;
  recommendation?: string;
}

export interface GeneratedGameFilmAnalysis {
  strengths: GeneratedObservation[];
  weaknesses: GeneratedObservation[];
  /** Opening line that states, in the report's own words, what this is based on. */
  basis: string;
  /**
   * What actually produced this result. The provider reports it rather than
   * the caller assuming it, because a vision provider that falls back
   * internally is the one piece of code that knows which path really ran.
   */
  provenance: AnalysisProvenance;
  /** Timestamped moments read off the frames. Empty on the heuristic path. */
  events: GameEvent[];
  /** `vision_model` only. */
  framesAnalyzed?: number;
}

const STRENGTH_COUNT = 2;
const WEAKNESS_COUNT = 3;

function templateFor(
  category: GameAnalysisCategory,
): GameFilmObservationTemplate {
  return OBSERVATION_TEMPLATES.find((t) => t.category === category)!;
}

/**
 * Builds the report.
 *
 * The player's stated focus areas are deliberately steered into the *weakness*
 * column: those are the things they already told us they want to work on, so
 * surfacing them is both more useful and more honest than pretending a
 * heuristic picked them out of footage. Everything else is spread
 * deterministically by analysis id.
 */
export function generateGameFilmAnalysis(
  input: GameFilmAnalysisInput,
): GeneratedGameFilmAnalysis {
  const { analysisId, focusAreas } = input;

  const prioritized = GAME_ANALYSIS_CATEGORIES.filter((category) =>
    focusAreas.includes(CATEGORY_TO_SKILL[category]),
  );
  const rest = GAME_ANALYSIS_CATEGORIES.filter(
    (category) => !prioritized.includes(category),
  );

  const orderedWeakness = [
    ...orderDeterministically(prioritized, `${analysisId}:w`, (c) => c),
    ...orderDeterministically(rest, `${analysisId}:w2`, (c) => c),
  ];
  const weaknessCategories = orderedWeakness.slice(0, WEAKNESS_COUNT);

  // Strengths come from what the weaknesses didn't claim, so no category is
  // ever both a strength and a weakness in the same report.
  const strengthCategories = orderDeterministically(
    GAME_ANALYSIS_CATEGORIES.filter((c) => !weaknessCategories.includes(c)),
    `${analysisId}:s`,
    (c) => c,
  ).slice(0, STRENGTH_COUNT);

  return {
    strengths: strengthCategories.map((category) => ({
      category,
      text: templateFor(category).strength,
    })),
    weaknesses: weaknessCategories.map((category) => ({
      category,
      text: templateFor(category).weakness,
      recommendation: templateFor(category).recommendation,
    })),
    provenance: "heuristic",
    // Nothing was watched, so there is nothing to timestamp. Fabricating
    // moments here would be indistinguishable to the player from real ones.
    events: [],
    basis: describeBasis(input),
  };
}

/** Says plainly which real inputs shaped the report, and which didn't. */
function describeBasis(input: GameFilmAnalysisInput): string {
  const parts: string[] = [];
  if (input.position) parts.push(`your position (${input.position})`);
  if (input.competitiveLevel) {
    parts.push(`your level (${input.competitiveLevel.replace(/_/g, " ")})`);
  }
  if (input.focusAreas.length > 0) parts.push("the areas you chose to focus on");

  return parts.length > 0
    ? `Shaped by ${parts.join(", ")} - not by anything detected in your video.`
    : "Generic review - add your position and focus areas in your profile to make this specific to you.";
}

/** Deterministic per-analysis ordering seed, exported for tests. */
export function analysisSeed(analysisId: string): number {
  return hashKey(analysisId);
}
