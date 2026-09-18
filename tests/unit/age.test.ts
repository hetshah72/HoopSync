import { describe, expect, it } from "vitest";
import {
  COPPA_AGE_THRESHOLD,
  calculateAge,
  parseDateInputValue,
  requiresParentalConsent,
  toDateInputValue,
} from "@/lib/age";

/**
 * Every date here is built with `Date.UTC`. The previous version of this
 * file used the local `new Date(y, m, d)` constructor, which made the
 * assertions themselves timezone-dependent - the exact confusion the
 * helpers under test exist to remove.
 */
const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

describe("calculateAge", () => {
  it("computes age before the birthday this year", () => {
    expect(calculateAge(utc(2010, 5, 15), utc(2026, 5, 10))).toBe(15);
  });

  it("computes age on/after the birthday this year", () => {
    expect(calculateAge(utc(2010, 5, 15), utc(2026, 5, 20))).toBe(16);
  });

  it("computes age exactly on the birthday", () => {
    expect(calculateAge(utc(2010, 5, 15), utc(2026, 5, 15))).toBe(16);
  });

  it("flags under the COPPA threshold correctly", () => {
    expect(calculateAge(utc(2018, 0, 1), utc(2026, 0, 1))).toBeLessThan(
      COPPA_AGE_THRESHOLD,
    );
  });

  /**
   * The regression the UTC switch exists for (audit ONB-13 / Bug AUTH-2):
   * a DOB from `<input type="date">` is UTC midnight, so reading it with
   * local getters west of UTC rolls it back a day and can make a player
   * who is exactly 13 read as 12 (or vice versa), silently adding or
   * skipping the parental-consent step.
   */
  it("is stable regardless of the host timezone offset", () => {
    const dob = parseDateInputValue("2013-09-14")!;
    // The 13th birthday, to the day.
    expect(calculateAge(dob, utc(2026, 8, 14))).toBe(13);
    expect(requiresParentalConsent(dob, utc(2026, 8, 14))).toBe(false);
    // One day short of it.
    expect(calculateAge(dob, utc(2026, 8, 13))).toBe(12);
    expect(requiresParentalConsent(dob, utc(2026, 8, 13))).toBe(true);
  });
});

describe("parseDateInputValue / toDateInputValue", () => {
  it("parses a date input value to UTC midnight", () => {
    const parsed = parseDateInputValue("2013-09-14")!;
    expect(parsed.toISOString()).toBe("2013-09-14T00:00:00.000Z");
  });

  it("round-trips through toDateInputValue", () => {
    expect(toDateInputValue(parseDateInputValue("2008-01-05")!)).toBe(
      "2008-01-05",
    );
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseDateInputValue("")).toBeUndefined();
    expect(parseDateInputValue("2013-9-14")).toBeUndefined();
    expect(parseDateInputValue("not-a-date")).toBeUndefined();
    // Date.UTC would roll this into March rather than rejecting it.
    expect(parseDateInputValue("2025-02-31")).toBeUndefined();
  });
});
