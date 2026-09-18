import { describe, expect, it } from "vitest";
import {
  allowedDifficulties,
  isStretchDrill,
  targetDifficultyFor,
} from "@/lib/drill-difficulty";

describe("targetDifficultyFor", () => {
  it("derives a target from competitive level when age is unknown", () => {
    expect(targetDifficultyFor({ competitiveLevel: "middle_school" })).toBe(
      "beginner",
    );
    expect(targetDifficultyFor({ competitiveLevel: "high_school" })).toBe(
      "intermediate",
    );
    expect(targetDifficultyFor({ competitiveLevel: "college" })).toBe("advanced");
    expect(targetDifficultyFor({ competitiveLevel: "professional" })).toBe(
      "advanced",
    );
  });

  it("defaults to beginner when nothing is known", () => {
    expect(targetDifficultyFor({})).toBe("beginner");
  });

  it("lets age cap a level that would otherwise be too demanding", () => {
    // A 12-year-old on a high-school roster is still 12. This is the case that
    // makes age worth consulting at all rather than trusting the team label.
    expect(
      targetDifficultyFor({ competitiveLevel: "high_school", age: 12 }),
    ).toBe("beginner");
    expect(targetDifficultyFor({ competitiveLevel: "college", age: 14 })).toBe(
      "intermediate",
    );
  });

  it("never lets age raise a target above the competitive level", () => {
    expect(targetDifficultyFor({ competitiveLevel: "middle_school", age: 30 })).toBe(
      "beginner",
    );
  });
});

describe("allowedDifficulties", () => {
  it("allows one step up but never excludes anything easier", () => {
    expect(allowedDifficulties("beginner")).toEqual([
      "beginner",
      "intermediate",
    ]);
    expect(allowedDifficulties("intermediate")).toEqual([
      "beginner",
      "intermediate",
      "advanced",
    ]);
  });

  it("does not run off the end of the scale", () => {
    expect(allowedDifficulties("advanced")).toEqual([
      "beginner",
      "intermediate",
      "advanced",
    ]);
  });
});

describe("isStretchDrill", () => {
  it("is true only for a drill harder than the target", () => {
    expect(isStretchDrill("advanced", "intermediate")).toBe(true);
    expect(isStretchDrill("intermediate", "intermediate")).toBe(false);
    expect(isStretchDrill("beginner", "intermediate")).toBe(false);
  });
});
