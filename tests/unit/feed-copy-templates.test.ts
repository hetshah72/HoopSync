import { describe, expect, it } from "vitest";
import {
  achievementCopy,
  confidenceCopy,
  dailyWorkoutCopy,
  goalCopy,
  nextStepCopy,
  progressCopy,
  weaknessCopy,
} from "@/lib/feed-copy-templates";

describe("weaknessCopy", () => {
  const input = {
    zoneLabel: "Left Wing 3",
    makes: 2,
    attempts: 9,
    fgPercent: 22.2,
    sessionCount: 3,
    bestZoneLabel: "Paint",
    bestZoneFgPercent: 66.7,
  };

  it("states the player's real makes, attempts and percentage", () => {
    const copy = weaknessCopy(input, "key");
    expect(copy.body).toContain("2 of 9");
    expect(copy.body).toContain("22.2%");
    expect(copy.body).toContain("Left Wing 3");
  });

  it("compares against the best zone when there is one", () => {
    expect(weaknessCopy(input, "key").body).toContain("66.7% from Paint");
  });

  it("does not invent a comparison when only one zone was logged", () => {
    const copy = weaknessCopy(
      { ...input, bestZoneLabel: undefined, bestZoneFgPercent: undefined },
      "key",
    );
    expect(copy.body).not.toContain("Paint");
    expect(copy.body).toContain("second spot");
  });

  it("is stable for a key and varies across keys", () => {
    expect(weaknessCopy(input, "a").title).toBe(weaknessCopy(input, "a").title);
    const titles = new Set(
      Array.from({ length: 30 }, (_, i) => weaknessCopy(input, `k${i}`).title),
    );
    expect(titles.size).toBeGreaterThan(1);
  });
});

describe("progressCopy", () => {
  const base = {
    workoutsThisWeek: 4,
    workoutsLastWeek: 2,
    currentStreak: 3,
    totalWorkoutsCompleted: 12,
    totalShotSessions: 5,
  };

  it("reports a week-over-week increase", () => {
    expect(progressCopy(base, "k").body).toContain("2 more than the week before");
  });

  it("reports a decrease", () => {
    const copy = progressCopy({ ...base, workoutsThisWeek: 1, workoutsLastWeek: 4 }, "k");
    expect(copy.body).toContain("3 fewer than the week before");
  });

  it("reports no change without claiming movement", () => {
    const copy = progressCopy({ ...base, workoutsThisWeek: 2, workoutsLastWeek: 2 }, "k");
    expect(copy.body).toContain("the same as the week before");
  });

  it("handles a quiet week honestly", () => {
    const copy = progressCopy({ ...base, workoutsThisWeek: 0 }, "k");
    expect(copy.body).toContain("haven't finished a workout in the last 7 days");
  });

  it("omits the streak line when there is no streak to speak of", () => {
    expect(progressCopy({ ...base, currentStreak: 1 }, "k").body).not.toContain("streak");
  });

  it("pluralises counts correctly", () => {
    const copy = progressCopy(
      { ...base, workoutsThisWeek: 1, workoutsLastWeek: 1, totalWorkoutsCompleted: 1, totalShotSessions: 1 },
      "k",
    );
    expect(copy.body).toContain("1 workout in the last 7 days");
    expect(copy.body).toContain("1 shooting session");
    expect(copy.body).not.toContain("1 workouts");
  });
});

describe("dailyWorkoutCopy", () => {
  it("states the real drill count and estimate", () => {
    const copy = dailyWorkoutCopy(
      {
        drillCount: 4,
        estimatedMinutes: 25,
        firstDrillName: "Form Shooting",
        reason: "Built around Left Wing 3, your lowest-percentage spot.",
      },
      "k",
    );
    expect(copy.body).toContain("4 drills");
    expect(copy.body).toContain("25 minutes");
    expect(copy.body).toContain("Form Shooting");
    expect(copy.body).toContain("Left Wing 3");
  });

  it("reads correctly for a single drill", () => {
    const copy = dailyWorkoutCopy(
      { drillCount: 1, estimatedMinutes: 10, reason: "A general session." },
      "k",
    );
    expect(copy.body).toContain("1 drill,");
    expect(copy.body).not.toContain("1 drills");
  });
});

