/**
 * Names a workout after what it actually contains.
 *
 * The label used to be composed from the *request*, before generation ran, and
 * `skillCategory` was set to `targetSkills[0]` regardless of what was selected.
 * A player with no hoop asking for shooting could get two conditioning drills
 * titled "Focused on shooting" (audit: "silently off-topic workout under an
 * on-topic title"). Deriving the label after selection makes that impossible.
 *
 * `skillCategory` matters beyond display: goal auto-tracking counts
 * `workouts.completedForSkill:<skill>` off it, so an honest value here is what
 * keeps Goals honest too.
 */
import { SKILL_LABELS } from "@/lib/onboarding-options";
import type { SkillCategory } from "@/types/db";

function humanize(skills: SkillCategory[]): string {
  const labels = skills.map((skill) => SKILL_LABELS[skill].toLowerCase());
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

export interface WorkoutLabelInput {
  deliveredSkills: SkillCategory[];
  unmetSkills: SkillCategory[];
  drillCount: number;
  /** e.g. a player name, for "Modeled after ..." */
  subject?: string;
}

/** The workout's title. Never names a skill the workout doesn't train. */
export function composeWorkoutLabel(input: WorkoutLabelInput): string {
  const focus = humanize(input.deliveredSkills);

  if (input.subject) {
    return focus
      ? `Modeled after ${input.subject}: ${focus}`
      : `Modeled after ${input.subject}`;
  }
  if (!focus) return "Training session";
  if (input.drillCount === 1) {
    return `${SKILL_LABELS[input.deliveredSkills[0]]} starter - 1 drill`;
  }
  return `Focused on ${focus}`;
}

/**
 * Player-facing disclosure when a workout under-delivers against the request.
 * Surfacing a thin drill library is better than quietly shipping a workout
 * that doesn't do what its title says - and it makes the content gap visible
 * as product copy rather than as a silent quality problem.
 */
export function coverageNoteFor(input: {
  unmetSkills: SkillCategory[];
  deliveredSkills: SkillCategory[];
  stretchCount: number;
}): string | undefined {
  const notes: string[] = [];

  if (input.unmetSkills.length > 0) {
    const missing = humanize(input.unmetSkills);
    notes.push(
      input.deliveredSkills.length > 0
        ? `We don't have ${missing} drills for your equipment and level yet, so this session covers ${humanize(input.deliveredSkills)} only.`
        : `We don't have ${missing} drills for your equipment and level yet.`,
    );
  }

  if (input.stretchCount > 0) {
    notes.push(
      input.stretchCount === 1
        ? "One drill here is a step above your usual level - take it slower."
        : `${input.stretchCount} drills here are a step above your usual level - take them slower.`,
    );
  }

  return notes.length > 0 ? notes.join(" ") : undefined;
}
