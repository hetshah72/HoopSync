import "server-only";
import type { ObjectId } from "mongodb";
import { findDrillsForGeneration } from "@/server/repositories/drillRepository";
import {
  createWorkout,
  findOnboardingWorkoutForUser,
} from "@/server/repositories/workoutRepository";
import { drillToSnapshot, type WorkoutSource } from "@/server/services/workoutService";
import { getProfileByUserId, resolveAge } from "@/server/services/profileService";
import { hashKey } from "@/lib/deterministic";
import { estimateWorkoutMinutes } from "@/lib/workout-duration";
import {
  allowedDifficulties,
  difficultyRank,
  targetDifficultyFor,
} from "@/lib/drill-difficulty";
import { selectDrills } from "@/lib/drill-selection";
import { composeWorkoutLabel, coverageNoteFor } from "@/lib/workout-labeling";
import { EQUIPMENT_OPTIONS } from "@/lib/validation/onboarding";
import { ValidationError, NotFoundError } from "@/server/errors";
import type { DrillDifficulty, SkillCategory, WorkoutDoc } from "@/types/db";

const MAX_DRILLS_PER_WORKOUT = 4;

const EVERY_EQUIPMENT_OPTION: string[] = [...EQUIPMENT_OPTIONS];

/**
 * Deterministic, rule-based drill selection - no LLM/ML, per BRD v1.1's
 * "avoid unnecessary AI complexity" guidance. Three real signals decide the
 * workout: what to target (targetSkills), what the player can actually do
 * (their equipment), and what is appropriate for them (age + competitive
 * level).
 *
 * The selection *policy* lives in `@/lib/drill-selection` and the difficulty
 * policy in `@/lib/drill-difficulty`, so both are unit-testable without a
 * database; this service only fetches, delegates, and persists.
 */
export interface GenerateWorkoutInput {
  targetSkills: SkillCategory[];
  /**
   * Optional provenance. Callers with genuinely specific context (a shooting
   * session's weak zone, a signature move) pass their own label; the plain
   * skill path omits it so the label is composed from what was actually
   * selected - a workout can then never claim a focus it doesn't deliver.
   */
  source?: Omit<WorkoutSource, "label"> & { label?: string };
  /** Names the thing being modelled (e.g. a player) for label composition. */
  subject?: string;
  /**
   * Drills the player has done very recently, pushed down the ranking.
   *
   * Deliberately a penalty rather than an exclusion: the MVP drill library is
   * small enough that excluding recent work outright could empty the pool
   * and turn a fresh-variety feature into a failed generation.
   */
  deprioritizeDrillIds?: ObjectId[];
  /**
   * Stable tie-break seed. Skill overlap is a small integer, so most drills
   * tie and a plain sort resolves them in Mongo's natural order - meaning
   * identical `targetSkills` produced an identical workout forever. Passing
   * `userId:dayStamp` makes the tie-break rotate daily while staying
   * repeatable within the day (BRD 7.2: content must change daily).
   */
  varietyKey?: string;
  /** Marks this as the day's recommended workout - see `WorkoutDoc.dayStamp`. */
  dayStamp?: string;
}

