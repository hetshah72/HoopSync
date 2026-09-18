import { describe, expect, it } from "vitest";
import {
  addDays,
  dayIndex,
  dayStampToDate,
  daysBetweenStamps,
  daysSince,
  toDayStamp,
  todayStamp,
} from "@/lib/day-stamp";

describe("toDayStamp", () => {
  it("formats the local calendar day, zero-padded", () => {
    expect(toDayStamp(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDayStamp(new Date(2026, 8, 14))).toBe("2026-09-14");
  });

  it("uses the local day, not UTC", () => {
    // 11pm local on the 14th is already the 15th in UTC for any timezone east
    // of Greenwich. The old `toISOString().slice(0,10)` returned the UTC day,
    // which is what rolled the feed over before midnight for real players.
    const lateEvening = new Date(2026, 8, 14, 23, 30);
    expect(toDayStamp(lateEvening)).toBe("2026-09-14");
  });

  it("todayStamp takes an injectable clock", () => {
    expect(todayStamp(new Date(2026, 8, 14, 9, 0))).toBe("2026-09-14");
  });
});

describe("dayStampToDate", () => {
  it("round-trips a stamp", () => {
    expect(toDayStamp(dayStampToDate("2026-09-14"))).toBe("2026-09-14");
  });

  it("returns local midnight", () => {
    const date = dayStampToDate("2026-09-14");
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });
});

describe("dayIndex", () => {
  it("increments by exactly one per calendar day", () => {
    expect(dayIndex("2026-09-15") - dayIndex("2026-09-14")).toBe(1);
  });

  it("increments by one across a month boundary", () => {
    expect(dayIndex("2026-10-01") - dayIndex("2026-09-30")).toBe(1);
  });

  it("increments by one across a leap day", () => {
    expect(dayIndex("2028-02-29") - dayIndex("2028-02-28")).toBe(1);
    expect(dayIndex("2028-03-01") - dayIndex("2028-02-29")).toBe(1);
  });

  it("increments by one across a daylight-saving transition", () => {
    // Computed from the stamp's own year/month/day via Date.UTC, so a local
    // clock shift can never collapse two days onto one index.
    expect(dayIndex("2026-03-09") - dayIndex("2026-03-08")).toBe(1);
    expect(dayIndex("2026-11-02") - dayIndex("2026-11-01")).toBe(1);
  });
});

describe("daysBetweenStamps", () => {
  it("counts forward and backward", () => {
    expect(daysBetweenStamps("2026-09-14", "2026-09-21")).toBe(7);
    expect(daysBetweenStamps("2026-09-21", "2026-09-14")).toBe(-7);
    expect(daysBetweenStamps("2026-09-14", "2026-09-14")).toBe(0);
  });
});

describe("daysSince", () => {
  it("measures whole calendar days, not elapsed hours", () => {
    // 11pm to 1am is two hours but one calendar day.
    const then = new Date(2026, 8, 14, 23, 0);
    const now = new Date(2026, 8, 15, 1, 0);
    expect(daysSince(then, now)).toBe(1);
  });
});

describe("addDays", () => {
  it("moves forward and backward across month boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-09-14", 0)).toBe("2026-09-14");
  });
});
