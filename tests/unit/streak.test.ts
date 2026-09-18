import { describe, expect, it } from "vitest";
import { computeNextStreak } from "@/lib/streak";

describe("computeNextStreak", () => {
  it("starts a streak at 1 on the first-ever activity", () => {
    const result = computeNextStreak({ currentStreak: 0, longestStreak: 0 });
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it("does not double-count a second activity on the same day", () => {
    const today = new Date(2026, 5, 15, 9, 0);
    const laterToday = new Date(2026, 5, 15, 18, 0);
    const first = computeNextStreak({ currentStreak: 0, longestStreak: 0 }, today);
    const second = computeNextStreak(first, laterToday);
    expect(second.currentStreak).toBe(1);
  });

  it("extends the streak on a consecutive day", () => {
    const day1 = new Date(2026, 5, 15);
    const day2 = new Date(2026, 5, 16);
    const first = computeNextStreak({ currentStreak: 0, longestStreak: 0 }, day1);
    const second = computeNextStreak(first, day2);
    expect(second.currentStreak).toBe(2);
    expect(second.longestStreak).toBe(2);
  });

  it("resets the streak after a missed day", () => {
    const day1 = new Date(2026, 5, 15);
    const day3 = new Date(2026, 5, 17); // day 2 skipped
    const first = computeNextStreak({ currentStreak: 5, longestStreak: 5 }, day1);
    const second = computeNextStreak(first, day3);
    expect(second.currentStreak).toBe(1);
    expect(second.longestStreak).toBe(5); // longest is preserved
  });
});
