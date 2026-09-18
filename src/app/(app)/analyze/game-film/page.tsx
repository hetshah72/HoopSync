import { ObjectId } from "mongodb";
import Link from "next/link";
import { ChevronRight, Video } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { listAnalysesForUser } from "@/server/services/gameFootageService";
import { isOpenAiConfigured } from "@/server/external/openaiClient";
import { GameFilmUploadForm } from "@/components/analyze/game-film-upload-form";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeading } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";

const STATUS_LABEL = {
  processing: "Reviewing",
  completed: "Reviewed",
  failed: "Failed",
} as const;

const STATUS_VARIANT = {
  processing: "info",
  completed: "success",
  failed: "destructive",
} as const;

export default async function GameFilmPage() {
  const session = await auth();
  const analyses = session?.user?.id
    ? await listAnalysesForUser(new ObjectId(session.user.id))
    : [];

  return (
    <div>
      <PageHeader
        back={{ href: "/analyze", label: "Back to Analyze" }}
        eyebrow="Analyze"
        title="Game Film"
        description="Upload a clip to get strengths, weaknesses, and a workout built from each weakness."
      />

      <GameFilmUploadForm analysisEnabled={isOpenAiConfigured()} />

      {analyses.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={Video}
          title="No game film yet"
          description="Upload a clip above and your review will show up here."
        />
      ) : (
        <>
          <SectionHeading
            title="Your reviews"
            count={analyses.length}
            className="mt-7 mb-3"
          />
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {analyses.map((analysis) => (
              <li
                key={analysis._id.toString()}
                className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
              >
                <Link
                  href={`/analyze/game-film/${analysis._id}`}
                  className="press flex h-full items-center gap-3.5 px-4 py-3.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground"
                  >
                    <Video className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      Game Film - {analysis.uploadedAt.toLocaleDateString()}
                    </p>
                    <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                      {analysis.status === "completed"
                        ? `${analysis.strengths.length} strengths, ${analysis.weaknesses.length} to work on - ${analysis.recommendedWorkoutIds.length} workout(s) ready`
                        : analysis.status === "failed"
                          ? "Review didn't finish"
                          : "Review in progress"}
                    </p>
                  </div>
                  <Badge
                    variant={STATUS_VARIANT[analysis.status]}
                    className="shrink-0"
                  >
                    {STATUS_LABEL[analysis.status]}
                  </Badge>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
