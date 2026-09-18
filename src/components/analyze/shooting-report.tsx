"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CourtDiagram,
  type ShotMarker,
} from "@/components/analyze/court-diagram";
import {
  ShotReplayDialog,
  type ReplayShot,
} from "@/components/analyze/shot-replay-dialog";
import {
  ShotMechanicsPanel,
  type MechanicsFindingView,
} from "@/components/analyze/shot-mechanics-panel";
import { ZoneBar } from "@/components/ui/zone-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SHOT_ZONES, ZONE_LABELS, fgPercent } from "@/lib/shot-zones";
import type { ShotZone } from "@/types/db";
import { shareShotSessionWithCoachAction } from "@/server/actions/shotSessionActions";

type Filter = "all" | "made" | "missed";

export interface ReportShot extends ReplayShot {
  xPct: number;
  yPct: number;
}

export interface RecommendedWorkoutSummary {
  id: string;
  label: string;
  drillCount: number;
  estimatedDurationMinutes: number;
}

export interface ShootingReportProps {
  sessionId: string;
  /** Absent when the session's media asset is gone - the chart and analysis
   *  still render; only replay is unavailable. */
  videoUrl?: string;
  totalAttempts: number;
  totalMakes: number;
  fgPercent: number;
  shots: ReportShot[];
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>;
  bestZone?: ShotZone;
  weakestZone?: ShotZone;
  /** Plain-language trend explanations computed at finalize (BRD 7.5). */
  trendCallouts?: string[];
  mechanicalBreakdown?: {
    targetZone: ShotZone;
    observation: string;
    makesVsMisses: string;
    potentialIssue: string;
    correction: string;
    drillName?: string;
  };
  /**
   * The nine-parameter form analysis (BRD 7.6), already resolved to flat
   * serializable rows by the page. Absent/empty on sessions finalized before
   * it existed - the panel says so rather than inventing them.
   */
  mechanicsFindings?: MechanicsFindingView[];
  recommendedWorkout?: RecommendedWorkoutSummary;
}

