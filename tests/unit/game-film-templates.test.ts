import { describe, expect, it } from "vitest";
import { generateGameFilmAnalysis } from "@/lib/game-film-templates";
import {
  CATEGORY_TO_SKILL,
  GAME_ANALYSIS_CATEGORIES,
  GAME_CATEGORY_LABELS,
  skillsForCategories,
} from "@/lib/game-film-categories";
import type { GameAnalysisCategory } from "@/lib/game-film-categories";

const ANALYSIS_ID = "6520f1f77bcf86cd79943901";

describe("game film categories", () => {
  it("covers every BRD 7.7 parameter", () => {
    // BRD 7.7 lists exactly these nine.
    expect([...GAME_ANALYSIS_CATEGORIES].sort()).toEqual(
      [
        "decision_making",
        "defensive_positioning",
        "drives",
        "off_ball_movement",
        "passing",
        "shot_creation",
        "shot_selection",
        "spacing",
        "turnovers",
      ].sort(),
    );
  });

  it("maps every category to a trainable skill and a label", () => {
    // Without this, a weakness could be reported that no workout can address -
    // which would break the "Game Weakness -> Recommended Workout" edge.
    for (const category of GAME_ANALYSIS_CATEGORIES) {
      expect(CATEGORY_TO_SKILL[category]).toBeDefined();
      expect(GAME_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it("de-duplicates skills shared by several categories", () => {
    // Spacing and off-ball movement are both footwork.
    expect(skillsForCategories(["spacing", "off_ball_movement"])).toEqual([
      "footwork",
    ]);
  });
});

describe("generateGameFilmAnalysis", () => {
  it("returns strengths, weaknesses and a fix for each weakness", () => {
    const result = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: [],
    });

    // BRD 7.7 success criterion: a clip returns strengths, weaknesses and
    // recommendations - not just a processing confirmation.
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.weaknesses.every((w) => w.recommendation)).toBe(true);
  });

  it("never reports the same category as both a strength and a weakness", () => {
    const result = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: ["shooting", "defense"],
    });

    const strengths = result.strengths.map((s) => s.category);
    const weaknesses = result.weaknesses.map((w) => w.category);
    expect(strengths.some((c) => weaknesses.includes(c))).toBe(false);
  });

  it("steers the player's own focus areas into the weakness column", () => {
    // These are the things they already said they want to work on, so
    // surfacing them is more useful - and more honest - than pretending a
    // heuristic spotted them in the footage.
    const result = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: ["defense"],
    });

    const weaknessSkills = result.weaknesses.map(
      (w) => CATEGORY_TO_SKILL[w.category as GameAnalysisCategory],
    );
    expect(weaknessSkills).toContain("defense");
  });

  it("is deterministic - the same analysis always reads the same", () => {
    const a = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: ["shooting"],
    });
    const b = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: ["shooting"],
    });

    expect(a).toEqual(b);
  });

  it("produces a different report for a different upload", () => {
    const a = generateGameFilmAnalysis({ analysisId: "a".repeat(24), focusAreas: [] });
    const b = generateGameFilmAnalysis({ analysisId: "b".repeat(24), focusAreas: [] });

    expect(a.weaknesses.map((w) => w.category)).not.toEqual(
      b.weaknesses.map((w) => w.category),
    );
  });

  it("states which real profile fields shaped the report", () => {
    const result = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: ["shooting"],
      competitiveLevel: "high_school",
      position: "Point Guard",
    });

    expect(result.basis).toContain("Point Guard");
    expect(result.basis).toContain("high school");
    // The disclaimer is the point: it must never imply the video was read.
    expect(result.basis).toMatch(/not by anything detected in your video/i);
  });

  it("admits when it has nothing personal to go on", () => {
    const result = generateGameFilmAnalysis({
      analysisId: ANALYSIS_ID,
      focusAreas: [],
    });
    expect(result.basis).toMatch(/generic/i);
  });
});
