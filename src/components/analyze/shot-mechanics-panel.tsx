"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The nine-parameter shooting-form analysis (BRD 7.6), set against an authored
 * reference standard per parameter.
 *
 * Props are flat and already resolved - drill names looked up, labels applied -
 * because the template bank and the standards library are server-side content
 * and there's no reason to ship either to the browser. Same arrangement the
 * Mechanical Breakdown card already uses for `drillName`.
 *
 * The honesty rule this component exists to hold: `basis` is per row, not per
 * page. A left-vs-right finding computed from the player's own tap-logged
 * shots is badged differently from a generated one, because they are different
 * kinds of claim and a single page-level disclaimer would flatten them into
 * one.
 */
export interface MechanicsFindingView {
  parameter: string;
  parameterLabel: string;
  observation: string;
  potentialIssue: string;
  correction: string;
  drillName?: string;
  basis: "measured" | "simulated";
  referenceStandard: string;
  referenceShotTypeLabel: string;
}

function BasisBadge({ basis }: { basis: MechanicsFindingView["basis"] }) {
  if (basis === "measured") {
    return (
      <Badge variant="success" className="shrink-0">
        From your logged shots
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      Simulated form analysis
    </Badge>
  );
}

function Finding({ finding }: { finding: MechanicsFindingView }) {
  return (
    <div className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading text-sm font-semibold tracking-tight">
          {finding.parameterLabel}
        </p>
        <BasisBadge basis={finding.basis} />
      </div>

      {/* Stacks on a phone, sits side by side from sm up. This pairing *is*
          the "compare against reference" requirement - the player's own
          numbers beside the standard they're being measured against. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-muted/50 rounded-md p-3">
          <p className="text-muted-foreground text-xs font-medium">
            Your session
          </p>
          <p className="mt-1 text-sm text-pretty">{finding.observation}</p>
        </div>
        <div className="rounded-md border border-dashed p-3">
          <p className="text-muted-foreground text-xs font-medium">
            Reference standard - {finding.referenceShotTypeLabel}
          </p>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {finding.referenceStandard}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Badge variant="outline">{finding.potentialIssue}</Badge>
        <p className="text-muted-foreground text-sm text-pretty">
          {finding.correction}
        </p>
        {finding.drillName && (
          <p className="text-muted-foreground text-xs">
            Drill: {finding.drillName}
          </p>
        )}
      </div>
    </div>
  );
}

export function ShotMechanicsPanel({
  findings,
  className,
}: {
  findings: MechanicsFindingView[];
  className?: string;
}) {
  // Sessions finalized before 7.6 existed carry no findings. Saying so is the
  // honest option - back-filling nine parameters for a video nobody re-examined
  // would be inventing analysis after the fact.
  if (findings.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="space-y-2 pt-6">
          <p className="font-heading text-sm font-semibold tracking-tight">
            No form analysis for this session
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            This session was analyzed before the nine-parameter form breakdown
            existed, so there is nothing to show here. Record a new session and
            it will include one.
          </p>
        </CardContent>
      </Card>
    );
  }

  const measuredCount = findings.filter((f) => f.basis === "measured").length;

  return (
    <Card className={cn("border-brand/30 bg-brand-soft/30", className)}>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <p className="font-heading text-sm font-semibold tracking-tight">
            Shooting Mechanics
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            Nine form parameters, each set against a coaching standard for the
            shot type you logged.
          </p>
        </div>

        <div className="space-y-4">
          {findings.map((finding) => (
            <Finding key={finding.parameter} finding={finding} />
          ))}
        </div>

        {/* The same disclosure discipline as the Mechanical Breakdown card,
            with the split spelled out rather than blanketing every row. */}
        <p className="text-muted-foreground border-t pt-3 text-xs leading-relaxed text-pretty italic">
          {measuredCount > 0
            ? `${measuredCount} of these ${findings.length} findings are computed from the shots you tapped in, and are badged as such. `
            : ""}
          Everything badged &ldquo;Simulated form analysis&rdquo; is coaching
          inference, not something seen in your video - no pose-estimation model
          runs here yet. The likely-issue and correction lines are generated on
          every parameter, including the measured ones. Reference standards are
          written coaching benchmarks, not footage of any player.
        </p>
      </CardContent>
    </Card>
  );
}
