import { describe, expect, it } from "vitest";
import {
  formatHour,
  hourInZone,
  isHourWithin,
  isWithinQuietHours,
} from "@/lib/quiet-hours";

describe("isHourWithin", () => {
  it("handles a same-day window", () => {
    const window = { startHour: 9, endHour: 17 };
    expect(isHourWithin(9, window)).toBe(true);
    expect(isHourWithin(16, window)).toBe(true);
    // End is exclusive, so a 9-17 window ends as 17:00 begins.
    expect(isHourWithin(17, window)).toBe(false);
    expect(isHourWithin(8, window)).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    // The case that actually matters: nobody sets quiet hours inside one day.
    const window = { startHour: 22, endHour: 7 };
    expect(isHourWithin(22, window)).toBe(true);
    expect(isHourWithin(23, window)).toBe(true);
    expect(isHourWithin(0, window)).toBe(true);
    expect(isHourWithin(6, window)).toBe(true);
    expect(isHourWithin(7, window)).toBe(false);
    expect(isHourWithin(12, window)).toBe(false);
  });

  it("treats an empty window as no quiet hours, never as all day", () => {
    // Guards the difference between "off" and "silenced forever".
    for (let hour = 0; hour < 24; hour += 1) {
      expect(isHourWithin(hour, { startHour: 3, endHour: 3 })).toBe(false);
    }
  });
});

describe("hourInZone", () => {
  it("resolves the hour in the given zone", () => {
    // 2026-01-15T12:00:00Z is 07:00 in New York (UTC-5 in January).
    const noonUtc = new Date("2026-01-15T12:00:00Z");
    expect(hourInZone(noonUtc, "America/New_York")).toBe(7);
    expect(hourInZone(noonUtc, "UTC")).toBe(12);
  });

  it("renders midnight as 0 rather than 24", () => {
    // `hour12: false` yields "24" in some ICU builds, which would put midnight
    // outside every window.
    const midnightUtc = new Date("2026-01-15T00:00:00Z");
    expect(hourInZone(midnightUtc, "UTC")).toBe(0);
  });

  it("falls back to server-local time for an unknown zone", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    expect(hourInZone(date, "Not/AZone")).toBe(date.getHours());
    expect(hourInZone(date, undefined)).toBe(date.getHours());
  });
});

describe("isWithinQuietHours", () => {
  const preferences = {
    quietHours: { startHour: 22, endHour: 7 },
    timeZone: "America/New_York",
  };

  it("is true overnight in the player's own zone", () => {
    // 05:00 UTC is midnight in New York.
    expect(
      isWithinQuietHours(new Date("2026-01-15T05:00:00Z"), preferences),
    ).toBe(true);
  });

  it("is false during the player's afternoon", () => {
    // 18:00 UTC is 13:00 in New York.
    expect(
      isWithinQuietHours(new Date("2026-01-15T18:00:00Z"), preferences),
    ).toBe(false);
  });

  it("is false when no window is set", () => {
    expect(isWithinQuietHours(new Date(), undefined)).toBe(false);
    expect(isWithinQuietHours(new Date(), { timeZone: "UTC" })).toBe(false);
  });
});

describe("formatHour", () => {
  it("renders a 12-hour clock", () => {
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(7)).toBe("7 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(22)).toBe("10 PM");
  });
});
