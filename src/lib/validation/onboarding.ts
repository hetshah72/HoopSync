import { z } from "zod";

/**
 * Positions offered in onboarding. Stored as a plain string on
 * PlayerProfileDoc (not a DB-level enum) - constrained here at the
 * validation boundary instead.
 */
export const POSITIONS = [
  "Point Guard",
  "Shooting Guard",
  "Small Forward",
  "Power Forward",
  "Center",
] as const;

export const SKILL_CATEGORIES = [
  "shooting",
  "ball_handling",
  "finishing",
  "defense",
  "footwork",
  "playmaking",
  "athletic_development",
] as const;

export const EQUIPMENT_OPTIONS = [
  "hoop",
  "ball",
  "cones",
  "resistance_bands",
  "agility_ladder",
  "jump_rope",
  "weighted_vest",
] as const;

export const COACH_PERSONALITIES = [
  "encouraging",
  "balanced",
  "direct",
  "elite_trainer",
] as const;

const currentYear = new Date().getFullYear();

/**
 * Graduation year bounds. The lower bound used to be `currentYear`, which
 * rejected any college player who had already graduated (audit ONB-07);
 * it now looks back far enough to cover a recent graduate while still
 * catching a typo'd birth year.
 */
export const GRADUATION_YEAR_MIN = currentYear - 10;
export const GRADUATION_YEAR_MAX = currentYear + 10;

/** The three team fields that become required once `onTeam` is true. */
export const TEAM_FIELDS = ["teamName", "teamLevel", "roleOnTeam"] as const;
export type TeamField = (typeof TEAM_FIELDS)[number];

/**
 * Which team fields are missing for an on-a-team player.
 *
 * Verified against the installed zod (4.5.4): object-level refinements
 * still run when *other* fields in the object are invalid, and
 * `.superRefine()` returns a ZodObject rather than wrapping it. Both
 * matter here - the wizard validates one step at a time via react-hook-form's
 * `trigger()`, which parses the whole schema while every later step's field
 * is still empty, and the profile form `.pick()`s from this same schema.
 */
export function missingTeamFields(input: {
  onTeam?: boolean;
  teamName?: string;
  teamLevel?: string;
  roleOnTeam?: string;
}): TeamField[] {
  if (!input.onTeam) return [];
  return TEAM_FIELDS.filter((field) => !input[field]?.trim());
}

export const TEAM_FIELD_MESSAGES: Record<TeamField, string> = {
  teamName: "Tell us the name of your team.",
  teamLevel: "Pick the level your team plays at.",
  roleOnTeam: "Pick the role you play on your team.",
};

/**
 * Single combined schema for the onboarding submit action. The wizard
 * presents this progressively (one group of questions per step) on the
 * client, but persistence happens once, atomically, on final submit -
 * onboarding is one cohesive profile-creation event, not a series of
 * partial writes.
 *
 * `parentalConsentRequired` is intentionally NOT accepted from the client -
 * it's derived server-side from `dateOfBirth` so it can't be spoofed.
 *
 * Every rule carries a real message. They are rendered per-field by the
 * wizard, which previously showed the same "Please check this field." under
 * every input regardless of what was actually wrong (audit ONB-02/ONB-07).
 */
export const onboardingSchema = z
  .object({
    /**
     * Only asked when the session didn't already supply one - Google gives a
     * profile name and password sign-up asks for it on the form, so this is
     * usually prefilled. BRD 7.1 lists it under "Account", so it's captured
     * either way.
     */
    displayName: z
      .string()
      .trim()
      .min(1, "Tell us what to call you.")
      .max(80, "That name is too long."),
    // Native <input type="date">/type="number"> read via a UTC-safe parse /
    // RHF's valueAsNumber, so form state already holds real Date/number
    // values - no .coerce needed, which keeps the client (RHF) and server
    // (this schema) types identical instead of fighting zod's coerce input
    // typing.
    dateOfBirth: z
      .date({ error: "Enter your date of birth." })
      // `Date.now()` at validation time, not a `new Date()` captured when
      // this module was first imported (which goes stale on a long-running
      // server).
      .refine((d) => d.getTime() <= Date.now(), {
        message: "Date of birth can't be in the future.",
      }),
    heightInches: z
      .number({ error: "Enter your height." })
      .int()
      .min(36, "That height looks too short - check the feet and inches.")
      .max(96, "That height looks too tall - check the feet and inches."),
    weightLbs: z
      .number({ error: "Enter your weight." })
      .int()
      .min(50, "That weight looks too low.")
      .max(400, "That weight looks too high."),
    educationLevel: z.enum(["middle_school", "high_school", "college"], {
      error: "Pick your education level.",
    }),
    expectedGraduationYear: z
      .number({ error: "Enter the year you expect to graduate." })
      .int()
      .min(GRADUATION_YEAR_MIN, `Enter a year from ${GRADUATION_YEAR_MIN} onwards.`)
      .max(GRADUATION_YEAR_MAX, `Enter a year up to ${GRADUATION_YEAR_MAX}.`),
    position: z.enum(POSITIONS, { error: "Pick the position you play." }),
    competitiveLevel: z.enum(
      ["middle_school", "high_school", "college", "professional"],
      { error: "Pick the level you compete at." },
    ),
    onTeam: z.boolean(),
    teamName: z.string().trim().max(120, "That team name is too long.").optional(),
    teamLevel: z.string().trim().max(60, "That team level is too long.").optional(),
    roleOnTeam: z.string().trim().max(60, "That role is too long.").optional(),
    primaryGoal: z
      .string()
      .trim()
      .min(1, "Pick your main goal.")
      .max(200, "Keep your goal under 200 characters."),
    focusAreas: z
      .array(z.enum(SKILL_CATEGORIES))
      .min(1, "Pick at least one skill to work on.")
      .max(SKILL_CATEGORIES.length),
    gamesPerWeek: z
      .number({ error: "Enter how many games you play in a week." })
      .int()
      .min(0, "This can't be negative.")
      .max(14, "That's more than two games a day - check the number."),
    practiceFrequencyPerWeek: z
      .number({ error: "Enter how many times you practice in a week." })
      .int()
      .min(0, "This can't be negative.")
      .max(14, "That's more than two practices a day - check the number."),
    equipment: z.array(z.enum(EQUIPMENT_OPTIONS)).default([]),
    coachPersonality: z.enum(COACH_PERSONALITIES, {
      error: "Pick how you want your Coach to talk to you.",
    }),
    parentalConsentGiven: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    // BRD 7.1 captures "team name and level, role on the team" for a player
    // who is on one. They were all `.optional()` with no conditional rule,
    // so "Yes, I'm on a team" could be submitted with all three blank
    // (audit ONB-03).
    for (const field of missingTeamFields(input)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: TEAM_FIELD_MESSAGES[field],
      });
    }
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;
