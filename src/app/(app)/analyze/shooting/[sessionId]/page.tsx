import { ObjectId } from "mongodb";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VideoOff } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getSessionForUser } from "@/server/services/shotSessionService";
import { findMediaAssetById } from "@/server/repositories/mediaAssetRepository";
import {
  findDrillById,
  findDrillsByIds,
  findDrillsBySlugs,
} from "@/server/repositories/drillRepository";
import { findWorkoutByIdForUser } from "@/server/repositories/workoutRepository";
import { PARAMETER_LABELS, SHOT_TYPE_LABELS } from "@/lib/shot-mechanics";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/layout/error-state";
import { buttonVariants } from "@/components/ui/button";
import { ShotLogger } from "@/components/analyze/shot-logger";
import { ShootingReport } from "@/components/analyze/shooting-report";

export default async function ShootingSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(sessionId)) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    notFound();
  }
  const userId = new ObjectId(session.user.id);

  const shotSession = await getSessionForUser(userId, new ObjectId(sessionId));
  if (!shotSession) {
    notFound();
  }

  const video = await findMediaAssetById(shotSession.videoAssetId);
  // An empty string here would render <video src=""> - a silently broken
  // player. Passing undefined lets the report and logger say the footage is
  // gone instead, while still showing the chart and analysis, which don't
  // need the video.
  const videoUrl = video?.url || undefined;

  // "Session and date" is a listed Shot Chart parameter (BRD 7.5), and
  // without this the report renders with no indication of which session
  // is even on screen.
  const header = (
    <PageHeader
      back={{ href: "/analyze", label: "Back to Analyze" }}
      eyebrow="Shooting Session"
      title={shotSession.recordedAt.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
    />
  );

  // A session can only reach "failed" if processing broke; falling through to
  // the report would render a chart of zeros as though it were a real result.
  if (shotSession.status === "failed") {
    return (
      <div>
        {header}
        <ErrorState
          icon={VideoOff}
          headingLevel={2}
          title="This session couldn't be processed"
          description="The footage didn't finish uploading, so there's nothing to log against. Start a new session and record or upload the clip again."
          actions={
            <Link
              href="/analyze/shooting/new"
              className={buttonVariants({ size: "sm" })}
            >
              Start a new session
            </Link>
          }
        />
      </div>
    );
  }

  if (shotSession.status === "processing") {
    // Tap-to-log reads each shot's moment off the playing video, so without
    // footage there is nothing to log against - the same dead end as a failed
    // session. A *finished* session still has its chart and analysis, which
    // is why only this branch bails.
    if (!videoUrl) {
      return (
        <div>
          {header}
          <ErrorState
            icon={VideoOff}
            headingLevel={2}
            title="This session's footage is missing"
            description="The clip for this session is no longer available, so there's no video to log shots against. Start a new session to record or upload another."
            actions={
              <Link
                href="/analyze/shooting/new"
                className={buttonVariants({ size: "sm" })}
              >
                Start a new session
              </Link>
            }
          />
        </div>
      );
    }

    return (
      <div>
        {header}
        <ShotLogger
          sessionId={shotSession._id.toString()}
          videoUrl={videoUrl}
          initialShots={shotSession.shots.map((s) => ({
            id: s.id,
            zone: s.zone,
            location: s.location,
            made: s.made,
            timestampInVideoSeconds: s.timestampInVideoSeconds,
          }))}
        />
      </div>
    );
  }

  const recommendedWorkout = shotSession.recommendedWorkoutId
    ? await findWorkoutByIdForUser(userId, shotSession.recommendedWorkoutId)
    : null;
  const mechanicalDrill = shotSession.mechanicalBreakdown?.drillId
    ? await findDrillById(shotSession.mechanicalBreakdown.drillId)
    : null;

  // Flatten the nine-parameter findings into serializable rows: ObjectIds
  // never cross into a Client Component, and the template/standards libraries
  // stay server-side rather than shipping to the browser. One batch query for
  // the drill names, not nine.
  const findings = shotSession.mechanicalBreakdown?.findings ?? [];
  const findingDrills = await findDrillsByIds(
    findings.flatMap((finding) => (finding.drillId ? [finding.drillId] : [])),
  );
  const drillNameById = new Map(
    findingDrills.map((drill) => [drill._id.toString(), drill.name]),
  );

  // Per-shot feedback names its own drill by slug. One batch lookup for the
  // whole session - a session can hold a hundred shots, and they draw from a
  // handful of distinct drills.
  const shotDrillSlugs = [
    ...new Set(
      shotSession.shots.flatMap((s) =>
        s.feedback ? [s.feedback.drillSlug] : [],
      ),
    ),
  ];
  const shotDrills = await findDrillsBySlugs(shotDrillSlugs);
  const shotDrillNameBySlug = new Map(
    [...shotDrills.entries()].map(([slug, drill]) => [slug, drill.name]),
  );
  const mechanicsFindings = findings.map((finding) => ({
    parameter: finding.parameter,
    parameterLabel: PARAMETER_LABELS[finding.parameter],
    observation: finding.observation,
    potentialIssue: finding.potentialIssue,
    correction: finding.correction,
    drillName: finding.drillId
      ? drillNameById.get(finding.drillId.toString())
      : undefined,
    basis: finding.basis,
    referenceStandard: finding.referenceStandard,
    referenceShotTypeLabel:
      finding.referenceShotType === "general"
        ? "general"
        : SHOT_TYPE_LABELS[finding.referenceShotType],
  }));

  return (
    <div>
      {header}
      <ShootingReport
        sessionId={shotSession._id.toString()}
        videoUrl={videoUrl}
        totalAttempts={shotSession.totalAttempts}
        totalMakes={shotSession.totalMakes}
        fgPercent={shotSession.fgPercent}
        shots={shotSession.shots.map((s) => ({
          id: s.id,
          zone: s.zone,
          made: s.made,
          timestampInVideoSeconds: s.timestampInVideoSeconds,
          replayStartSeconds: s.replayStartSeconds,
          replayEndSeconds: s.replayEndSeconds,
          feedbackText: s.feedbackText,
          feedback: s.feedback
            ? {
                observation: s.feedback.observation,
                potentialIssue: s.feedback.potentialIssue,
                correction: s.feedback.correction,
                drillName: shotDrillNameBySlug.get(s.feedback.drillSlug),
              }
            : undefined,
          xPct: s.location.xPct,
          yPct: s.location.yPct,
        }))}
        zoneBreakdown={shotSession.zoneBreakdown}
        bestZone={shotSession.bestZone}
        weakestZone={shotSession.weakestZone}
        trendCallouts={shotSession.trendCallouts}
        mechanicalBreakdown={
          shotSession.mechanicalBreakdown
            ? {
                targetZone: shotSession.mechanicalBreakdown.targetZone,
                observation: shotSession.mechanicalBreakdown.observation,
                makesVsMisses: shotSession.mechanicalBreakdown.makesVsMisses,
                potentialIssue: shotSession.mechanicalBreakdown.potentialIssue,
                correction: shotSession.mechanicalBreakdown.correction,
                drillName: mechanicalDrill?.name,
              }
            : undefined
        }
        mechanicsFindings={mechanicsFindings}
        recommendedWorkout={
          recommendedWorkout
            ? {
                id: recommendedWorkout._id.toString(),
                label: recommendedWorkout.source.label,
                drillCount: recommendedWorkout.drills.length,
                estimatedDurationMinutes:
                  recommendedWorkout.estimatedDurationMinutes,
              }
            : undefined
        }
      />
    </div>
  );
}
