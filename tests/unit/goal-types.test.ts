import { describe, expect, it } from "vitest";
import {
  GOAL_METRIC_KEYS,
  GOAL_TEMPLATES,
  GOAL_TYPE_IDS,
  goalCadenceFor,
  goalProgressPercent,
  goalTemplateFor,
  isGoalMet,
} from "@/lib/goal-types";

describe("goal catalog covers the BRD 7.12 goal types", () => {
  it("offers a template for every declared goal type, and nothing else", () => {
    expect(GOAL_TEMPLATES.map((t) => t.type).sort()).toEqual(
      [...GOAL_TYPE_IDS].sort(),
    );
  });

  it("names every example goal type the BRD lists", () => {
    // BRD 7.12: "improve 3PT%, make 500 shots, train 4x/week, improve weak
    // hand, improve finishing, prepare for tryouts".
    for (const type of [
      "three_point_pct",
      "total_makes",
      "training_frequency",
      "weak_hand",
      "finishing",
      "tryout_prep",
    ]) {
      expect(goalTemplateFor(type)).toBeDefined();
    }
  });

  it("points every template at a metric the tracker knows how to resolve", () => {
    for (const template of GOAL_TEMPLATES) {
      expect(GOAL_METRIC_KEYS).toContain(template.metricKey);
    }
  });

  it("gives every template a usable target range and a title that shows it", () => {
    for (const template of GOAL_TEMPLATES) {
      expect(template.minTarget).toBeGreaterThan(0);
      expect(template.maxTarget).toBeGreaterThan(template.minTarget);
      expect(template.defaultTarget).toBeGreaterThanOrEqual(template.minTarget);
      expect(template.defaultTarget).toBeLessThanOrEqual(template.maxTarget);
      expect(template.titleFor(template.defaultTarget)).toContain(
        String(template.defaultTarget),
      );
      expect(template.unit).not.toBe("");
    }
  });

  it("returns undefined for a type that isn't in the catalog", () => {
    expect(goalTemplateFor("not_a_real_goal")).toBeUndefined();
  });
});

describe("goal cadence and baseline semantics", () => {
  it("treats the weekly-frequency goal as the only recurring one", () => {
    const weekly = GOAL_TEMPLATES.filter((t) => t.cadence === "weekly");
    expect(weekly.map((t) => t.type)).toEqual(["training_frequency"]);
  });

  it("never asks a weekly goal for a target date", () => {
    for (const template of GOAL_TEMPLATES) {
      if (template.cadence === "weekly") {
        expect(template.supportsTargetDate).toBe(false);
      }
    }
  });

  it("counts improvement and deadline goals from when they were set", () => {
    // A player with a long history must not open these already finished.
    for (const type of ["weak_hand", "finishing", "tryout_prep", "film_study"]) {
      expect(goalTemplateFor(type)?.countsFrom).toBe("creation");
    }
  });

  it("keeps rate and lifetime-milestone goals on the raw metric", () => {
    // Subtracting a baseline from a percentage is meaningless, and "make 500
    // shots" is genuinely a lifetime total.
    expect(goalTemplateFor("three_point_pct")?.countsFrom).toBe("lifetime");
    expect(goalTemplateFor("total_makes")?.countsFrom).toBe("lifetime");
  });

  it("falls back to cumulative for a type it doesn't recognise", () => {
    expect(goalCadenceFor("something_else")).toBe("cumulative");
    expect(goalCadenceFor("training_frequency")).toBe("weekly");
  });
});

describe("goalProgressPercent", () => {
  it("clamps to 100 so a bar never overflows when a player beats the target", () => {
    expect(goalProgressPercent(12, 10)).toBe(100);
  });

  it("never goes negative", () => {
    expect(goalProgressPercent(-5, 10)).toBe(0);
  });

  it("returns 0 rather than dividing by zero", () => {
    expect(goalProgressPercent(5, 0)).toBe(0);
  });

  it("rounds to a whole percent", () => {
    expect(goalProgressPercent(1, 3)).toBe(33);
  });
});

describe("isGoalMet", () => {
  it("is met at the target and past it, but not below", () => {
    expect(isGoalMet(3, 4)).toBe(false);
    expect(isGoalMet(4, 4)).toBe(true);
    expect(isGoalMet(5, 4)).toBe(true);
  });
});