export async function generateWorkout(
  userId: ObjectId,
  input: GenerateWorkoutInput,
): Promise<WorkoutDoc> {
  if (input.targetSkills.length === 0) {
    throw new ValidationError("Select at least one skill to focus on.");
  }

  const profile = await getProfileByUserId(userId);
  const equipment = profile?.equipment ?? [];
  const targetDifficulty = targetDifficultyFor({
    competitiveLevel: profile?.competitiveLevel,
    // `resolveAge`, not `profile.age`: the stored age is a snapshot taken
    // when onboarding was submitted and is never recomputed, so a player who
    // signed up at 12 would be banded as 12 years later. This derives it from
    // the stored date of birth.
    age: resolveAge(profile),
  });

  // Only drills that train a requested skill AND are doable with the player's
  // real equipment are ever candidates. Equipment stays a hard filter -
  // prescribing a drill they physically can't do is worse than a shorter
  // workout - and skill is now a hard filter too, which is what makes
  // off-topic padding impossible rather than merely unlikely (Bug Train-1).
  const candidates = await findDrillsForGeneration({
    skillTags: input.targetSkills,
    availableEquipment: equipment,
    difficulties: allowedDifficulties(targetDifficulty),
  });

  // Deliberately no widening step here. The band already has no floor - every
  // easier drill is a candidate - so the only thing relaxing it could add is a
  // *harder* drill, which is precisely what the ceiling exists to prevent. A
  // shorter, honestly-labelled workout beats handing a 12-year-old an advanced
  // drill to pad it out.
  if (candidates.length === 0) {
    throw new NotFoundError(await noCandidatesMessage(input.targetSkills, equipment));
  }

  const varietyKey = input.varietyKey ?? "";
  const recentIds = (input.deprioritizeDrillIds ?? []).map((id) => id.toString());

  const selection = selectDrills({
    candidates: candidates.map((drill) => ({
      id: drill._id.toString(),
      skillTags: drill.skillTags,
      difficulty: drill.difficulty,
      drill,
    })),
    targetSkills: input.targetSkills,
    targetDifficulty,
    maxDrills: MAX_DRILLS_PER_WORKOUT,
    recentDrillIds: recentIds,
    // Only consulted when everything above ties, so targeting always outranks
    // variety.
    tieBreak: (candidate) => hashKey(`${varietyKey}:${candidate.id}`),
  });

  const drills = selection.chosen.map((candidate, index) =>
    drillToSnapshot(candidate.drill, index + 1),
  );

  const label =
    input.source?.label ??
    composeWorkoutLabel({
      deliveredSkills: selection.deliveredSkills,
      unmetSkills: selection.unmetSkills,
      drillCount: drills.length,
      subject: input.subject,
    });

  const coverageNote = coverageNoteFor({
    unmetSkills: selection.unmetSkills,
    deliveredSkills: selection.deliveredSkills,
    stretchCount: selection.stretchDrillIds.length,
  });

  return createWorkout({
    userId,
    source: {
      type: input.source?.type ?? "skill",
      ...(input.source?.refId ? { refId: input.source.refId } : {}),
      label,
    },
    // Both derived from what was actually selected, never from the request.
    // `skillCategory` also drives goal auto-tracking, so an honest value here
    // is what keeps `workouts.completedForSkill:*` honest.
    skillCategory: selection.deliveredSkills[0] ?? input.targetSkills[0],
    difficulty: hardestDifficulty(drills),
    estimatedDurationMinutes: estimateWorkoutMinutes(drills),
    ...(coverageNote ? { coverageNote } : {}),
    drills,
    status: "pending",
    ...(input.dayStamp ? { dayStamp: input.dayStamp } : {}),
    createdAt: new Date(),
  });
}

/**
 * The starting plan built from onboarding answers (BRD 7.1: "use the
 * responses to generate an initial personalized recommendation / starting
 * plan"; BRD 7.1 success criterion: "onboarding data visibly drives at
 * least one Home-screen recommendation immediately afterward").
 *
 * Targets exactly what the player said they wanted to work on, filtered by
 * the equipment they said they have - so it is a real, startable workout
 * traceable to their own answers, not a welcome message.
 *
 * Idempotent: a player has one starting plan for the life of the account,
 * so a double-tapped Finish or a re-submitted onboarding returns the
 * existing one rather than stacking up duplicates.
 */
export async function getStartingPlan(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  return findOnboardingWorkoutForUser(userId);
}

export async function generateStartingPlan(
  userId: ObjectId,
): Promise<WorkoutDoc | null> {
  const existing = await getStartingPlan(userId);
  if (existing) return existing;

  const profile = await getProfileByUserId(userId);
  const targetSkills = profile?.focusAreas ?? [];
  if (targetSkills.length === 0) return null;

  return generateWorkout(userId, {
    targetSkills,
    source: { type: "onboarding", label: "Your starting plan" },
  });
}

/** A workout is only as easy as its hardest drill - the stamp describes contents. */
function hardestDifficulty(drills: { difficulty?: DrillDifficulty }[]): DrillDifficulty {
  return drills.reduce<DrillDifficulty>((hardest, drill) => {
    const next = drill.difficulty ?? "beginner";
    return difficultyRank(next) > difficultyRank(hardest) ? next : hardest;
  }, "beginner");
}

/**
 * Distinguishes "you lack the gear" from "we lack the content" so the player
 * gets an action they can actually take rather than a generic dead end.
 */
async function noCandidatesMessage(
  targetSkills: SkillCategory[],
  equipment: string[],
): Promise<string> {
  const withoutEquipmentFilter = await findDrillsForGeneration({
    skillTags: targetSkills,
    availableEquipment: EVERY_EQUIPMENT_OPTION,
  });

  if (withoutEquipmentFilter.length > 0) {
    const needed = [
      ...new Set(
        withoutEquipmentFilter.flatMap((drill) =>
          drill.equipmentNeeded.filter((item) => !equipment.includes(item)),
        ),
      ),
    ];
    return `Every drill we have for that needs equipment you haven't listed (${needed.join(", ")}). Add it in your profile, or pick another skill.`;
  }
  return "We don't have drills for that skill yet - it's ongoing content work. Pick another skill for now.";
}
