import Link from "next/link";
import { CheckCircle2, Crosshair, Film } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeDay } from "@/lib/format";
import type { ActivityEntry, ActivityKind } from "@/lib/activity-history";

/**
 * BRD 7.11's "Session history": one chronological record of what the player
 * actually did, rather than a separate card per activity type.
 *
 * Game film reviews appear alongside workouts and shooting sessions because
 * uploading and reviewing film is real training activity - it is already what
 * keeps a streak alive. Only the activity is listed; the analysis attached to
 * it carries `isSimulated: true` and stays on its own report behind the link.
 */
const KIND_ICON: Record<ActivityKind, typeof CheckCircle2> = {
  workout: CheckCircle2,
  shot_session: Crosshair,
  game_film: Film,
};

const KIND_TONE: Record<ActivityKind, string> = {
  workout: "text-success",
  shot_session: "text-brand-ink",
  game_film: "text-muted-foreground",
};

export function ActivityHistory({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session history</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60 text-sm">
          {entries.map((entry) => {
            const Icon = KIND_ICON[entry.kind];
            return (
              <li key={`${entry.kind}:${entry.id}`}>
                <Link
                  href={entry.href}
                  className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <Icon
                    aria-hidden
                    className={`size-4 shrink-0 ${KIND_TONE[entry.kind]}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.detail && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {entry.detail}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeDay(new Date(entry.occurredAt))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
