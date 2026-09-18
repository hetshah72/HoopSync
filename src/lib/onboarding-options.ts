import {
  COACH_PERSONALITIES,
  EQUIPMENT_OPTIONS,
  SKILL_CATEGORIES,
} from "@/lib/validation/onboarding";

export const SKILL_LABELS: Record<(typeof SKILL_CATEGORIES)[number], string> = {
  shooting: "Shooting",
  ball_handling: "Ball-handling",
  finishing: "Finishing",
  defense: "Defense",
  footwork: "Footwork",
  playmaking: "Playmaking",
  athletic_development: "Athletic development",
};

export const EQUIPMENT_LABELS: Record<(typeof EQUIPMENT_OPTIONS)[number], string> = {
  hoop: "Hoop",
  ball: "Ball",
  cones: "Cones",
  resistance_bands: "Resistance bands",
  agility_ladder: "Agility ladder",
  jump_rope: "Jump rope",
  weighted_vest: "Weighted vest",
};

export const COACH_PERSONALITY_INFO: Record<
  (typeof COACH_PERSONALITIES)[number],
  { label: string; description: string }
> = {
  encouraging: {
    label: "Encouraging",
    description: "Positive, supportive tone - leads with what's going well.",
  },
  balanced: {
    label: "Balanced",
    description: "A mix of encouragement and direct feedback.",
  },
  direct: {
    label: "Direct",
    description: "Straight to the point about what needs work.",
  },
  elite_trainer: {
    label: "Elite Trainer",
    description: "High expectations, demanding tone - like training for the next level.",
  },
};

export const PRIMARY_GOAL_SUGGESTIONS = [
  "Become a better all-around player",
  "Make my school or AAU team",
  "Prepare for tryouts",
  "Train more effectively and consistently",
  "Prepare for the next level (college/pro)",
] as const;

/**
 * Team level and role are stored as free strings (BRD 7.1 gives "e.g.
 * primary option vs. limited role" as examples, not an enum), but they are
 * *offered* as chips: three text inputs in a row was the slowest part of
 * the wizard, and these are now required when the player says they're on a
 * team, so they need to be one tap rather than one paragraph.
 */
export const TEAM_LEVEL_SUGGESTIONS = [
  "Varsity",
  "JV",
  "Freshman",
  "AAU / Club",
  "Middle school",
  "Rec league",
] as const;

export const TEAM_ROLE_SUGGESTIONS = [
  "Primary option",
  "Secondary option",
  "Role player",
  "Limited role",
  "Still earning minutes",
] as const;

export const EDUCATION_LEVEL_LABELS: Record<string, string> = {
  middle_school: "Middle School",
  high_school: "High School",
  college: "College",
};

export const COMPETITIVE_LEVEL_LABELS: Record<string, string> = {
  middle_school: "Middle School",
  high_school: "High School",
  college: "College",
  professional: "Professional",
};
