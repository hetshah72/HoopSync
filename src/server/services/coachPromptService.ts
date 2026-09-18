import "server-only";
import type {
  ConfidenceFeeling,
  GoalDoc,
  PlayerProfileDoc,
  CoachPersonality,
  UserStatsDoc,
} from "@/types/db";
import { resolveProfileAge } from "@/lib/age";
import { FEELING_LABELS } from "@/lib/confidence-routines";

/**
 * One clearly distinct tone fragment per personality (BRD §7.9: "changing
 * the personality setting must actually change Coach's responses, not just
 * relabel them"). Each is deliberately opinionated about sentence length,
 * praise frequency, and vocabulary register so a side-by-side comparison
 * reads as genuinely different, not a reskinned greeting.
 */
export const PERSONALITY_PROMPTS: Record<CoachPersonality, string> = {
  encouraging:
    "Your tone is warm, positive, and patient. Always find something real to praise before naming a weakness. Frame every correction as an opportunity, never a criticism. Use short, upbeat sentences and the player's effort as a starting point.",
  balanced:
    "Your tone is friendly, professional, and even-handed - like a good high school coach. Mix genuine encouragement with direct, specific feedback in roughly equal measure. Keep sentences clear and moderate in length.",
  direct:
    "Your tone is blunt and efficient. Lead with the problem, not the preamble. Use short, imperative sentences. Skip praise unless it's specifically earned and relevant to the fix. Never pad your answer.",
  elite_trainer:
    "Your tone is that of a demanding, high-performance trainer preparing a player for serious competition. Use precise technical vocabulary (release point, base, separation, reps, margins). Hold the player to a college/pro standard and expect them to want that standard too. Don't coddle, but respect their ambition.",
};

function formatSkill(skill: string): string {
  return skill.replace(/_/g, " ");
}

function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * Everything onboarding asked for, given to Coach.
 *
 * Onboarding captures eighteen fields but only four ever reached this
 * prompt; the other eleven were written once and never read by anything
 * (audit 2.1). That made Coach materially worse at its job - it could not
 * tell a 12-year-old from an 18-year-old, did not know the player was a
 * bench player on a JV team playing three games a week, and would happily
 * prescribe a drill needing a hoop to someone who had said they have none.
 * BRD 7.1's objective is that onboarding data personalizes "every other
 * feature (workouts, feed, Coach)", so it is all here.
 *
 * `age` comes from `resolveAge`, not the denormalized `profile.age`, which
 * is a snapshot from signup day and never recomputed.
 */
