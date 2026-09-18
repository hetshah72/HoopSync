import { cn } from "@/lib/utils";
import { ZONE_LABELS } from "@/lib/shot-zones";
import type { ShotZone } from "@/types/db";

/**
 * Zone-percentage bar, on the shared status tokens rather than raw palette
 * values, so "good/middling/poor" reads the same here as it does elsewhere.
 */
export function barColor(pct: number): string {
  if (pct >= 55) return "bg-success";
  if (pct >= 35) return "bg-warning";
  return "bg-destructive";
}

/**
 * One zone's real shooting line: label, makes/attempts, percentage, and a bar
 * scaled to that percentage.
 *
 * Shared by the Shooting Report (one session) and Progress (pooled across
 * recent sessions) so the same percentage never renders two different ways.
 * The makes/attempts count sits next to the percentage on purpose - a bar
 * alone hides whether 100% means 8-for-8 or 1-for-1.
 */
export function ZoneBar({
  zone,
  attempts,
  makes,
  pct,
}: {
  zone: ShotZone;
  attempts: number;
  makes: number;
  pct: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{ZONE_LABELS[zone]}</span>
        <span className="text-muted-foreground tabular-nums">
          {makes}/{attempts} - {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", barColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