export function ShootingReport({
  sessionId,
  videoUrl,
  totalAttempts,
  totalMakes,
  fgPercent: overallFgPercent,
  shots,
  zoneBreakdown,
  bestZone,
  weakestZone,
  trendCallouts,
  mechanicalBreakdown,
  mechanicsFindings,
  recommendedWorkout,
}: ShootingReportProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedShot, setSelectedShot] = useState<ReportShot | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleShots = useMemo<ShotMarker[]>(
    () =>
      shots
        .filter(
          (s) => filter === "all" || (filter === "made" ? s.made : !s.made),
        )
        .map((s) => ({ id: s.id, xPct: s.xPct, yPct: s.yPct, made: s.made })),
    [shots, filter],
  );

  const zoneRows = SHOT_ZONES.map((zone) => {
    const stats = zoneBreakdown[zone];
    if (!stats || stats.attempts === 0) return null;
    return { zone, ...stats, pct: fgPercent(stats.makes, stats.attempts) };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  function handleShare() {
    startTransition(async () => {
      try {
        const { conversationId } =
          await shareShotSessionWithCoachAction(sessionId);
        toast.success("Shared with Coach.");
        router.push(`/coach/${conversationId}`);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't share with Coach right now.",
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        {/* Divided rather than four floating columns, and on design tokens so
            the makes/misses greens and reds match every other status colour in
            the app instead of being one-off Tailwind palette picks. */}
        <CardContent className="divide-border/60 grid grid-cols-2 gap-y-4 text-center sm:grid-cols-4 sm:divide-x">
          <div>
            <p className="tabular font-heading text-2xl leading-none font-bold tracking-tight">
              {totalAttempts}
            </p>
            <p className="text-muted-foreground mt-1.5 text-xs">Attempts</p>
          </div>
          <div>
            <p className="tabular font-heading text-success-soft-foreground text-2xl leading-none font-bold tracking-tight">
              {totalMakes}
            </p>
            <p className="text-muted-foreground mt-1.5 text-xs">Makes</p>
          </div>
          <div>
            <p className="tabular font-heading text-destructive text-2xl leading-none font-bold tracking-tight">
              {totalAttempts - totalMakes}
            </p>
            <p className="text-muted-foreground mt-1.5 text-xs">Misses</p>
          </div>
          <div>
            <p className="tabular font-heading text-brand-ink text-2xl leading-none font-bold tracking-tight">
              {overallFgPercent}%
            </p>
            <p className="text-muted-foreground mt-1.5 text-xs">FG%</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shot Chart</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(["all", "made", "missed"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f}
              </Button>
            ))}
          </div>
          <CourtDiagram
            shots={visibleShots}
            selectedShotId={selectedShot?.id}
            onShotClick={(id) => {
              const shot = shots.find((s) => s.id === id) ?? null;
              setSelectedShot(shot);
            }}
          />
          <p className="text-muted-foreground text-center text-xs">
            Tap any shot to replay it and see what happened.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {zoneRows.map((row) => (
            <ZoneBar
              key={row.zone}
              zone={row.zone}
              attempts={row.attempts}
              makes={row.makes}
              pct={row.pct}
            />
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {bestZone && zoneBreakdown[bestZone] && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-success-soft-foreground text-xs font-semibold">
                STRENGTH
              </p>
              <p className="font-medium">{ZONE_LABELS[bestZone]}</p>
              <p className="text-muted-foreground text-sm">
                {fgPercent(
                  zoneBreakdown[bestZone]!.makes,
                  zoneBreakdown[bestZone]!.attempts,
                )}
                %
              </p>
            </CardContent>
          </Card>
        )}
        {weakestZone && zoneBreakdown[weakestZone] && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-brand-ink text-xs font-semibold">NEEDS WORK</p>
              <p className="font-medium">{ZONE_LABELS[weakestZone]}</p>
              <p className="text-muted-foreground text-sm">
                {fgPercent(
                  zoneBreakdown[weakestZone]!.makes,
                  zoneBreakdown[weakestZone]!.attempts,
                )}
                %
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {trendCallouts && trendCallouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What This Means</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground space-y-2 text-sm">
              {trendCallouts.map((callout) => (
                <li key={callout} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">
                    -
                  </span>
                  <span>{callout}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Slot 6 of BRD v1.1 §6's fixed section order. The weakest-zone
          Breakdown that section mandates stays on the default tab - so it is
          visible without interaction, exactly as the acceptance test expects -
          and BRD 7.6's nine-parameter analysis sits beside it rather than
          displacing anything. */}
      {mechanicalBreakdown && (
        <Tabs defaultValue="breakdown" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="breakdown" className="flex-1">
              Breakdown
            </TabsTrigger>
            <TabsTrigger value="mechanics" className="flex-1">
              Mechanics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="breakdown">
            <Card className="border-brand/30 bg-brand-soft/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Mechanical Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">
                  {ZONE_LABELS[mechanicalBreakdown.targetZone]}
                </p>
                <p className="text-muted-foreground">
                  {mechanicalBreakdown.observation}
                </p>
                <div className="bg-muted/50 rounded-md p-3">
                  <p className="font-medium">Makes vs. misses</p>
                  <p className="text-muted-foreground">
                    {mechanicalBreakdown.makesVsMisses}
                  </p>
                </div>
                <div>
                  <Badge variant="outline" className="mb-1">
                    {mechanicalBreakdown.potentialIssue}
                  </Badge>
                  <p className="text-muted-foreground">
                    {mechanicalBreakdown.correction}
                  </p>
                </div>
                {mechanicalBreakdown.drillName && (
                  <p className="text-muted-foreground text-xs">
                    Drill: {mechanicalBreakdown.drillName}
                  </p>
                )}
                <p className="text-muted-foreground border-t pt-2 text-xs italic">
                  Simulated mechanical analysis. In production, a
                  pose-estimation model derives these observations
                  frame-by-frame from your uploaded video.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mechanics">
            <ShotMechanicsPanel findings={mechanicsFindings ?? []} />
          </TabsContent>
        </Tabs>
      )}

      {recommendedWorkout && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              Recommended Workout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="font-medium">{recommendedWorkout.label}</p>
              <p className="text-muted-foreground text-sm">
                ~{recommendedWorkout.estimatedDurationMinutes} min -{" "}
                {recommendedWorkout.drillCount} drill(s) - built from this
                session
              </p>
            </div>
            <Link
              href={`/train/${recommendedWorkout.id}`}
              className={buttonVariants({ className: "w-full" })}
            >
              Start Workout
            </Link>
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        className="w-full"
        disabled={isPending}
        onClick={handleShare}
      >
        <MessageCircle className="size-4" />
        {isPending ? "Sharing..." : "Share With Coach"}
      </Button>

      <ShotReplayDialog
        shot={selectedShot}
        sessionId={sessionId}
        videoUrl={videoUrl}
        onClose={() => setSelectedShot(null)}
      />
    </div>
  );
}
