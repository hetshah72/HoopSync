import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single measured number, presented as a number first and a label second.
 *
 * Display face, tight tracking and tabular figures - the figure is the point
 * of the tile, so it gets the largest type on the screen and never reflows as
 * it changes.
 *
 * Structural note: the value and the label must stay direct siblings under one
 * parent. `tests/e2e/founder-loop.spec.ts` finds a stat by locating the label
 * <p> and asserting against its parent, so splitting them breaks Progress
 * coverage.
 */
export function StatTile({
  value,
  label,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  value: React.ReactNode;
  label: string;
  icon?: LucideIcon;
  tone?: "neutral" | "brand" | "success";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm",
        className,
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className={cn(
            "mb-2.5 inline-flex size-8 items-center justify-center rounded-xl",
            tone === "brand" && "bg-brand-soft text-brand-soft-foreground",
            tone === "success" && "bg-success-soft text-success-soft-foreground",
            tone === "neutral" && "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
      )}
      <div>
        <p
          data-slot="stat-value"
          className={cn(
            "font-heading text-[1.75rem] leading-none font-bold tracking-tight",
            tone === "brand" && "text-brand-ink",
            tone === "success" && "text-success-soft-foreground",
          )}
        >
          {value}
        </p>
        <p className="mt-1.5 text-xs leading-tight font-medium text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}
