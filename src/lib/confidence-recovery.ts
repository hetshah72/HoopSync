/**
 * The post-poor-game recovery plan (BRD 7.10).
 *
 * The success criterion is specific: "A post-poor-game flow references real
 * data from that game or session." So everything here is *derived* from the
 * player's stored numbers - session FG%, zone splits, streak, completed
 * workouts - and nothing is generated prose about how they must be feeling.
 * If there's no data to cite, this says so rather than inventing encouragement.
 *
 * Composed in code rather than by the LLM for the same reason the Coach
 * openers are: it is factual, instant, and works with no API key.
 *
 * Pure and isomorphic - unit-testable without a database.
 */
import { ZONE_LABELS, fgPercent } from "@/lib/shot-zones";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import type { ShotZone, SkillCategory } from "@/types/db";

export interface RecoveryInputSession {
  id: string;
  recordedAt: Date;
  totalAttempts: number;
  totalMakes: number;
  fgPercent: number;
  bestZone?: ShotZone;
  weakestZone?: ShotZone;
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>;
  /** The workout this session already generated, if it produced one. The plan
   * only tells the player to run a workout when one actually exists to run. */
  recommendedWorkoutId?: string;
}

export interface RecoveryInput {
  /** Most recent completed shooting session, if any. */
  session?: RecoveryInputSession;
  /** Completed workouts in the last 7 days. */
  workoutsThisWeek: number;
  currentStreak: number;
  /** Skills the player has actually put drills into, busiest first. */
  topSkills: Array<{ skill: SkillCategory; drillsCompleted: number }>;
}

export interface RecoveryPlan {
  positives: string[];
  areasToImprove: string[];
  /** Ordered next actions, unnumbered - the UI renders them as a real list,
   * the way the pre-game routine's steps already are. */
  planSteps: string[];
  /** True when the plan could cite real numbers rather than general advice. */
  isDataBacked: boolean;
}

/**
 * A zone needs a real sample before it's worth drawing a conclusion from -
 * one miss from the corner is not a corner problem.
 */
const MIN_ZONE_ATTEMPTS = 3;

export function buildRecoveryPlan(input: RecoveryInput): RecoveryPlan {
  const positives: string[] = [];
  const areasToImprove: string[] = [];
  const { session } = input;

  // --- Positives, from real activity only -----------------------------------
  if (input.currentStreak > 1) {
    positives.push(
      `You've trained ${input.currentStreak} days in a row. One bad game doesn't touch that.`,
    );
  }
  if (input.workoutsThisWeek > 0) {
    positives.push(
      `${input.workoutsThisWeek} workout${input.workoutsThisWeek === 1 ? "" : "s"} completed in the last 7 days.`,
    );
  }
  if (session?.bestZone) {
    const stats = session.zoneBreakdown[session.bestZone];
    positives.push(
      stats && stats.attempts >= MIN_ZONE_ATTEMPTS
        ? `Your ${ZONE_LABELS[session.bestZone]} was your strongest spot at ${fgPercent(stats.makes, stats.attempts)}% (${stats.makes}/${stats.attempts}).`
        : `Your best looks came from ${ZONE_LABELS[session.bestZone]}.`,
    );
  }
  if (session && session.totalMakes > 0) {
    positives.push(
      `You still made ${session.totalMakes} of ${session.totalAttempts} in your last logged session.`,
    );
  }
  const busiest = input.topSkills[0];
  if (busiest) {
    positives.push(
      `You've put the most work into ${SKILL_LABELS[busiest.skill].toLowerCase()} - ${busiest.drillsCompleted} drills logged.`,
    );
  }

  // --- Areas to improve, each tied to something measured ---------------------
  if (session?.weakestZone) {
    const stats = session.zoneBreakdown[session.weakestZone];
    areasToImprove.push(
      stats && stats.attempts >= MIN_ZONE_ATTEMPTS
        ? `${ZONE_LABELS[session.weakestZone]} is costing you most - ${fgPercent(stats.makes, stats.attempts)}% on ${stats.attempts} attempts.`
        : `${ZONE_LABELS[session.weakestZone]} is worth a closer look, though you haven't taken many there yet.`,
    );
  }
  if (session && session.fgPercent < 40 && session.totalAttempts >= 10) {
    areasToImprove.push(
      `Your last session came in at ${session.fgPercent}% across ${session.totalAttempts} attempts - low enough that shot selection is worth reviewing, not just your stroke.`,
    );
  }
  // Only worth saying to someone with a track record. Telling a player who
  // signed up yesterday that they haven't trained this week is a criticism of
  // something they haven't had the chance to do yet.
  const hasHistory =
    Boolean(session) || input.currentStreak > 0 || input.topSkills.length > 0;
  if (input.workoutsThisWeek === 0 && hasHistory) {
    areasToImprove.push(
      "No completed workouts in the last 7 days. Volume is the thing you control most directly.",
    );
  }

  const isDataBacked = positives.length > 0 || areasToImprove.length > 0;

  return {
    positives,
    areasToImprove,
    planSteps: buildPlanSteps(input, isDataBacked),
    isDataBacked,
  };
}

