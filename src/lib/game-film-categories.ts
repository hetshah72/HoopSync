/**
 * The nine things a game-film review looks at (BRD 7.7 "Parameters Captured /
 * Displayed"), and how each one maps onto the drill library.
 *
 * That mapping is what makes BRD v1.1 §7's "Game Weakness -> Recommended
 * Workout" a real, traversable relationship rather than a line in a report:
 * every weakness the analysis names resolves to a skill the generator can
 * actually build a workout from.
 *
 * Pure and isomorphic so the same definitions back the UI, the provider, and
 * unit tests without a database.
 */
import type { SkillCategory } from "@/types/db";

export const GAME_ANALYSIS_CATEGORIES = [
  "shot_selection",
  "decision_making",
  "turnovers",
  "defensive_positioning",
  "off_ball_movement",
  "spacing",
  "drives",
  "passing",
  "shot_creation",
] as const;

export type GameAnalysisCategory = (typeof GAME_ANALYSIS_CATEGORIES)[number];

export const GAME_CATEGORY_LABELS: Record<GameAnalysisCategory, string> = {
  shot_selection: "Shot selection",
  decision_making: "Decision-making",
  turnovers: "Turnovers",
  defensive_positioning: "Defensive positioning",
  off_ball_movement: "Off-ball movement",
  spacing: "Spacing",
  drives: "Drives",
  passing: "Passing",
  shot_creation: "Shot creation",
};

/**
 * Which drill skill actually addresses each category. Several categories share
 * a skill - "spacing" and "off-ball movement" are both footwork problems in
 * practice - which is correct rather than lossy: the drill library is
 * organised by how you train something, not by how it shows up in a game.
 */
export const CATEGORY_TO_SKILL: Record<GameAnalysisCategory, SkillCategory> = {
  shot_selection: "shooting",
  decision_making: "playmaking",
  turnovers: "ball_handling",
  defensive_positioning: "defense",
  off_ball_movement: "footwork",
  spacing: "footwork",
  drives: "finishing",
  passing: "playmaking",
  shot_creation: "ball_handling",
};

/** The skills a set of weaknesses should send a player to train. */
export function skillsForCategories(
  categories: GameAnalysisCategory[],
): SkillCategory[] {
  return [...new Set(categories.map((c) => CATEGORY_TO_SKILL[c]))];
}
