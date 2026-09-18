/** 78 -> `6'6"`. Returns an em dash when the height isn't known yet. */
export function formatHeight(heightInches?: number): string {
  if (!heightInches) return "—";
  const feet = Math.floor(heightInches / 12);
  const inches = heightInches % 12;
  return `${feet}'${inches}"`;
}

/**
 * "today" / "3 days ago" / "2 weeks ago" - how Progress describes when
 * something happened.
 *
 * Relative rather than an absolute date because the question a player asks of
 * their own history is "how long has it been", not "what was the date". `now`
 * is injectable so callers (and tests) control the clock.
 */
export function relativeDay(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.floor(days / 7)} weeks ago`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
