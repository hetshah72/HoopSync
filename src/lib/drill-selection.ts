/**
 * Deterministic drill selection for generated workouts (BRD 7.3: "generated
 * for them - not copied from a generic library").
 *
 * The previous implementation sorted every equipment-eligible drill by skill
 * overlap and took the top N *regardless of score*, so any drill scoring zero
 * padded the workout once real matches ran out. With a library where no single
 * skill had N drills, that meant every generated workout contained off-topic
 * drills under an on-topic title (audit Bug Train-1).
 *
 * Here a drill is only ever a candidate if it actually tags a requested skill,
 * so padding is structurally impossible rather than merely discouraged.
 * Returning fewer drills than the maximum is an accepted, *disclosed* outcome.
 *
 * Pure and isomorphic - no DB, no server-only imports - so the whole policy is
 * unit-testable without a database.
 */
import { difficultyFit, isStretchDrill } from "@/lib/drill-difficulty";
import type { DrillDifficulty, SkillCategory } from "@/types/db";

export interface SelectableDrill {
  id: string;
  skillTags: SkillCategory[];
  difficulty: DrillDifficulty;
}

export interface SelectionInput<T extends SelectableDrill> {
  candidates: T[];
  /** Requested skills, in priority order - the first is the primary focus. */
  targetSkills: SkillCategory[];
  targetDifficulty: DrillDifficulty;
  maxDrills: number;
  /** Recently-trained drill ids, pushed down but never excluded. */
  recentDrillIds?: string[];
  /** Stable tie-break seed, so repeat generations can rotate without randomness. */
  tieBreak?: (drill: T) => number;
}

export interface SelectionResult<T extends SelectableDrill> {
  chosen: T[];
  /** Requested skills at least one chosen drill actually trains. */
  deliveredSkills: SkillCategory[];
  /** Requested skills nothing could be found for - the honesty signal. */
  unmetSkills: SkillCategory[];
  /** Chosen drill ids harder than the player's target difficulty. */
  stretchDrillIds: string[];
}

const RECENT_DRILL_PENALTY = 1;

function skillOverlap(
  drill: SelectableDrill,
  targetSkills: SkillCategory[],
): number {
  return drill.skillTags.filter((tag) => targetSkills.includes(tag)).length;
}

/**
 * Rank within one skill's group. Lexicographic and fully deterministic:
 * relevance first, then difficulty fit, then recency penalty, then the caller's
 * tie-break. Randomness is deliberately absent so the same inputs reproduce.
 */
function rank<T extends SelectableDrill>(
  drill: T,
  input: SelectionInput<T>,
  recent: Set<string>,
): number[] {
  return [
    -skillOverlap(drill, input.targetSkills),
    -difficultyFit(drill.difficulty, input.targetDifficulty),
    recent.has(drill.id) ? RECENT_DRILL_PENALTY : 0,
    input.tieBreak ? input.tieBreak(drill) : 0,
  ];
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Round-robin across the requested skills so a two-skill request yields work
 * for both before a second drill for either. Coverage before depth: a player
 * who asked for shooting *and* defense should not receive four shooting drills.
 */
export function selectDrills<T extends SelectableDrill>(
  input: SelectionInput<T>,
): SelectionResult<T> {
  const recent = new Set(input.recentDrillIds ?? []);

  // Group by the highest-priority requested skill each drill trains, so a
  // drill tagging two requested skills is counted once, against the first.
  const groups = new Map<SkillCategory, T[]>();
  for (const skill of input.targetSkills) groups.set(skill, []);

  for (const drill of input.candidates) {
    const primary = input.targetSkills.find((skill) =>
      drill.skillTags.includes(skill),
    );
    // No requested skill => not a candidate at all. This single guard is what
    // makes off-topic padding impossible.
    if (!primary) continue;
    groups.get(primary)!.push(drill);
  }

  for (const list of groups.values()) {
    list.sort((a, b) =>
      compareRanks(rank(a, input, recent), rank(b, input, recent)),
    );
  }

  const chosen: T[] = [];
  const taken = new Set<string>();
  let exhausted = false;
  while (chosen.length < input.maxDrills && !exhausted) {
    exhausted = true;
    for (const skill of input.targetSkills) {
      if (chosen.length >= input.maxDrills) break;
      const list = groups.get(skill)!;
      while (list.length > 0) {
        const next = list.shift()!;
        // A drill tagging two requested skills can appear in only one group,
        // but guard anyway so selection can never duplicate a drill.
        if (taken.has(next.id)) continue;
        taken.add(next.id);
        chosen.push(next);
        exhausted = false;
        break;
      }
    }
  }

  const deliveredSkills = input.targetSkills.filter((skill) =>
    chosen.some((drill) => drill.skillTags.includes(skill)),
  );

  return {
    chosen,
    deliveredSkills,
    unmetSkills: input.targetSkills.filter(
      (skill) => !deliveredSkills.includes(skill),
    ),
    stretchDrillIds: chosen
      .filter((drill) => isStretchDrill(drill.difficulty, input.targetDifficulty))
      .map((drill) => drill.id),
  };
}
