import { cn } from "cn";

/**
 * The HoopSync mark: a ball drawn as four seams inside a ring.
 *
 * Inline SVG rather than an image file so it inherits `currentColor` and
 * stays crisp at any size - the auth screens use it at 20px in the wordmark
 * and at 400px as the brand panel's backdrop.
 *
 * Lives under `brand/` rather than `auth/` because the app shell wears it too.
 */
export function HoopSyncMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
      className={cn("size-5", className)}
    >
      <circle cx="16" cy="16" r="13" />
      {/* The two long seams, bowing away from the centre line. */}
      <path d="M16 3v26" />
      <path d="M3 16h26" />
      <path d="M6.5 6.5c4 4 5.5 8.4 5.5 9.5s-1.5 5.5-5.5 9.5" />
      <path d="M25.5 6.5c-4 4-5.5 8.4-5.5 9.5s1.5 5.5 5.5 9.5" />
    </svg>
  );
}

/**
 * The mark set in an ember tile - the lockup used in the app header, where the
 * wordmark needs to hold its own against page content scrolling underneath it.
 */
export function HoopSyncBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-brand to-brand-strong text-brand-foreground shadow-sm ring-1 ring-brand/25",
        className,
      )}
    >
      <HoopSyncMark className="size-[1.15rem]" />
    </span>
  );
}

/** Mark + name, the lockup used at the top of both auth screens. */
export function HoopSyncWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <HoopSyncMark className="size-5 text-brand" />
      <span className="font-heading text-[0.95rem] font-semibold tracking-tight">
        HoopSync
      </span>
    </span>
  );
}
