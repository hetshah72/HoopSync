import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The fault counterpart to EmptyState.
 *
 * Same anatomy - framed icon, headline, explanation, the action that resolves
 * it - so a screen that broke reads as the same product as a screen that is
 * merely empty. Two deliberate differences: the frame is solid rather than
 * dashed (a dashed outline invites, and there is nothing to add here), and the
 * icon tile carries the destructive tint instead of the ember one. The body
 * copy stays `text-muted-foreground` - red type is reserved for form
 * validation, and a paragraph of it makes a transient blip look like data loss.
 *
 * No "use client" and no hooks, on purpose. `not-found.tsx` renders this on the
 * server, `error.tsx` renders it in the client bundle, and `global-error.tsx`
 * renders it with no root layout at all - so its only dependencies are an icon
 * and `cn`. Anything interactive is passed in as `actions` by whichever caller
 * can own it.
 */
export function ErrorState({
  icon: Icon,
  title,
  description,
  actions,
  digest,
  headingLevel = 1,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  /** Recovery actions. Put the one that usually works first. */
  actions?: React.ReactNode;
  /** Next's hash for the matching server log line. Shown only when present. */
  digest?: string;
  /** `1` when this replaces the page, `2` when it sits inside one. */
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div
      className={cn(
        "border-border bg-card/60 flex flex-col items-center rounded-2xl border px-6 py-10 text-center",
        className,
      )}
    >
      {/* Decorative: the headline carries the meaning, so the tile is hidden
          from assistive tech rather than labelled - same call as EmptyState. */}
      <span
        aria-hidden
        className="bg-destructive/10 text-destructive ring-destructive/15 mb-4 inline-flex size-12 items-center justify-center rounded-2xl ring-1"
      >
        <Icon className="size-5" />
      </span>
      {/* `font-heading tracking-tight` comes from the base layer in
          globals.css for every h1/h2/h3, so it isn't repeated here. */}
      <Heading className="text-lg font-semibold text-balance">{title}</Heading>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm leading-relaxed text-pretty">
        {description}
      </p>
      {actions && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
      {/* The one thing that makes a support conversation possible: the hash
          Next also wrote beside the real stack trace in the server log. */}
      {digest && (
        <p className="text-muted-foreground/70 mt-6 font-mono text-[0.7rem]">
          Reference: {digest}
        </p>
      )}
    </div>
  );
}