/** Concrete next actions, in order. Never a sentiment. */
function buildPlanSteps(
  input: RecoveryInput,
  isDataBacked: boolean,
): string[] {
  if (!isDataBacked) {
    return [
      "Log a shooting session in Analyze - tap each attempt as you watch it back.",
      "Complete one workout in Train this week.",
      "Come back here afterwards and this plan will be built from your real data instead.",
    ];
  }

  const steps: string[] = [];
  const { session } = input;

  if (session?.weakestZone) {
    steps.push(
      `Rewatch your last session and jump to your ${ZONE_LABELS[session.weakestZone]} attempts specifically - look at your feet on the catch before you look at your release.`,
    );
    // Only worth saying when that workout actually exists. Telling a player to
    // run a workout the app never generated is a dead instruction.
    if (session.recommendedWorkoutId) {
      steps.push("Run the workout built from that session before your next game.");
    }
  } else {
    steps.push(
      "Log a shooting session in Analyze so the next version of this plan can point at a specific zone.",
    );
  }

  if (input.workoutsThisWeek === 0) {
    steps.push("Get one full workout completed in the next 48 hours.");
  } else {
    steps.push(
      "Keep your training days where they are - don't add volume to punish yourself for one game.",
    );
  }

  steps.push(
    "Before your next game, run the pre-game routine above for whatever you're actually feeling then.",
  );

  return steps;
}

/**
 * The line Coach opens with when a player brings their recovery plan across
 * (BRD 7.10 "Coach analyzes the player's actual data").
 *
 * Composed here rather than by the LLM, and here rather than inside
 * `coachService`, for two reasons: it is the one piece of prose the BRD's
 * success criterion is actually graded on, so it deserves a unit test that
 * doesn't need a database; and it must work verbatim with no API key, which
 * is the state this app runs in today.
 *
 * Never sympathy, never a quote - it states where the numbers came from, uses
 * them, and hands back a choice.
 */
export function recoveryPlanOpeningLine(
  plan: Pick<RecoveryPlan, "positives" | "planSteps" | "isDataBacked">,
  session?: RecoveryInputSession,
  /** The closing question. Coach passes its personality's own, so the line
   * keeps its voice while the facts in front of it stay fixed. */
  closing = "Do you want to work through the shot selection, or what your feet are doing on the catch?",
): string {
  if (!plan.isDataBacked) {
    return [
      "I've got your recovery plan, but there isn't enough logged activity behind it yet for me to point at your own numbers - and I'd rather not guess at them.",
      "Log a shooting session in Analyze and finish one workout this week, then rebuild the plan and I'll have something real to work from.",
      "Until then: tell me what actually went wrong in the game and we'll start there.",
    ].join(" ");
  }

  const parts = [
    "I've got your recovery plan and the session it came from - every number in it is yours, not a guess.",
  ];

  if (session) {
    parts.push(
      `That session was ${session.totalMakes} of ${session.totalAttempts} (${session.fgPercent}%).`,
    );
    if (session.weakestZone) {
      const stats = session.zoneBreakdown[session.weakestZone];
      parts.push(
        stats
          ? `${ZONE_LABELS[session.weakestZone]} is the number that stands out - ${fgPercent(stats.makes, stats.attempts)}% on ${stats.attempts} attempts.`
          : `${ZONE_LABELS[session.weakestZone]} is the spot that stands out.`,
      );
    }
  }

  const positive = plan.positives[0];
  if (positive) {
    parts.push(positive);
  }

  const firstStep = plan.planSteps[0];
  if (firstStep) {
    parts.push(`First thing: ${firstStep}`);
  }

  parts.push(closing);

  return parts.join(" ");
}
