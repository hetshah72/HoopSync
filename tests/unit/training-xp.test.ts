import { describe, expect, it } from "vitest";
import {
  TRAINING_TIERS,
  XP_WEIGHTS,
  tierForXp,
  tierProgressForXp,
  xpFromInputs,
  type TrainingXpInputs,
} from "@/lib/training-xp";

const ZERO: TrainingXpInputs = {
  totalWorkoutsCompleted: 0,
  totalShotSessions: 0,
  totalShotMakes: 0,
  longestStreak: 0,
};

describe("xpFromInputs", () => {
  it("is zero for a player who has done nothing", () => {
    expect(xpFromInputs(ZERO)).toBe(0);
  });

  it("sums each counter at its documented weight", () => {
    const xp = xpFromInputs({
      totalWorkoutsCompleted: 3,
      totalShotSessions: 2,
      totalShotMakes: 40,
      longestStreak: 5,
    });
    // 150 + 60 + 40 + 100
    expect(xp).toBe(350);
  });

  it("weights a workout above a logged session above a single make", () => {
    expect(XP_WEIGHTS.workoutCompleted).toBeGreaterThan(
      XP_WEIGHTS.shotSessionLogged,
    );
    expect(XP_WEIGHTS.shotSessionLogged).toBeGreaterThan(XP_WEIGHTS.shotMade);
  });

  it("never decreases when any single counter grows", () => {
    const base: TrainingXpInputs = {
      totalWorkoutsCompleted: 4,
      totalShotSessions: 3,
      totalShotMakes: 120,
      longestStreak: 6,
    };
    const baseXp = xpFromInputs(base);

    for (const field of Object.keys(base) as (keyof TrainingXpInputs)[]) {
      expect(xpFromInputs({ ...base, [field]: base[field] + 1 })).toBeGreaterThan(
        baseXp,
      );
    }
  });
});

describe("tierForXp", () => {
  it("starts everyone in the first tier", () => {
    expect(tierForXp(0).key).toBe("getting_started");
  });

  it("returns the highest tier whose threshold is reached, at every boundary", () => {
    for (const tier of TRAINING_TIERS) {
      expect(tierForXp(tier.minXp).key).toBe(tier.key);
    }
  });

  it("does not promote one XP short of a threshold", () => {
    // Every tier above the first: one below its minimum must still be the
    // tier beneath it.
    for (let i = 1; i < TRAINING_TIERS.length; i++) {
      const previous = TRAINING_TIERS[i - 1];
      expect(tierForXp(TRAINING_TIERS[i].minXp - 1).key).toBe(previous.key);
    }
  });

  it("stays at the top tier far beyond its threshold", () => {
    const top = TRAINING_TIERS[TRAINING_TIERS.length - 1];
    expect(tierForXp(top.minXp * 100).key).toBe(top.key);
  });
});

describe("tierProgressForXp", () => {
  it("reports 0% and a next tier at the very start", () => {
    const progress = tierProgressForXp(0);
    expect(progress.percent).toBe(0);
    expect(progress.nextTier?.key).toBe("putting_in_work");
    expect(progress.xpToNextTier).toBe(250);
  });

  it("reports honest progress inside a tier", () => {
    // Halfway between 250 and 750.
    const progress = tierProgressForXp(500);
    expect(progress.tier.key).toBe("putting_in_work");
    expect(progress.percent).toBe(50);
    expect(progress.xpIntoTier).toBe(250);
    expect(progress.xpTierSpan).toBe(500);
  });

  it("caps at the top tier with no next tier to chase", () => {
    const top = TRAINING_TIERS[TRAINING_TIERS.length - 1];
    const progress = tierProgressForXp(top.minXp + 50_000);
    expect(progress.nextTier).toBeNull();
    expect(progress.percent).toBe(100);
    expect(progress.xpToNextTier).toBe(0);
  });

  it("keeps percent inside 0-100 across the whole curve", () => {
    for (let xp = 0; xp <= 40_000; xp += 137) {
      const { percent } = tierProgressForXp(xp);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });

  it("treats negative or fractional XP as a real number of points", () => {
    expect(tierProgressForXp(-100).xp).toBe(0);
    expect(tierProgressForXp(10.7).xp).toBe(10);
  });
});
