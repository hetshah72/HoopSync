import { describe, expect, it } from "vitest";
import { missingTeamFields, onboardingSchema } from "@/lib/validation/onboarding";

const validInput = {
  displayName: "Jordan",
  dateOfBirth: new Date(Date.UTC(2010, 5, 15)),
  heightInches: 70,
  weightLbs: 150,
  educationLevel: "high_school" as const,
  expectedGraduationYear: new Date().getFullYear() + 2,
  position: "Shooting Guard" as const,
  competitiveLevel: "high_school" as const,
  onTeam: true,
  teamName: "Lincoln High Varsity",
  teamLevel: "Varsity",
  roleOnTeam: "Rotation player",
  primaryGoal: "Become a better all-around player",
  focusAreas: ["shooting", "ball_handling"] as const,
  gamesPerWeek: 2,
  practiceFrequencyPerWeek: 4,
  equipment: ["hoop", "ball"] as const,
  coachPersonality: "balanced" as const,
  parentalConsentGiven: false,
};

describe("onboardingSchema", () => {
  it("accepts a complete, valid submission", () => {
    const result = onboardingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects a future date of birth", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      dateOfBirth: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty focusAreas array", () => {
    const result = onboardingSchema.safeParse({ ...validInput, focusAreas: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown position", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      position: "Point God",
    });
    expect(result.success).toBe(false);
  });

  it("defaults equipment to an empty array when omitted", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { equipment, ...rest } = validInput;
    const result = onboardingSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equipment).toEqual([]);
    }
  });

  it("requires a display name", () => {
    const result = onboardingSchema.safeParse({ ...validInput, displayName: "  " });
    expect(result.success).toBe(false);
  });

  /**
   * BRD 7.1 captures "team name and level, role on the team" for a player who
   * is on one; all three used to stay optional, so "Yes, I'm on a team" could
   * be submitted blank (audit ONB-03).
   */
  it("requires every team field once the player says they're on a team", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      onTeam: true,
      teamName: "",
      teamLevel: "",
      roleOnTeam: "",
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["teamName", "teamLevel", "roleOnTeam"]),
    );
  });

  it("leaves team fields optional when the player isn't on a team", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      onTeam: false,
      teamName: "",
      teamLevel: "",
      roleOnTeam: "",
    });
    expect(result.success).toBe(true);
  });

  /**
   * Pins the semantics the wizard has to work around.
   *
   * The team rule is an object-level refinement, and zod skips those when a
   * required key is *missing* entirely - which is exactly the state the
   * wizard is in on the "background" step, with every later step's field
   * still unfilled. So a per-step `trigger(["teamName", ...])` would report
   * nothing and "Continue" would wave the player through.
   *
   * That's why `missingTeamFields` is exported and the wizard checks it
   * directly; the refinement is the server-side backstop, where the whole
   * object is always present.
   */
  it("skips the team refinement while a later step's field is still missing", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      onTeam: true,
      teamName: "",
      teamLevel: "",
      roleOnTeam: "",
      coachPersonality: undefined,
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(["coachPersonality"]);
  });

  it("missingTeamFields names exactly the blank team fields", () => {
    expect(
      missingTeamFields({ onTeam: true, teamName: "Lincoln", teamLevel: "  " }),
    ).toEqual(["teamLevel", "roleOnTeam"]);
    expect(missingTeamFields({ onTeam: false })).toEqual([]);
  });

  it("accepts a graduation year in the past for someone who already graduated", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      educationLevel: "college",
      expectedGraduationYear: new Date().getFullYear() - 2,
    });
    expect(result.success).toBe(true);
  });

  it("carries a real, field-specific message rather than one generic string", () => {
    const result = onboardingSchema.safeParse({ ...validInput, focusAreas: [] });
    expect(result.success).toBe(false);
    const message = result.error?.issues.find(
      (i) => i.path.join(".") === "focusAreas",
    )?.message;
    expect(message).toBe("Pick at least one skill to work on.");
  });
});
