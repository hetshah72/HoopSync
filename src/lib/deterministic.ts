/**
 * Deterministic pseudo-variety.
 *
 * Several features need to look varied without being random: the same input
 * must always produce the same output (so a page reload never silently
 * rewrites what the player already read), while different inputs spread
 * evenly across the available options. Feed rotation keys off
 * `userId:dayStamp`; the shot mechanical breakdown keys off `sessionId:zone`.
 *
 * Pure and isomorphic - no crypto, no Math.random, safe in scripts, tests,
 * Server Components and Client Components alike.
 */

/**
 * FNV-1a with a murmur3 finalizer, kept unsigned so it's safe to modulo.
 *
 * The finalizer is the part that matters. A plain `hash * 31 + charCode` walk
 * leaves the result dominated by the shared prefix: for keys like
 * `day-7:a` / `day-7:b` the hashes end up differing by the trailing
 * character's code, so sorting by hash just reproduces alphabetical order of
 * the ids, identically for every day. Avalanching the result means one
 * different character changes the whole value, which is what makes a
 * key-derived ordering actually reorder.
 */
export function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Picks one element, stably, for a given key. Returns undefined if empty. */
export function pickDeterministic<T>(items: readonly T[], key: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[hashKey(key) % items.length];
}

/**
 * A stable reordering of `items` for a given key.
 *
 * Not a true shuffle: it rotates the list by a key-derived offset, then
 * orders each item by its own per-key hash. That gives a different-looking
 * order every day while keeping the operation cheap, total, and repeatable -
 * and, unlike a sort with a random comparator, it never drops or duplicates
 * an item.
 */
export function orderDeterministically<T>(
  items: readonly T[],
  key: string,
  identify: (item: T) => string,
): T[] {
  return [...items]
    .map((item) => ({ item, rank: hashKey(`${key}:${identify(item)}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}
