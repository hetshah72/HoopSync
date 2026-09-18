/**
 * The player's training history (BRD 7.11 "Session history"), as one
 * chronological list rather than a separate card per activity type.
 *
 * Every entry stands for something the player actually did - a workout they
 * completed, a session they tap-logged, a film they uploaded and reviewed.
 * Nothing here is derived or inferred, so a row can always be traced back to
 * the record it came from via `href`.
 *
 * Pure and isomorphic: the merge is ordinary sorting, and keeping it out of
 * the service makes it testable without a database.
 */

export type ActivityKind = "workout" | "shot_session" | "game_film";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  occurredAt: Date;
  /** What the player sees first - e.g. the workout's own label. */
  label: string;
  /** The real numbers behind it, e.g. "14/20 - 70%". Omitted when unknown. */
  detail?: string;
  /** Back to the artifact this row describes. */
  href: string;
}

/**
 * Merges the three activity streams newest-first and truncates to `limit`.
 *
 * Ties break on `id` so the order is stable: two activities finished in the
 * same second must not swap places between renders.
 */
export function mergeActivityHistory(
  entries: ActivityEntry[],
  limit: number,
): ActivityEntry[] {
  return [...entries]
    .sort(
      (a, b) =>
        b.occurredAt.getTime() - a.occurredAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit));
}
