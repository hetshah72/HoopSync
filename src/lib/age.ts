/**
 * Date-of-birth handling. Pure - safe on client and server.
 *
 * A date of birth is a *calendar date*, not an instant, but it travels
 * through `<input type="date">`, a Server Action boundary and BSON as a
 * `Date`. Every one of those steps preserves the instant, not the calendar
 * date, so the only way client and server agree is to fix a single
 * interpretation: **a DOB is always UTC midnight of that calendar day, and
 * is always read back with UTC getters.**
 *
 * That is what `<input type="date">.valueAsDate` already produces, so the
 * browser needs no conversion - but `calculateAge` previously read it with
 * *local* getters, which shifts the calendar day by one for anyone not on
 * UTC and could silently skip the under-13 consent step near a birthday
 * (audit ONB-13 / Bug AUTH-2). Mixing the two is the bug; the helpers below
 * exist so nothing has to mix them again.
 */

export const COPPA_AGE_THRESHOLD = 13;

/** `YYYY-MM-DD` (an `<input type="date">` value) -> that day at UTC midnight. */
export function parseDateInputValue(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  // Rejects impossible days (e.g. 2025-02-31, which Date.UTC would roll
  // forward into March) rather than silently accepting a different date.
  return date.getUTCMonth() === Number(month) - 1 ? date : undefined;
}

/** A DOB -> the `YYYY-MM-DD` an `<input type="date">` expects. */
export function toDateInputValue(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Age in whole years as of `asOf` (defaults to now).
 *
 * Both dates are read in UTC so the result is identical on the player's
 * phone and on the server, whatever timezone either sits in.
 */
export function calculateAge(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    asOf.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (asOf.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      asOf.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * The player's age *today*, not the age recorded when they onboarded.
 *
 * `age` is denormalised onto the profile at write time and was never
 * recomputed, so it silently went stale - a player who onboarded at 14 read
 * as 14 forever. Prefer the stored date of birth; fall back to the
 * denormalised value only for profiles written before a DOB was captured.
 *
 * Lives here, not in `profileService`, so the pure consumers of it (the
 * Coach prompt builder in particular) don't have to pull in the database
 * client to ask how old someone is.
 */
export function resolveProfileAge(
  profile: { age?: number; consent?: { dateOfBirth?: Date } } | null,
): number | undefined {
  if (!profile) return undefined;
  const dob = profile.consent?.dateOfBirth;
  return dob ? calculateAge(dob) : profile.age;
}

/** True when this DOB puts the player under the COPPA threshold. */
export function requiresParentalConsent(
  dateOfBirth: Date,
  asOf: Date = new Date(),
): boolean {
  return calculateAge(dateOfBirth, asOf) < COPPA_AGE_THRESHOLD;
}