function formatProfileContext(profile: PlayerProfileDoc | null): string {
  if (!profile) return "No player profile on file yet.";

  const facts: string[] = [];

  const age = resolveProfileAge(profile);
  if (age !== undefined) facts.push(`is ${age} years old`);
  if (profile.position) facts.push(`plays ${profile.position}`);
  if (profile.competitiveLevel) {
    facts.push(`competes at the ${formatSkill(profile.competitiveLevel)} level`);
  }

  const physical = [
    profile.heightInches ? formatHeight(profile.heightInches) : undefined,
    profile.weightLbs ? `${profile.weightLbs} lbs` : undefined,
  ].filter(Boolean);
  if (physical.length > 0) facts.push(`is ${physical.join(", ")}`);

  if (profile.educationLevel) {
    const school = formatSkill(profile.educationLevel);
    facts.push(
      profile.expectedGraduationYear
        ? `is in ${school} and expects to graduate in ${profile.expectedGraduationYear}`
        : `is in ${school}`,
    );
  }

  if (profile.onTeam) {
    const team = [
      profile.teamName,
      profile.teamLevel ? `(${profile.teamLevel})` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    facts.push(
      profile.roleOnTeam
        ? `plays for ${team || "a team"} as a ${profile.roleOnTeam.toLowerCase()}`
        : `plays for ${team || "a team"}`,
    );
  } else if (profile.onTeam === false) {
    facts.push("is not currently on a team");
  }

  const load = [
    profile.gamesPerWeek !== undefined
      ? `${profile.gamesPerWeek} game(s)`
      : undefined,
    profile.practiceFrequencyPerWeek !== undefined
      ? `${profile.practiceFrequencyPerWeek} practice(s)`
      : undefined,
  ].filter(Boolean);
  if (load.length > 0) facts.push(`has ${load.join(" and ")} in a typical week`);

  if (profile.focusAreas.length > 0) {
    facts.push(`is focused on ${profile.focusAreas.map(formatSkill).join(", ")}`);
  }
  if (profile.primaryGoal) {
    facts.push(`their stated primary goal is "${profile.primaryGoal}"`);
  }

  const lines =
    facts.length > 0
      ? [`Player profile: ${facts.join("; ")}.`]
      : ["Player profile exists but has no notable fields filled in yet."];

  // Stated separately and imperatively - a drill the player physically
  // cannot do is the one recommendation that is always wrong.
  lines.push(
    profile.equipment.length > 0
      ? `Equipment they actually have: ${profile.equipment.map(formatSkill).join(", ")}. Only recommend drills they can do with this.`
      : "They have no training equipment on file. Prefer bodyweight/ball-free drills, and say so when a drill needs equipment.",
  );

  return lines.join("\n");
}

function formatStatsContext(stats: UserStatsDoc | null): string {
  if (!stats || stats.totalWorkoutsCompleted === 0) {
    return "No completed workouts yet.";
  }
  return `Recent activity: ${stats.totalWorkoutsCompleted} workout(s) completed, current streak ${stats.currentStreak} day(s) (longest ${stats.longestStreak}).`;
}

function formatGoalsContext(goals: GoalDoc[]): string {
  if (goals.length === 0) return "No active goals set.";
  const lines = goals.map(
    (g) => `"${g.title}" (${g.currentValue}/${g.targetValue} ${g.unit})`,
  );
  return `Active goals: ${lines.join("; ")}.`;
}

/**
 * How long a pre-game feeling stays relevant.
 *
 * A week-old "Nervous" steering today's question about free-throw form is a
 * bug, not personalization - the same reason the Confidence page only
 * preselects a feeling on the day it was given.
 */
const FEELING_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Today's pre-game check-in, as tone calibration only.
 *
 * BRD 7.9 lists "provide confidence/mental-game support (see 7.10)" as a
 * Coach requirement, and this is the always-on half of that - the explicit
 * hand-off carries the whole check-in, this just stops Coach being the only
 * part of the app that doesn't know the player said they were nervous an
 * hour ago.
 *
 * The instruction matters more than the fact. Without it every reply opens
 * "I see you were feeling nervous...", which is the generic reassurance
 * BRD 7.10 rules out.
 */
function formatMentalStateContext(
  recent: { feeling: ConfidenceFeeling; at: Date } | null | undefined,
  now: Date,
): string | null {
  if (!recent) return null;
  if (now.getTime() - recent.at.getTime() > FEELING_FRESHNESS_MS) return null;

  return `Before their last game the player checked in as "${FEELING_LABELS[recent.feeling]}". Use this only to calibrate your tone and to choose what to suggest. Do not open with it, do not make the reply about it, and do not offer reassurance - they asked you a basketball question.`;
}

export interface CoachPromptInput {
  personality: CoachPersonality;
  profile: PlayerProfileDoc | null;
  stats: UserStatsDoc | null;
  goals: GoalDoc[];
  contextBlocks: string[];
  /** Today's pre-game check-in, if there is one (BRD 7.9 -> 7.10). */
  recentFeeling?: { feeling: ConfidenceFeeling; at: Date } | null;
  /** Injectable so the freshness rule is testable without the clock. */
  now?: Date;
}

export function buildCoachSystemPrompt(input: CoachPromptInput): string {
  const sections = [
    "You are Coach, the AI basketball trainer inside HoopSync, a development app for youth and teen players. Answer basketball questions, discuss and adjust workouts, explain skills, and give confidence/mental-game support. Stay focused on basketball development and this player's real data - never invent stats, sessions, or results that weren't given to you below. Keep replies conversational and no longer than a few short paragraphs.",
    PERSONALITY_PROMPTS[input.personality],
    formatProfileContext(input.profile),
    formatStatsContext(input.stats),
    formatGoalsContext(input.goals),
  ];

  const mentalState = formatMentalStateContext(
    input.recentFeeling,
    input.now ?? new Date(),
  );
  if (mentalState) {
    sections.push(mentalState);
  }

  if (input.contextBlocks.length > 0) {
    sections.push(
      `The player just shared this with you - reference it specifically and concretely in your first reply, not generically:\n${input.contextBlocks.join("\n\n")}`,
    );
  }

  return sections.join("\n\n");
}
