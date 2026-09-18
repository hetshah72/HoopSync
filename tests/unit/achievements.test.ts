import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_KEYS,
  SHARED_MILESTONE_THRESHOLDS,
  SKILL_DRILL_THRESHOLD,
  achievementFor,
  evaluateAchievements,
  nextAchievement,
  type AchievementInputs,
} from "@/lib/achievements";
import { SKILL_CATEGORIES } from "@/lib/validation/onboarding";

const ZERO: AchievementInputs = {
  totalWorkoutsCompleted: 0,
  totalShotSessions: 0,
  totalShotMakes: 0,
  longestStreak: 0,
  drillsCompletedBySkill: {},
  completedGoals: 0,
  gameFilmAnalyses: 0,
  coachShares: 0,
};

function met(inputs: Partial<AchievementInputs>): Set<string> {
  return new Set(
    evaluateAchievements({ ...ZERO, ...inputs })
      .filter((entry) => entry.met)
      .map((entry) => entry.key),
  );
}

describe("the catalog is complete and well-formed", () => {
  it("defines every key exactly once", () => {
    expect(Object.keys(ACHIEVEMENTS).sort()).toEqual([...ACHIEVEMENT_KEYS].sort());
    expect(new Set(ACHIEVEMENT_KEYS).size).toBe(ACHIEVEMENT_KEYS.length);
  });

  it("gives every achievement a non-empty label and description", () => {
    for (const key of ACHIEVEMENT_KEYS) {
      const definition = ACHIEVEMENTS[key];
      expect(definition.label.trim(), key).not.toBe("");
      expect(definition.description.trim(), key).not.toBe("");
      expect(definition.key, key).toBe(key);
    }
  });

  it("covers every skill category with a reps achievement", () => {
    for (const skill of SKILL_CATEGORIES) {
      expect(achievementFor(`skill_${skill}`), skill).toBeDefined();
    }
  });

  it("resolves unknown keys to undefined rather than throwing", () => {
    expect(achievementFor("not_a_real_achievement")).toBeUndefined();
  });
});

/**
 * The guard that keeps BRD 7.13 and BRD 7.15 from drifting apart. If someone
 * adds a threshold to MILESTONE_THRESHOLDS, a player would get a milestone
 * notification with no corresponding badge; this fails first.
 */
describe("thresholds stay aligned with the milestone notifications", () => {
  const targetsFor = (read: (i: AchievementInputs) => number): Set<number> => {
    const targets = new Set<number>();
    for (const key of ACHIEVEMENT_KEYS) {
      const definition = ACHIEVEMENTS[key];
      // Probe the measure: feed a distinctive value through one counter and
      // see which definitions read it.
      const probe = { ...ZERO };
      const marker = 987_654;
      const before = definition.measure(probe);
      const after = definition.measure(applyCounter(probe, read, marker));
      if (after.current !== before.current) targets.add(after.target);
    }
    return targets;
  };

  it("has a badge for every shared workouts threshold", () => {
    const targets = targetsFor((i) => i.totalWorkoutsCompleted);
    for (const threshold of SHARED_MILESTONE_THRESHOLDS.workouts) {
      expect(targets, `workouts ${threshold}`).toContain(threshold);
    }
  });

  it("has a badge for every shared streak threshold", () => {
    const targets = targetsFor((i) => i.longestStreak);
    for (const threshold of SHARED_MILESTONE_THRESHOLDS.streak) {
      expect(targets, `streak ${threshold}`).toContain(threshold);
    }
  });

  it("has a badge for every shared shooting-session threshold", () => {
    const targets = targetsFor((i) => i.totalShotSessions);
    for (const threshold of SHARED_MILESTONE_THRESHOLDS.shot_sessions) {
      expect(targets, `sessions ${threshold}`).toContain(threshold);
    }
  });
});

/** Sets whichever field `read` looks at to `value`. */
function applyCounter(
  inputs: AchievementInputs,
  read: (i: AchievementInputs) => number,
  value: number,
): AchievementInputs {
  const candidates: (keyof AchievementInputs)[] = [
    "totalWorkoutsCompleted",
    "totalShotSessions",
    "totalShotMakes",
    "longestStreak",
    "completedGoals",
    "gameFilmAnalyses",
    "coachShares",
  ];
  for (const field of candidates) {
    const next = { ...inputs, [field]: value };
    if (read(next) === value) return next;
  }
  return inputs;
}

