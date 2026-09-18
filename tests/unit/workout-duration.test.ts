import { describe, expect, it } from "vitest";
import {
  estimateDrillSeconds,
  estimateWorkoutMinutes,
  formatDuration,
  formatPrescription,
  totalElapsedSeconds,
} from "@/lib/workout-duration";

describe("estimateDrillSeconds", () => {
  it("derives time from sets and reps", () => {
    // 3 sets x 15 reps x 4s = 180s work, plus 2 rest gaps x 45s = 270s.
    expect(estimateDrillSeconds({ sets: 3, reps: 15 })).toBe(270);
  });

  it("derives time from a prescribed duration", () => {
    // 3 x 45s = 135s work, plus 2 x 45s rest = 225s.
    expect(estimateDrillSeconds({ sets: 3, durationSeconds: 45 })).toBe(225);
  });

  it("charges no rest after the final set", () => {
    expect(estimateDrillSeconds({ sets: 1, durationSeconds: 60 })).toBe(60);
  });

  it("falls back for a drill with no prescription at all", () => {
    expect(estimateDrillSeconds({})).toBe(300);
  });
});

describe("estimateWorkoutMinutes", () => {
  it("is zero for an empty workout rather than a spurious minimum", () => {
    expect(estimateWorkoutMinutes([])).toBe(0);
  });

  it("rounds to the nearest five minutes", () => {
    // Rounding is deliberate: a to-the-minute figure would imply a precision
    // this heuristic doesn't have.
    expect(estimateWorkoutMinutes([{ sets: 3, reps: 15 }]) % 5).toBe(0);
  });

  it("never advertises less than five minutes of work", () => {
    expect(estimateWorkoutMinutes([{ sets: 1, reps: 1 }])).toBe(5);
  });

  it("grows with the number of drills", () => {
    const one = estimateWorkoutMinutes([{ sets: 3, reps: 15 }]);
    const three = estimateWorkoutMinutes([
      { sets: 3, reps: 15 },
      { sets: 3, reps: 15 },
      { sets: 3, reps: 15 },
    ]);
    expect(three).toBeGreaterThan(one);
  });
});

describe("formatPrescription", () => {
  it("shows sets and reps together", () => {
    expect(formatPrescription({ sets: 4, reps: 10 })).toBe("4 sets x 10 reps");
  });

  it("shows both sets/reps and a duration when a drill carries both", () => {
    // The old screen showed one or the other, so a drill prescribing both
    // silently lost half its instruction.
    expect(formatPrescription({ sets: 3, reps: 10, durationSeconds: 60 })).toBe(
      "3 sets x 10 reps - 1 min",
    );
  });

  it("labels a per-set duration when there are no reps", () => {
    expect(formatPrescription({ sets: 3, durationSeconds: 45 })).toBe(
      "3 sets - 45s each",
    );
  });

  it("returns null when there is nothing to show", () => {
    expect(formatPrescription({})).toBeNull();
  });
});

describe("totalElapsedSeconds", () => {
  it("sums real time across drills, treating unrecorded as zero", () => {
    expect(
      totalElapsedSeconds([
        { elapsedSeconds: 60 },
        {},
        { elapsedSeconds: 30 },
      ]),
    ).toBe(90);
  });
});

describe("formatDuration", () => {
  it("formats as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("never renders a negative clock", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});
