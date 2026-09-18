import { describe, expect, it } from "vitest";
import { effectiveStreak, streakStatus } from "@/lib/streak";
import {
  dedupeKeyFor,
  isTypeEnabled,
  MILESTONE_THRESHOLDS,
  thresholdsCrossed,
} from "@/lib/notification-types";

/**
 * The predicates behind the six notification types (BRD 7.15). Pure functions
 * by design, so the rules that decide whether to interrupt a player are
 * testable without a database.
 */

function at(iso: string): Date {
  // Local-time construction, matching how streak.ts compares calendar days.
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "12:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

describe("streakStatus", () => {
  const base = { currentStreak: 5, longestStreak: 9 };

  it("is active_today when they've already trained today", () => {
    expect(
      streakStatus(
        { ...base, lastActivityDate: at("2026-03-10T08:00") },
        at("2026-03-10T20:00"),
      ),
    ).toBe("active_today");
  });

  it("is at_risk on the single day the streak can still be saved", () => {
    expect(
      streakStatus(
        { ...base, lastActivityDate: at("2026-03-09T20:00") },
        at("2026-03-10T09:00"),
      ),
    ).toBe("at_risk");
  });

  it("is broken once a whole day has been missed", () => {
    expect(
      streakStatus(
        { ...base, lastActivityDate: at("2026-03-08T20:00") },
        at("2026-03-10T09:00"),
      ),
    ).toBe("broken");
  });

  it("is none for a player with no activity or a zeroed counter", () => {
    expect(streakStatus({ currentStreak: 0, longestStreak: 0 })).toBe("none");
    expect(
      streakStatus({
        currentStreak: 0,
        longestStreak: 3,
        lastActivityDate: at("2026-03-09T20:00"),
      }),
    ).toBe("none");
  });

  it("survives a spring-forward DST boundary", () => {
    // US DST began 2026-03-08. A streak must not look broken because a
    // calendar day was 23 hours long.
    expect(
      streakStatus(
        { ...base, lastActivityDate: at("2026-03-07T20:00") },
        at("2026-03-08T09:00"),
      ),
    ).toBe("at_risk");
  });
});

describe("effectiveStreak", () => {
  it("reports zero once the streak has lapsed", () => {
    // The bug this exists to prevent: `currentStreak` decays lazily, so a
    // stale 7 sits in userStats until the player next trains. Anything shown
    // to the player has to go through this.
    expect(
      effectiveStreak(
        { currentStreak: 7, longestStreak: 7, lastActivityDate: at("2026-03-01T20:00") },
        at("2026-03-10T09:00"),
      ),
    ).toBe(0);
  });

  it("reports the real number while it is still alive", () => {
    expect(
      effectiveStreak(
        { currentStreak: 7, longestStreak: 7, lastActivityDate: at("2026-03-09T20:00") },
        at("2026-03-10T09:00"),
      ),
    ).toBe(7);
  });
});

describe("thresholdsCrossed", () => {
  const thresholds = MILESTONE_THRESHOLDS.workouts; // [10, 25, 50, 100]

  it("fires only at the moment a counter moves past a threshold", () => {
    expect(thresholdsCrossed(thresholds, 9, 10)).toEqual([10]);
    expect(thresholdsCrossed(thresholds, 10, 11)).toEqual([]);
  });

  it("never backfills for a counter that was already past one", () => {
    // The whole reason milestones need no "already awarded" record: a player
    // who arrives with 40 workouts is not told they reached 10 and 25.
    expect(thresholdsCrossed(thresholds, 40, 41)).toEqual([]);
  });

  it("returns every threshold inside a single jump", () => {
    expect(thresholdsCrossed(thresholds, 8, 26)).toEqual([10, 25]);
  });

  it("returns nothing when the counter doesn't move or goes backwards", () => {
    expect(thresholdsCrossed(thresholds, 10, 10)).toEqual([]);
    expect(thresholdsCrossed(thresholds, 30, 5)).toEqual([]);
  });
});

describe("dedupeKeyFor", () => {
  it("keys the reminders by day, so each can fire at most once a day", () => {
    expect(dedupeKeyFor.workoutReminder("2026-03-10")).toBe(
      "workout_reminder:2026-03-10",
    );
    expect(dedupeKeyFor.streakReminder("2026-03-10")).not.toBe(
      dedupeKeyFor.streakReminder("2026-03-11"),
    );
  });

  it("keys milestones by threshold alone, so a rebuilt streak doesn't re-fire", () => {
    // Reaching 7 days, lapsing, then climbing back to 7 must congratulate
    // once - so the key deliberately carries no date or run identifier.
    expect(dedupeKeyFor.milestone("streak", 7)).toBe(
      dedupeKeyFor.milestone("streak", 7),
    );
    expect(dedupeKeyFor.milestone("streak", 7)).not.toBe(
      dedupeKeyFor.milestone("workouts", 7),
    );
  });
});

describe("isTypeEnabled", () => {
  it("defaults to enabled when preferences are absent", () => {
    // A profile written before notifications existed must behave as fully on
    // without a migration.
    expect(isTypeEnabled("streak_reminder", undefined)).toBe(true);
    expect(isTypeEnabled("streak_reminder", {})).toBe(true);
    expect(isTypeEnabled("streak_reminder", { types: {} })).toBe(true);
  });

  it("respects an explicit off", () => {
    expect(
      isTypeEnabled("streak_reminder", { types: { streak_reminder: false } }),
    ).toBe(false);
  });
});
