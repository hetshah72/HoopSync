import Link from "next/link";
import { Brain, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FEELING_LABELS } from "@/lib/confidence-routines";
import type { ConfidenceFeeling } from "@/types/db";

export interface MentalGameEntry {
  id: string;
  type: "pre_game" | "post_game";
  feeling?: ConfidenceFeeling;
  date: string;
}

/**
 * Recent mental-game check-ins on Progress (BRD 7.10).
 *
 * The pre-game card records a check-in so the rest of the app can see it;
 * Coach reads it through the prompt, and this is where the player sees it.
 * Without this the record existed but was invisible - written and never read.
 *
 * Deliberately a plain list of what happened, with no trend line or score
 * over it. Four feelings sampled once a game-day is not a mood graph, and
 * drawing one would be the same overstatement `skill-metrics` refuses when
 * it declines to synthesize a 0-100 rating.
 */
export function MentalGameHistory({ entries }: { entries: MentalGameEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain aria-hidden className="size-4" />
          Mental game
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border/60 text-sm">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0 flex-1 truncate">
                {entry.type === "pre_game"
                  ? `Before a game${entry.feeling ? ` - ${FEELING_LABELS[entry.feeling]}` : ""}`
                  : "Recovery plan"}
              </span>
              <Badge variant="secondary">{entry.date}</Badge>
            </li>
          ))}
        </ul>

        <Link
          href="/confidence"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline"
        >
          Open Confidence
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
