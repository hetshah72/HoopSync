/**
 * Calendar-day helpers for everything that has to change "once per day".
 *
 * The feed's core promise (BRD 7.2) is that content *changes daily* and that
 * today's recommended workout is generated once per day - both of which need
 * one agreed answer to "what day is it?". Before this module there were two
 * private, disagreeing copies: `todayDateStamp()` in feedRepository and
 * `toDateStamp()` in scripts/db/seed.ts, both using
 * `toISOString().slice(0, 10)` (UTC). UTC rolls the day over at 7-8pm US
 * local time, so a player training in the evening would see "tomorrow's"
 * feed - and would get a different answer than `computeNextStreak`, which
 * has always used the local calendar day.
 *
 * This module standardises on the **local calendar day**, matching the
 * streak arithmetic in src/lib/streak.ts.
 *
 * Pure and isomorphic so the app, the seed script and tests all agree.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local calendar day as `YYYY-MM-DD`. */
export function toDayStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's stamp. `now` is injectable so tests never depend on the clock. */
export function todayStamp(now: Date = new Date()): string {
  return toDayStamp(now);
}

/** Local midnight at the start of the given stamp. */
export function dayStampToDate(stamp: string): Date {
  const [year, month, day] = stamp.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * A stable integer that increments by exactly one per calendar day.
 *
 * Computed through `Date.UTC` from the stamp's own year/month/day rather
 * than from a local timestamp, so a daylight-saving transition can't make
 * two consecutive days share an index (or skip one).
 */
export function dayIndex(stamp: string): number {
  const [year, month, day] = stamp.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetweenStamps(from: string, to: string): number {
  return dayIndex(to) - dayIndex(from);
}

/** `daysBetweenStamps` against a Date, for "days since your last session". */
export function daysSince(date: Date, now: Date = new Date()): number {
  return daysBetweenStamps(toDayStamp(date), toDayStamp(now));
}

/** `addDays(stamp, -1)` -> yesterday. Used for week-over-week windows. */
export function addDays(stamp: string, days: number): string {
  const date = dayStampToDate(stamp);
  date.setDate(date.getDate() + days);
  return toDayStamp(date);
}
