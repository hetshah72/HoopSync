import { ArrowDown, ArrowRight, ArrowUp, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { MIN_ATTEMPTS_FOR_CALLOUT, type ZoneSignal } from "@/lib/shot-zones";
import type { SkillCategory } from "@/types/db";

/**
 * BRD 7.11's "Improvements and remaining weaknesses".
 *
 * Everything here is derived from records the player created; nothing is
 * generated, so nothing carries a "simulated" label. That is a deliberate
 * choice rather than a limitation - BRD v1.1 §6.5 requires strength and
 * needs-work call-outs to come from "actual zone performance (not randomly
 * selected)", and the same honesty bar that keeps `skillMetrics` a volume
 * count rather than a 0-100 rating applies here.
 *
 * The three claims, in descending order of how much evidence they need:
 *
 * - Zone strength/weakness, pooled across recent sessions and suppressed
 *   below MIN_ATTEMPTS_FOR_CALLOUT. `resolveStandingZoneSignals` hands back
 *   null rather than a guess, and null renders as "not enough yet" - which is
 *   a more useful thing to tell a player than a weakness invented from two
 *   missed shots.
 * - Week-over-week training volume. Two counts, stated plainly.
 * - Least-trained declared focus area. Real, and directly actionable.
 *
 * Game film findings are deliberately absent: those documents carry
 * `isSimulated: true`, and this section makes only measured claims.
 */
export function StrengthsAndWeaknesses({
  strength,
  weakness,
  sessionsInSample,
  totalAttemptsInSample,
  workoutsThisWeek,
  workoutsLastWeek,
  leastTrainedFocus,
}: {
  strength: ZoneSignal | null;
  weakness: ZoneSignal | null;
  sessionsInSample: number;
  totalAttemptsInSample: number;
  workoutsThisWeek: number;
  workoutsLastWeek: number;
  leastTrainedFocus: { skill: SkillCategory; drillsCompleted: number } | null;
}) {
  const delta = workoutsThisWeek - workoutsLastWeek;

  const trendLine =
    workoutsThisWeek === 0
      ? "You haven't finished a workout in the last 7 days."
      : `${workoutsThisWeek} ${workoutsThisWeek === 1 ? "workout" : "workouts"} in the last 7 days` +
        (delta > 0
          ? `, ${delta} more than the week before.`
          : delta < 0
            ? `, ${Math.abs(delta)} fewer than the week before.`
            : ", the same as the week before.");

  const TrendIcon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : ArrowRight;
  const trendTone =
    delta > 0
      ? "text-success"
      : delta < 0
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle>What&apos;s working, what isn&apos;t</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {strength || weakness ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {strength && (
              <Callout
                eyebrow="Strength"
                tone="success"
                zone={strength}
                sessionsInSample={sessionsInSample}
              />
            )}
            {weakness && (
              <Callout
                eyebrow="Needs work"
                tone="destructive"
                zone={weakness}
                sessionsInSample={sessionsInSample}
              />
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {totalAttemptsInSample === 0
                ? "Log a shooting session in Analyze and your strongest and weakest spots will show up here."
                : `Not enough shots from any one spot yet - it takes ${MIN_ATTEMPTS_FOR_CALLOUT} attempts from a zone before calling it a strength or a weakness means anything.`}
            </span>
          </p>
        )}

        <div className="space-y-2.5 border-t border-border/60 pt-3.5">
          <p className="flex items-start gap-2 text-sm">
            <TrendIcon aria-hidden className={`mt-0.5 size-4 shrink-0 ${trendTone}`} />
            <span>{trendLine}</span>
          </p>

          {leastTrainedFocus && (
            <p className="text-sm text-muted-foreground">
              Least-trained focus area:{" "}
              <span className="font-medium text-foreground">
                {SKILL_LABELS[leastTrainedFocus.skill]}
              </span>{" "}
              ({leastTrainedFocus.drillsCompleted}{" "}
              {leastTrainedFocus.drillsCompleted === 1 ? "drill" : "drills"} so
              far).
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Callout({
  eyebrow,
  tone,
  zone,
  sessionsInSample,
}: {
  eyebrow: string;
  tone: "success" | "destructive";
  zone: ZoneSignal;
  sessionsInSample: number;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
      <p
        className={`text-[0.7rem] font-semibold tracking-wide uppercase ${
          tone === "success" ? "text-success" : "text-destructive"
        }`}
      >
        {eyebrow}
      </p>
      <p className="mt-1 font-heading text-base font-semibold tracking-tight">
        {zone.label}
      </p>
      <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
        {zone.makes}/{zone.attempts} - {zone.fgPercent}%
      </p>
      {/* The sample is part of the claim, not a footnote: "22% from the left
          corner" means something different over 9 shots than over 90. */}
      <p className="mt-1.5 text-xs text-muted-foreground">
        across your last{" "}
        {sessionsInSample === 1 ? "session" : `${sessionsInSample} sessions`}
      </p>
    </div>
  );
}
