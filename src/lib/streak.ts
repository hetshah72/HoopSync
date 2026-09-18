/**
 * Deterministic streak arithmetic - no AI/heuristics needed for this.
 * Pure and isomorphic so it's directly unit-testable without a database.
 */
export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate?: Date;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isNextDay(previous: Date, current: Date): boolean {
  const expected = new Date(previous);
  expected.setDate(expected.getDate() + 1);
  return isSameDay(expected, current);
}

/** Computes the new streak state after one activity event on `activityDate`. */
export function computeNextStreak(
  state: StreakState,
  activityDate: Date = new Date(),
): StreakState {
  if (!state.lastActivityDate) {
    return {
      currentStreak: 1,
      longestStreak: Math.max(1, state.longestStreak),
      lastActivityDate: activityDate,
    };
  }

  if (isSameDay(state.lastActivityDate, activityDate)) {
    // Second+ activity on the same day doesn't extend the streak twice.
    return { ...state, lastActivityDate: activityDate };
  }

  if (isNextDay(state.lastActivityDate, activityDate)) {
    const currentStreak = state.currentStreak + 1;
    return {
      currentStreak,
      longestStreak: Math.max(state.longestStreak, currentStreak),
      lastActivityDate: activityDate,
    };
  }

  // A day (or more) was missed - the streak restarts.
  return {
    currentStreak: 1,
    longestStreak: Math.max(1, state.longestStreak),
    lastActivityDate: activityDate,
  };
}

/**
 * What a stored streak actually means *right now*.
 *
 *   none          nothing logged yet, or the counter is already zero
 *   active_today  they've trained today; the streak is banked
 *   at_risk       yesterday was the last day - today is the last chance to keep it
 *   broken        two or more days have passed; `currentStreak` is stale
 *
 * This exists because `computeNextStreak` only ever runs *on activity*, so a
 * streak decays lazily: a player who broke a 7-day streak a fortnight ago still
 * has `currentStreak: 7` sitting in `userStats` until they next train. Anything
 * that reads the stored number and says it out loud - a notification above all -
 * is therefore lying unless it checks `lastActivityDate` against today first.
 */
export type StreakStatus = "none" | "active_today" | "at_risk" | "broken";

export function streakStatus(
  state: StreakState,
  now: Date = new Date(),
): StreakStatus {
  if (!state.lastActivityDate || state.currentStreak <= 0) return "none";
  if (isSameDay(state.lastActivityDate, now)) return "active_today";
  if (isNextDay(state.lastActivityDate, now)) return "at_risk";
  return "broken";
}

/**
 * The streak as it would be reported today - zero once it has lapsed.
 *
 * Use this anywhere the number is shown to the player, rather than reading
 * `currentStreak` directly.
 */
export function effectiveStreak(
  state: StreakState,
  now: Date = new Date(),
): number {
  return streakStatus(state, now) === "broken" ? 0 : state.currentStreak;
}
