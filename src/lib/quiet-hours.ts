/**
 * Quiet-hours arithmetic for notifications (BRD 7.15).
 *
 * Pure and isomorphic: the profile form uses it to preview the window and the
 * notification service uses it to decide whether to raise a time-triggered
 * nudge, so both agree on what "10pm to 7am" means.
 *
 * Every other date helper in this app works in the *server's* local calendar
 * day (see src/lib/day-stamp.ts), which is right for streaks - a streak is a
 * count of days, and the app has one clock. Quiet hours is the one place that
 * reasoning breaks down: the whole point is "don't nudge me while I'm asleep",
 * and the player's night is not the server's night. So this module takes an
 * IANA zone and resolves the hour through `Intl`, which ships with the runtime
 * and needs no date library.
 */

export interface QuietHours {
  /** 0-23, inclusive. */
  startHour: number;
  /** 0-23, exclusive. */
  endHour: number;
}

/**
 * The hour (0-23) it is for someone in `timeZone`.
 *
 * Falls back to the server's local hour when no zone is known or the zone
 * string is one `Intl` rejects - a profile saved before the timezone field
 * existed, or a hand-edited document. Quiet hours quietly meaning the wrong
 * night is a far better failure than a thrown error on the Home render path.
 */
export function hourInZone(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours();
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    })
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value;
    if (hour === undefined) return date.getHours();
    // `hour12: false` still renders midnight as "24" in some ICU versions.
    return Number(hour) % 24;
  } catch {
    return date.getHours();
  }
}

/** True when `hour` falls inside a window that may wrap past midnight. */
export function isHourWithin(hour: number, window: QuietHours): boolean {
  const { startHour, endHour } = window;
  // An empty window is how "no quiet hours" is expressed, so it must never
  // swallow the whole day.
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/**
 * Whether time-triggered notifications should be held back right now.
 *
 * Note what this does and doesn't buy in an in-app-only notification centre:
 * the player is, by definition, looking at the app when a time-triggered
 * notification gets evaluated, so this cannot stop them seeing one. What it
 * does is stop a nudge being *raised and timestamped* at 2am because they were
 * logging shots late - and it is the check a future push provider will run
 * before it ever sends anything out of the app.
 */
export function isWithinQuietHours(
  now: Date,
  preferences?: { quietHours?: QuietHours; timeZone?: string },
): boolean {
  const window = preferences?.quietHours;
  if (!window) return false;
  return isHourWithin(hourInZone(now, preferences.timeZone), window);
}

/** `22` -> `"10 PM"`. For the preferences form and its summary line. */
export function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized < 12 ? "AM" : "PM";
  const twelve = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelve} ${suffix}`;
}