describe("goalCopy", () => {
  it("shows real progress toward the target", () => {
    const copy = goalCopy(
      {
        goalTitle: "Raise 3PT% to 38%",
        currentValue: 30,
        targetValue: 38,
        unit: "%",
        progressPercent: 79,
      },
      "k",
    );
    expect(copy.body).toContain("30 of 38");
    expect(copy.body).toContain("8 % to go");
  });

  it("acknowledges a completed target instead of asking for more", () => {
    const copy = goalCopy(
      {
        goalTitle: "Make 500 shots",
        currentValue: 520,
        targetValue: 500,
        unit: "makes",
        progressPercent: 100,
      },
      "k",
    );
    expect(copy.body).toContain("hit the target");
  });
});

describe("nextStepCopy", () => {
  it("asks a brand-new player for one workout, and claims nothing about them", () => {
    const copy = nextStepCopy({ hasCompletedWorkout: false, hasLoggedSession: false });
    expect(copy.title).toContain("one workout");
    // The whole point of this card: no measured claim can exist yet.
    expect(copy.body).not.toMatch(/\d+%/);
  });

  it("asks for a session once they've trained but never logged shots", () => {
    const copy = nextStepCopy({ hasCompletedWorkout: true, hasLoggedSession: false });
    expect(copy.title).toContain("shooting session");
  });
});

describe("confidenceCopy", () => {
  it("is stable per key and varies across keys", () => {
    expect(confidenceCopy("a")).toEqual(confidenceCopy("a"));
    const titles = new Set(
      Array.from({ length: 40 }, (_, i) => confidenceCopy(`k${i}`).title),
    );
    expect(titles.size).toBeGreaterThan(1);
  });
});

describe("achievementCopy", () => {
  const input = {
    label: "Ten Deep",
    description: "10 workouts completed.",
    unlockedCount: 4,
    totalCount: 26,
    xp: 820,
    nextLabel: "Twenty-Five In",
    nextCurrent: 10,
    nextTarget: 25,
  };

  it("is stable per rotation key and varies across keys", () => {
    expect(achievementCopy(input, "a")).toEqual(achievementCopy(input, "a"));
    const titles = new Set(
      Array.from({ length: 40 }, (_, i) => achievementCopy(input, `k${i}`).title),
    );
    expect(titles.size).toBeGreaterThan(1);
  });

  it("quotes only the real figures it was given", () => {
    const copy = achievementCopy(input, "seed");
    expect(copy.title).toContain("Ten Deep");
    expect(copy.body).toContain("4 of 26 milestones");
    expect(copy.body).toContain("820 training XP");
  });

  it("points at the next milestone rather than ending on the reward", () => {
    const copy = achievementCopy(input, "seed");
    expect(copy.body).toContain("Next up: Twenty-Five In");
    expect(copy.body).toContain("10 of 25");
  });

  it("handles having earned everything without inventing a next target", () => {
    const copy = achievementCopy(
      { ...input, nextLabel: undefined, nextCurrent: undefined, nextTarget: undefined },
      "seed",
    );
    expect(copy.body).not.toContain("Next up");
    expect(copy.body).toContain("every milestone");
  });

  it("never shouts - no exclamation marks or game-y rank language", () => {
    // BRD 7.13: this must read as training that added up, not as a game.
    for (let i = 0; i < 20; i++) {
      const copy = achievementCopy(input, `k${i}`);
      const text = `${copy.title} ${copy.body}`;
      expect(text).not.toContain("!");
      expect(text.toLowerCase()).not.toContain("level up");
      expect(text.toLowerCase()).not.toContain("rank");
    }
  });
});
