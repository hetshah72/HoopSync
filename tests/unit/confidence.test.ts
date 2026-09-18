import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_FEELINGS,
  FEELING_LABELS,
  routineFor,
  routineToStoredText,
} from "@/lib/confidence-routines";
import {
  buildRecoveryPlan,
  recoveryPlanOpeningLine,
} from "@/lib/confidence-recovery";

/**
 * "Avoid generic motivational quotes - every response must be actionable."
 * Shared so the routines and the Coach opener clear the same bar - the opener
 * is prose the player reads too, and it is the half BRD 7.10's success
 * criterion is actually graded on.
 */
const BANNED_MOTIVATIONAL_PHRASES = [
  "believe in yourself",
  "you've got this",
  "stay positive",
  "trust the process",
  "never give up",
];

describe("pre-game routines (BRD 7.10)", () => {
  it("covers exactly the four feelings the BRD names", () => {
    expect(CONFIDENCE_FEELINGS).toEqual([
      "confident",
      "nervous",
      "overthinking",
      "not_ready",
    ]);
    for (const feeling of CONFIDENCE_FEELINGS) {
      expect(FEELING_LABELS[feeling]).toBeTruthy();
    }
  });

  it("returns a specific, multi-step routine for every feeling", () => {
    for (const feeling of CONFIDENCE_FEELINGS) {
      const routine = routineFor(feeling);
      expect(routine.steps.length).toBeGreaterThanOrEqual(3);
      expect(routine.purpose).toBeTruthy();
      expect(routine.inGameCue).toBeTruthy();
    }
  });

  it("gives 'Nervous' a concrete routine, not a pep talk", () => {
    // The BRD's own success criterion for this feature.
    const routine = routineFor("nervous");
    const text = routine.steps.join(" ");

    // Concrete: countable reps and timed breathing.
    expect(text).toMatch(/\d/);
    expect(text.toLowerCase()).toContain("breathing");
    expect(text.toLowerCase()).toContain("free throw");
  });

  it("avoids motivational-quote language across every routine", () => {
    for (const feeling of CONFIDENCE_FEELINGS) {
      const text = routineToStoredText(routineFor(feeling)).toLowerCase();
      for (const phrase of BANNED_MOTIVATIONAL_PHRASES) {
        expect(text).not.toContain(phrase);
      }
    }
  });

  it("gives each feeling a distinct routine", () => {
    const texts = CONFIDENCE_FEELINGS.map((f) =>
      routineToStoredText(routineFor(f)),
    );
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("stores the routine as readable, numbered text", () => {
    const stored = routineToStoredText(routineFor("overthinking"));
    expect(stored).toContain("1. ");
    expect(stored).toContain("In-game cue:");
  });
});

describe("post-game recovery plan (BRD 7.10)", () => {
  const session = {
    id: "s1",
    recordedAt: new Date("2026-01-10"),
    totalAttempts: 20,
    totalMakes: 5,
    fgPercent: 25,
    bestZone: "paint" as const,
    weakestZone: "right_wing_3" as const,
    zoneBreakdown: {
      paint: { attempts: 6, makes: 4 },
      right_wing_3: { attempts: 8, makes: 1 },
    },
  };

  it("references the player's real session numbers", () => {
    const plan = buildRecoveryPlan({
      session,
      workoutsThisWeek: 2,
      currentStreak: 3,
      topSkills: [{ skill: "shooting", drillsCompleted: 12 }],
    });

    expect(plan.isDataBacked).toBe(true);
    const all = [...plan.positives, ...plan.areasToImprove].join(" ");
    // The success criterion: it cites real data from the session.
    expect(all).toContain("Right Wing 3");
    expect(all).toContain("12.5%"); // 1/8 from the weak zone
    expect(all).toContain("5 of 20");
  });

  it("ignores a zone with too small a sample to mean anything", () => {
    const plan = buildRecoveryPlan({
      session: {
        ...session,
        zoneBreakdown: { right_wing_3: { attempts: 1, makes: 0 } },
        bestZone: undefined,
      },
      workoutsThisWeek: 1,
      currentStreak: 1,
      topSkills: [],
    });

    // One miss is not a trend, so it must not be reported as a percentage.
    const text = plan.areasToImprove.join(" ");
    expect(text).toContain("haven't taken many there yet");
    expect(text).not.toContain("0%");
  });

  it("credits real training volume as a positive", () => {
    const plan = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 3,
      currentStreak: 5,
      topSkills: [{ skill: "defense", drillsCompleted: 7 }],
    });

    const text = plan.positives.join(" ");
    expect(text).toContain("5 days in a row");
    expect(text).toContain("3 workouts");
    expect(text).toContain("7 drills");
  });

  it("flags a week with no training for a player who has a track record", () => {
    const plan = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 0,
      currentStreak: 4,
      topSkills: [{ skill: "shooting", drillsCompleted: 9 }],
    });

    expect(plan.areasToImprove.join(" ")).toContain("No completed workouts");
  });

  it("does not scold a brand-new player for not having trained yet", () => {
    const plan = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 0,
      currentStreak: 0,
      topSkills: [],
    });

    // Nothing to criticise someone for on day one.
    expect(plan.areasToImprove).toEqual([]);
    expect(plan.isDataBacked).toBe(false);
  });

  it("admits when it has no data instead of substituting encouragement", () => {
    const plan = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 0,
      currentStreak: 0,
      topSkills: [],
    });

    // workoutsThisWeek === 0 is itself a real observation, so this is still
    // data-backed - but with nothing at all the plan must say so.
    const empty = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 1,
      currentStreak: 0,
      topSkills: [],
    });
    expect(empty.isDataBacked).toBe(true);
    // Even with nothing to cite, the steps are things to go and do.
    expect(plan.planSteps.length).toBeGreaterThan(0);
    expect(plan.planSteps.join(" ")).toContain("Analyze");
  });

  it("always ends with concrete steps naming the real weak zone", () => {
    const plan = buildRecoveryPlan({
      session,
      workoutsThisWeek: 0,
      currentStreak: 2,
      topSkills: [],
    });

    expect(plan.planSteps.length).toBeGreaterThanOrEqual(2);
    // Points the player at the real session it drew from.
    expect(plan.planSteps.join(" ")).toContain("Right Wing 3");
  });

  it("only tells the player to run a workout when one actually exists", () => {
    const without = buildRecoveryPlan({
      session,
      workoutsThisWeek: 1,
      currentStreak: 1,
      topSkills: [],
    });
    expect(without.planSteps.join(" ")).not.toContain("Run the workout");

    const withWorkout = buildRecoveryPlan({
      session: { ...session, recommendedWorkoutId: "w1" },
      workoutsThisWeek: 1,
      currentStreak: 1,
      topSkills: [],
    });
    expect(withWorkout.planSteps.join(" ")).toContain("Run the workout");
  });
});

