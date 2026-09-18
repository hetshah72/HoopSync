import { describe, expect, it } from "vitest";
import {
  applyWorkoutToSkillMetrics,
  computeSkillMetricsFromWorkouts,
  rankSkillsByVolume,
  skillsTrainedInWorkout,
} from "@/lib/skill-metrics";
import type { SkillCategory } from "@/types/db";

function drill(overrides: {
  completed: boolean;
  skillTags?: SkillCategory[];
  elapsedSeconds?: number;
  skipped?: boolean;
}) {
  return {
    drillId: undefined as never,
    order: 1,
    name: "d",
    coachingCues: [],
    ...overrides,
  };
}

const JAN_1 = new Date("2026-01-01T10:00:00Z");
const JAN_2 = new Date("2026-01-02T10:00:00Z");

describe("skillsTrainedInWorkout", () => {
  it("credits only drills the player actually completed", () => {
    const skills = skillsTrainedInWorkout([
      drill({ completed: true, skillTags: ["shooting"] }),
      drill({ completed: false, skillTags: ["defense"] }),
      drill({ completed: false, skipped: true, skillTags: ["playmaking"] }),
    ]);

    // A workout titled "shooting & defense" that the player half-finished has
    // not trained defense, and Progress must not claim it did.
    expect(skills).toEqual(["shooting"]);
  });

  it("returns nothing when a workout was completed with no drills done", () => {
    expect(
      skillsTrainedInWorkout([drill({ completed: false, skillTags: ["shooting"] })]),
    ).toEqual([]);
  });
});

describe("applyWorkoutToSkillMetrics", () => {
  it("counts one workout but every completed drill for a skill", () => {
    const metrics = applyWorkoutToSkillMetrics(
      {},
      {
        drills: [
          drill({ completed: true, skillTags: ["shooting"], elapsedSeconds: 60 }),
          drill({ completed: true, skillTags: ["shooting"], elapsedSeconds: 30 }),
        ],
      },
      JAN_1,
    );

    expect(metrics.shooting).toEqual({
      workoutsCompleted: 1,
      drillsCompleted: 2,
      secondsTrained: 90,
      lastTrainedAt: JAN_1,
    });
  });

  it("credits a multi-tag drill to each of its skills", () => {
    const metrics = applyWorkoutToSkillMetrics(
      {},
      { drills: [drill({ completed: true, skillTags: ["shooting", "footwork"] })] },
      JAN_1,
    );

    expect(metrics.shooting?.drillsCompleted).toBe(1);
    expect(metrics.footwork?.drillsCompleted).toBe(1);
  });

  it("accumulates across workouts and advances lastTrainedAt", () => {
    const first = applyWorkoutToSkillMetrics(
      {},
      { drills: [drill({ completed: true, skillTags: ["defense"] })] },
      JAN_1,
    );
    const second = applyWorkoutToSkillMetrics(
      first,
      { drills: [drill({ completed: true, skillTags: ["defense"] })] },
      JAN_2,
    );

    expect(second.defense?.workoutsCompleted).toBe(2);
    expect(second.defense?.lastTrainedAt).toEqual(JAN_2);
  });

  it("never moves lastTrainedAt backwards for an out-of-order write", () => {
    const later = applyWorkoutToSkillMetrics(
      {},
      { drills: [drill({ completed: true, skillTags: ["defense"] })] },
      JAN_2,
    );
    const earlier = applyWorkoutToSkillMetrics(
      later,
      { drills: [drill({ completed: true, skillTags: ["defense"] })] },
      JAN_1,
    );

    expect(earlier.defense?.lastTrainedAt).toEqual(JAN_2);
  });

  it("does not mutate the metrics it was given", () => {
    const original = {};
    applyWorkoutToSkillMetrics(
      original,
      { drills: [drill({ completed: true, skillTags: ["shooting"] })] },
      JAN_1,
    );
    expect(original).toEqual({});
  });
});

describe("computeSkillMetricsFromWorkouts", () => {
  it("reproduces exactly what incremental application produces", () => {
    // This equivalence is the whole justification for keeping denormalized
    // counters: they must never drift from the workouts they came from.
    const workouts = [
      {
        status: "completed" as const,
        completedAt: JAN_1,
        drills: [drill({ completed: true, skillTags: ["shooting"], elapsedSeconds: 60 })],
      },
      {
        status: "completed" as const,
        completedAt: JAN_2,
        drills: [drill({ completed: true, skillTags: ["shooting"], elapsedSeconds: 40 })],
      },
    ];

    const rebuilt = computeSkillMetricsFromWorkouts(workouts);
    const incremental = workouts.reduce(
      (acc, w) => applyWorkoutToSkillMetrics(acc, w, w.completedAt),
      {},
    );

    expect(rebuilt).toEqual(incremental);
    expect(rebuilt.shooting?.secondsTrained).toBe(100);
  });

  it("ignores workouts that were never completed", () => {
    const metrics = computeSkillMetricsFromWorkouts([
      {
        status: "pending",
        drills: [drill({ completed: true, skillTags: ["shooting"] })],
      },
    ]);
    expect(metrics).toEqual({});
  });
});

describe("rankSkillsByVolume", () => {
  it("orders by drills completed and omits untrained skills", () => {
    const ranked = rankSkillsByVolume({
      shooting: { workoutsCompleted: 1, drillsCompleted: 1, secondsTrained: 0 },
      defense: { workoutsCompleted: 2, drillsCompleted: 5, secondsTrained: 0 },
      footwork: { workoutsCompleted: 0, drillsCompleted: 0, secondsTrained: 0 },
    });

    expect(ranked.map((r) => r.skill)).toEqual(["defense", "shooting"]);
  });
});
