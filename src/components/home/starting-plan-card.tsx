import Link from "next/link";
import type { WorkoutDoc } from "@/types/db";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Home's starting plan - the visible payoff for finishing onboarding.
 *
 * BRD 7.1 requires onboarding to "generate an initial personalized
 * recommendation / starting plan" and for that data to "visibly drive at
 * least one Home-screen recommendation immediately afterward". Ranking the
 * static feed by focus-area tag overlap didn't satisfy that: it re-sorts an
 * existing list, and for a player whose only focus area is one no seeded
 * card carries (defense), it changes nothing at all.
 *
 * Shown only while the plan is still pending. Once the player starts it,
 * it lives in Train like any other workout and Home goes back to the daily
 * recommendation - so this can never become a stale card pointing at work
 * already done.
 */
export function StartingPlanCard({ workout }: { workout: WorkoutDoc }) {
  const focus = workout.skillCategory
    ? SKILL_LABELS[workout.skillCategory]
    : undefined;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle>Your starting plan</CardTitle>
        <p className="text-sm text-muted-foreground">
          Built from the answers you just gave us.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {focus && <Badge variant="secondary">{focus}</Badge>}
          <Badge variant="outline">{workout.drills.length} drills</Badge>
          <Badge variant="outline">
            ~{workout.estimatedDurationMinutes} min
          </Badge>
        </div>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {workout.drills.map((drill) => (
            <li key={drill.order}>{drill.name}</li>
          ))}
        </ul>
        {workout.coverageNote && (
          <p className="text-xs text-muted-foreground">{workout.coverageNote}</p>
        )}
        <Link
          href={`/train/${workout._id.toString()}`}
          className={buttonVariants({ className: "w-full" })}
        >
          Start your first workout
        </Link>
      </CardContent>
    </Card>
  );
}
