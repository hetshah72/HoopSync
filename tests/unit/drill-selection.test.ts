import { describe, expect, it } from "vitest";
import { selectDrills, type SelectableDrill } from "@/lib/drill-selection";
import type { DrillDifficulty, SkillCategory } from "@/types/db";

function drill(
  id: string,
  skillTags: SkillCategory[],
  difficulty: DrillDifficulty = "beginner",
): SelectableDrill {
  return { id, skillTags, difficulty };
}

describe("selectDrills", () => {
  it("never includes a drill that doesn't train a requested skill (Bug Train-1)", () => {
    const result = selectDrills({
      candidates: [
        drill("on-topic", ["playmaking"]),
        drill("off-1", ["shooting"]),
        drill("off-2", ["shooting"]),
        drill("off-3", ["defense"]),
      ],
      targetSkills: ["playmaking"],
      targetDifficulty: "intermediate",
      maxDrills: 4,
    });

    // The old engine took the top 4 by score regardless, padding with these.
    expect(result.chosen.map((d) => d.id)).toEqual(["on-topic"]);
  });

  it("returns fewer drills rather than padding, and reports what it couldn't cover", () => {
    const result = selectDrills({
      candidates: [drill("a", ["shooting"])],
      targetSkills: ["shooting", "defense"],
      targetDifficulty: "intermediate",
      maxDrills: 4,
    });

    expect(result.chosen).toHaveLength(1);
    expect(result.deliveredSkills).toEqual(["shooting"]);
    expect(result.unmetSkills).toEqual(["defense"]);
  });

  it("covers every requested skill before stacking a second drill on one", () => {
    const result = selectDrills({
      candidates: [
        drill("shoot-1", ["shooting"]),
        drill("shoot-2", ["shooting"]),
        drill("shoot-3", ["shooting"]),
        drill("def-1", ["defense"]),
      ],
      targetSkills: ["shooting", "defense"],
      targetDifficulty: "intermediate",
      maxDrills: 2,
    });

    expect(result.chosen.map((d) => d.id).sort()).toEqual(["def-1", "shoot-1"]);
    expect(result.deliveredSkills.sort()).toEqual(["defense", "shooting"]);
  });

  it("prefers an exact difficulty match over an easier one", () => {
    const result = selectDrills({
      candidates: [
        drill("easy", ["shooting"], "beginner"),
        drill("exact", ["shooting"], "intermediate"),
      ],
      targetSkills: ["shooting"],
      targetDifficulty: "intermediate",
      maxDrills: 1,
    });

    expect(result.chosen[0].id).toBe("exact");
  });

  it("flags a chosen drill above the player's level as a stretch", () => {
    const result = selectDrills({
      candidates: [drill("hard", ["shooting"], "advanced")],
      targetSkills: ["shooting"],
      targetDifficulty: "intermediate",
      maxDrills: 4,
    });

    expect(result.stretchDrillIds).toEqual(["hard"]);
  });

  it("pushes recently-trained drills down without excluding them", () => {
    const result = selectDrills({
      candidates: [drill("recent", ["shooting"]), drill("fresh", ["shooting"])],
      targetSkills: ["shooting"],
      targetDifficulty: "beginner",
      maxDrills: 2,
      recentDrillIds: ["recent"],
    });

    expect(result.chosen.map((d) => d.id)).toEqual(["fresh", "recent"]);
  });

  it("is deterministic - the same inputs select the same drills", () => {
    const candidates = [
      drill("a", ["shooting"]),
      drill("b", ["shooting"]),
      drill("c", ["shooting"]),
    ];
    const run = () =>
      selectDrills({
        candidates,
        targetSkills: ["shooting"],
        targetDifficulty: "beginner",
        maxDrills: 2,
      }).chosen.map((d) => d.id);

    expect(run()).toEqual(run());
  });

  it("never selects the same drill twice when it tags two requested skills", () => {
    const result = selectDrills({
      candidates: [drill("both", ["shooting", "footwork"])],
      targetSkills: ["shooting", "footwork"],
      targetDifficulty: "beginner",
      maxDrills: 4,
    });

    expect(result.chosen).toHaveLength(1);
    expect(result.deliveredSkills.sort()).toEqual(["footwork", "shooting"]);
  });
});
