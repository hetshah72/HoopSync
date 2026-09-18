import { describe, expect, it } from "vitest";
import { derivePlayerTendencies } from "@/lib/player-tendencies";
import type { NbaPlayerSkillRatings } from "@/types/db";

/** What `emptySkillRatings()` writes for every roster-synced player. */
const FLAT_RATINGS: NbaPlayerSkillRatings = {
  shooting: 50,
  finishing: 50,
  ballHandling: 50,
  playmaking: 50,
  defense: 50,
  athleticism: 50,
};

const CURRY_RATINGS: NbaPlayerSkillRatings = {
  shooting: 99,
  finishing: 65,
  ballHandling: 92,
  playmaking: 85,
  defense: 55,
  athleticism: 72,
};

describe("derivePlayerTendencies", () => {
  it("treats flat placeholder ratings as no signal at all (Bug NBA-3)", () => {
    // The old code sorted these and returned the first two, so every
    // unauthored player modelled as the same arbitrary pair.
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [],
      strengths: [],
      skills: FLAT_RATINGS,
      position: "Unknown",
    });

    expect(result.basis).toBe("none");
    expect(result.skills).toEqual([]);
  });

  it("leads with the skills behind a player's signature moves", () => {
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [["shooting", "ball_handling"]],
      strengths: [],
      skills: FLAT_RATINGS,
      position: "Small Forward",
    });

    expect(result.basis).toBe("signature_moves");
    expect(result.skills).toEqual(["shooting", "ball_handling"]);
  });

  it("reads authored strengths prose when there are no signature moves", () => {
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [],
      strengths: [
        "Length and instincts that translate into multi-position defense",
        "Hesitation-into-pull-up shot creation off one or two dribbles",
      ],
      skills: FLAT_RATINGS,
      position: "Small Forward",
    });

    expect(result.basis).toBe("strengths");
    expect(result.skills).toContain("defense");
    expect(result.skills).toContain("shooting");
  });

  it("uses differentiated ratings when there is no authored content", () => {
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [],
      strengths: [],
      skills: CURRY_RATINGS,
      position: "Point Guard",
    });

    expect(result.basis).toBe("skill_ratings");
    expect(result.skills[0]).toBe("shooting");
    expect(result.skills).toContain("ball_handling");
  });

  it("falls back to position, which is real data for a synced player", () => {
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [],
      strengths: [],
      skills: FLAT_RATINGS,
      position: "Point Guard",
    });

    expect(result.basis).toBe("position");
    expect(result.skills).toEqual(["ball_handling", "playmaking"]);
  });

  it("understands the abbreviations the roster feed actually returns", () => {
    for (const position of ["G", "F", "C", "G-F", "F-C"]) {
      const result = derivePlayerTendencies({
        signatureMoveSkillTags: [],
        strengths: [],
        skills: FLAT_RATINGS,
        position,
      });
      expect(result.skills.length).toBeGreaterThan(0);
    }
  });

  it("never returns more than three target skills", () => {
    const result = derivePlayerTendencies({
      signatureMoveSkillTags: [
        ["shooting", "ball_handling", "footwork", "finishing", "defense"],
      ],
      strengths: [],
      skills: FLAT_RATINGS,
      position: "Point Guard",
    });

    expect(result.skills.length).toBeLessThanOrEqual(3);
  });
});
