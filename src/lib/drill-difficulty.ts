/**
 * Which drills are appropriate for a given player (BRD 7.3 "difficulty" as a
 * real workout parameter, not a cosmetic label).
 *
 * Previously `difficulty` was derived from competitive level, stamped on the
 * workout, and then never consulted during selection - so a middle-schooler
 * could be handed an "advanced" drill inside a workout labelled "beginner"
 * (audit Bug Train-3 / TRN-17).
 *
 * Pure and isomorphic so it is directly unit-testable and usable from scripts.
 */
import type { CompetitiveLevel, DrillDifficulty } from "@/types/db";

export const DIFFICULTY_ORDER: DrillDifficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
];

export function difficultyRank(difficulty: DrillDifficulty): number {
  return DIFFICULTY_ORDER.indexOf(difficulty);
}

function fromCompetitiveLevel(level?: CompetitiveLevel): DrillDifficulty {
  if (level === "college" || level === "professional") return "advanced";
  if (level === "high_school") return "intermediate";
  return "beginner";
}

/**
 * Age caps difficulty independently of competitive level. A 12-year-old on a
 * high-school roster is still 12; loading them with advanced plyometrics
 * because of the team they made is exactly the mistake this guards against.
 */
function fromAge(age?: number): DrillDifficulty {
  if (age === undefined) return "advanced"; // unknown age constrains nothing
  if (age < 13) return "beginner";
  if (age < 16) return "intermediate";
  return "advanced";
}

/** The hardest difficulty this player should be *targeted* at. */
export function targetDifficultyFor(profile: {
  competitiveLevel?: CompetitiveLevel;
  age?: number;
}): DrillDifficulty {
  const byLevel = difficultyRank(fromCompetitiveLevel(profile.competitiveLevel));
  const byAge = difficultyRank(fromAge(profile.age));
  return DIFFICULTY_ORDER[Math.min(byLevel, byAge)];
}

/**
 * Difficulties acceptable for a target, as a one-step ceiling with no floor.
 *
 * Asymmetric on purpose. Handing a player something too *hard* is the unsafe
 * direction and the one the BRD's difficulty parameter exists to prevent;
 * something too easy is merely unchallenging, and excluding easier drills
 * would starve selection in a library this size.
 */
export function allowedDifficulties(
  target: DrillDifficulty,
): DrillDifficulty[] {
  const ceiling = Math.min(
    difficultyRank(target) + 1,
    DIFFICULTY_ORDER.length - 1,
  );
  return DIFFICULTY_ORDER.slice(0, ceiling + 1);
}

/**
 * How well a drill's difficulty fits the target - higher is better. An exact
 * match beats an easier drill, which beats a stretch drill.
 */
export function difficultyFit(
  drill: DrillDifficulty,
  target: DrillDifficulty,
): number {
  const delta = difficultyRank(drill) - difficultyRank(target);
  if (delta === 0) return 2;
  return delta < 0 ? 1 : 0;
}

/** A drill harder than the player's target - shown as a deliberate stretch. */
export function isStretchDrill(
  drill: DrillDifficulty,
  target: DrillDifficulty,
): boolean {
  return difficultyRank(drill) > difficultyRank(target);
}