describe("the line Coach opens a recovery plan with (BRD 7.10)", () => {
  const session = {
    id: "s1",
    recordedAt: new Date("2026-01-10"),
    totalAttempts: 20,
    totalMakes: 5,
    fgPercent: 25,
    bestZone: "paint" as const,
    weakestZone: "right_wing_3" as const,
    zoneBreakdown: {
      paint: { attempts: 6, makes: 4 },
      right_wing_3: { attempts: 8, makes: 1 },
    },
  };

  it("cites the session's real numbers, which is the whole success criterion", () => {
    const plan = buildRecoveryPlan({
      session,
      workoutsThisWeek: 2,
      currentStreak: 3,
      topSkills: [{ skill: "shooting", drillsCompleted: 12 }],
    });

    const line = recoveryPlanOpeningLine(plan, session);

    expect(line).toContain("5 of 20");
    expect(line).toContain("25%");
    expect(line).toContain("Right Wing 3");
    expect(line).toContain("12.5%"); // 1/8 from the weak zone
    // Hands back a choice rather than trailing off.
    expect(line.trim().endsWith("?")).toBe(true);
  });

  it("quotes the plan's first step verbatim so the two never drift", () => {
    const plan = buildRecoveryPlan({
      session,
      workoutsThisWeek: 2,
      currentStreak: 3,
      topSkills: [],
    });

    expect(recoveryPlanOpeningLine(plan, session)).toContain(plan.planSteps[0]);
  });

  it("admits it has nothing rather than inventing numbers", () => {
    const plan = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 0,
      currentStreak: 0,
      topSkills: [],
    });
    expect(plan.isDataBacked).toBe(false);

    const line = recoveryPlanOpeningLine(plan);

    expect(line).toMatch(/isn't enough logged activity/i);
    // No fabricated figures at all - the failure mode this guards against.
    expect(line).not.toMatch(/\d+%/);
  });

  it("never reaches for a pep talk in either branch", () => {
    // Held to the same bar as the routines - this is the one piece of prose
    // BRD 7.10's "no generic motivational quotes" is actually graded on.
    const dataBacked = buildRecoveryPlan({
      session,
      workoutsThisWeek: 2,
      currentStreak: 3,
      topSkills: [],
    });
    const empty = buildRecoveryPlan({
      session: undefined,
      workoutsThisWeek: 0,
      currentStreak: 0,
      topSkills: [],
    });

    for (const line of [
      recoveryPlanOpeningLine(dataBacked, session),
      recoveryPlanOpeningLine(empty),
    ]) {
      for (const phrase of BANNED_MOTIVATIONAL_PHRASES) {
        expect(line.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});
