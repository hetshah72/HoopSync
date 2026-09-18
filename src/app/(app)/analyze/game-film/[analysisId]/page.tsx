import { ObjectId } from "mongodb";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getAnalysisForUser } from "@/server/services/gameFootageService";
import { findMediaAssetById } from "@/server/repositories/mediaAssetRepository";
import { getWorkoutForUser } from "@/server/services/workoutService";
import { GameFilmReport } from "@/components/analyze/game-film-report";
import { GameFilmProcessing } from "@/components/analyze/game-film-processing";
import { ErrorState } from "@/components/layout/error-state";
import { buttonVariants } from "@/components/ui/button";
import {
  describeSubject,
  resolveAnalysisProvenance,
} from "@/lib/game-film-provenance";

export default async function GameFilmAnalysisPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(analysisId)) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    notFound();
  }

  const userId = new ObjectId(session.user.id);
  const analysis = await getAnalysisForUser(userId, new ObjectId(analysisId));
  if (!analysis) {
    notFound();
  }

  if (analysis.status === "failed") {
    return (
      <ErrorState
        icon={TriangleAlert}
        title="We couldn't finish that review"
        description={
          analysis.failureReason ?? "Something went wrong reviewing that clip."
        }
        actions={
          <Link
            href="/analyze/game-film"
            className={buttonVariants({ variant: "brand" })}
          >
            Back to Game Film
          </Link>
        }
      />
    );
  }

  if (analysis.status === "processing") {
    // Pending, not broken. Analysis runs after the upload response, so this
    // polls itself to completion rather than asking the player to refresh.
    return <GameFilmProcessing analysisId={analysis._id.toString()} />;
  }

  const video = await findMediaAssetById(analysis.videoAssetId);

  // Resolved here rather than in the client component so the report can show
  // each recommended workout's real drill count and length, not just a link.
  const workouts = await Promise.all(
    analysis.recommendedWorkoutIds.map((id) => getWorkoutForUser(userId, id)),
  );

  return (
    <GameFilmReport
      report={{
        id: analysis._id.toString(),
        uploadedAt: analysis.uploadedAt.toDateString(),
        videoUrl: video?.url,
        basis: analysis.basis,
        provenance: resolveAnalysisProvenance(analysis),
        framesAnalyzed: analysis.framesAnalyzed,
        subject: describeSubject(analysis.subject),
        events: analysis.events,
        strengths: analysis.strengths,
        weaknesses: analysis.weaknesses,
        recommendedWorkouts: workouts
          .filter((w) => w !== null)
          .map((w) => ({
            id: w._id.toString(),
            label: w.source.label,
            drillCount: w.drills.length,
            estimatedDurationMinutes: w.estimatedDurationMinutes,
          })),
      }}
    />
  );
}
