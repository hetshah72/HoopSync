/**
 * Clips reads through `getPersonalizedFeed`, so it is a second entry point
 * into the day's card generation - the same Mongo write, optional copy-writer
 * call and notification evaluation that earns Home the repo's other
 * `loading.tsx`. A player who opens Clips as their first screen of the day
 * pays that cost, and a full-bleed black screen with no feedback reads as a
 * broken page rather than a loading one.
 *
 * Deliberately full-bleed rather than a card skeleton: this route replaces the
 * whole viewport, so a skeleton shaped like the list would flash the wrong
 * layout before the reel takes over.
 */
export default function ClipsLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-3">
        <div
          className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
          aria-hidden
        />
        <p className="text-sm text-white/70">Loading clips…</p>
      </div>
    </div>
  );
}