describe("evaluateAchievements", () => {
  it("reports every achievement, met or not", () => {
    expect(evaluateAchievements(ZERO)).toHaveLength(ACHIEVEMENT_KEYS.length);
  });

  it("unlocks nothing and shows no progress for a brand-new account", () => {
    const progress = evaluateAchievements(ZERO);
    expect(progress.every((entry) => !entry.met)).toBe(true);
    expect(progress.every((entry) => entry.percent === 0)).toBe(true);
  });

  it("unlocks at exactly the threshold but not one below", () => {
    expect(met({ totalWorkoutsCompleted: 10 })).toContain("workouts_10");
    expect(met({ totalWorkoutsCompleted: 9 })).not.toContain("workouts_10");

    expect(met({ longestStreak: 7 })).toContain("streak_7");
    expect(met({ longestStreak: 6 })).not.toContain("streak_7");

    expect(met({ totalShotMakes: 500 })).toContain("makes_500");
    expect(met({ totalShotMakes: 499 })).not.toContain("makes_500");
  });

  it("unlocks every lower tier of a family once a high count is reached", () => {
    const unlocked = met({ totalWorkoutsCompleted: 100 });
    for (const key of [
      "first_workout",
      "workouts_10",
      "workouts_25",
      "workouts_50",
      "workouts_100",
    ]) {
      expect(unlocked, key).toContain(key);
    }
  });

  it("reports truthful current and target on a locked achievement", () => {
    const entry = evaluateAchievements({ ...ZERO, totalWorkoutsCompleted: 7 }).find(
      (e) => e.key === "workouts_10",
    )!;
    expect(entry.current).toBe(7);
    expect(entry.target).toBe(10);
    expect(entry.met).toBe(false);
    expect(entry.percent).toBe(70);
  });

  it("clamps percent at 100 once a target is beaten", () => {
    const entry = evaluateAchievements({
      ...ZERO,
      totalWorkoutsCompleted: 400,
    }).find((e) => e.key === "workouts_100")!;
    expect(entry.percent).toBe(100);
  });

  it("reads streak achievements off the longest streak, not the current one", () => {
    // A player whose current streak has lapsed keeps the badge - there is no
    // `currentStreak` field here at all, which is the point.
    expect(met({ longestStreak: 30 })).toContain("streak_30");
  });
});

describe("skill achievements count reps, never rate ability", () => {
  it("unlocks per skill at the drill threshold", () => {
    const unlocked = met({
      drillsCompletedBySkill: { shooting: SKILL_DRILL_THRESHOLD },
    });
    expect(unlocked).toContain("skill_shooting");
    expect(unlocked).not.toContain("skill_defense");
  });

  it("never sums drills across skills", () => {
    // 20 + 20 is not 25 of anything. skill-metrics credits a drill once per
    // skill tag, so summing the map would double-count multi-tag drills.
    const unlocked = met({
      drillsCompletedBySkill: { shooting: 20, ball_handling: 20 },
    });
    expect(unlocked).not.toContain("skill_shooting");
    expect(unlocked).not.toContain("skill_ball_handling");
  });

  it("treats an absent skill as zero rather than failing", () => {
    const entry = evaluateAchievements({
      ...ZERO,
      drillsCompletedBySkill: {},
    }).find((e) => e.key === "skill_footwork")!;
    expect(entry.current).toBe(0);
  });

  it("never uses rating language anywhere in the catalog", () => {
    // The honesty bar as an assertion. skill-breakdown.tsx refuses to imply a
    // measured ability score; nothing here may reintroduce one.
    const banned = [
      "rating",
      "rated",
      "score",
      "out of 100",
      "skill level",
      "ranked",
      "grade",
    ];
    for (const key of ACHIEVEMENT_KEYS) {
      const text =
        `${ACHIEVEMENTS[key].label} ${ACHIEVEMENTS[key].description}`.toLowerCase();
      for (const word of banned) {
        expect(text, `${key} must not say "${word}"`).not.toContain(word);
      }
    }
  });
});

describe("loop milestones", () => {
  it("unlocks on the first of each real activity", () => {
    expect(met({ totalShotSessions: 1 })).toContain("first_session_analyzed");
    expect(met({ completedGoals: 1 })).toContain("first_goal_completed");
    expect(met({ gameFilmAnalyses: 1 })).toContain("first_game_film");
    expect(met({ coachShares: 1 })).toContain("first_coach_share");
  });

  it("stays locked until the activity actually happens", () => {
    const unlocked = met({ totalWorkoutsCompleted: 50 });
    expect(unlocked).not.toContain("first_goal_completed");
    expect(unlocked).not.toContain("first_game_film");
    expect(unlocked).not.toContain("first_coach_share");
  });
});

describe("nextAchievement", () => {
  it("is null once everything is unlocked", () => {
    const everything = evaluateAchievements({
      totalWorkoutsCompleted: 1_000,
      totalShotSessions: 1_000,
      totalShotMakes: 100_000,
      longestStreak: 1_000,
      drillsCompletedBySkill: Object.fromEntries(
        SKILL_CATEGORIES.map((skill) => [skill, 500]),
      ),
      completedGoals: 5,
      gameFilmAnalyses: 5,
      coachShares: 5,
    });
    expect(nextAchievement(everything)).toBeNull();
  });

  it("points at the closest unearned achievement, not the smallest target", () => {
    // 24/25 drills is closer than 0/100 makes, even though makes has a bigger
    // absolute gap and workouts_10 has a smaller one.
    const progress = evaluateAchievements({
      ...ZERO,
      totalWorkoutsCompleted: 1,
      drillsCompletedBySkill: { shooting: 24 },
    });
    expect(nextAchievement(progress)?.key).toBe("skill_shooting");
  });

  it("returns a locked entry for a brand-new account rather than nothing", () => {
    expect(nextAchievement(evaluateAchievements(ZERO))).not.toBeNull();
  });
});
