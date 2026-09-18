"use client";

import { useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, MessageCircle, Play, ThumbsUp, Target } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { GAME_CATEGORY_LABELS } from "@/lib/game-film-categories";
import type { GameAnalysisCategory } from "@/lib/game-film-categories";
import {
  provenanceDisclosure,
  provenanceSectionHeadings,
} from "@/lib/game-film-provenance";
import { shareGameFilmWithCoachAction } from "@/server/actions/gameFootageActions";
import type { AnalysisProvenance, GameEvent } from "@/types/db";

export interface GameFilmObservationView {
  category: string;
  text: string;
  recommendation?: string;
}

export interface RecommendedWorkoutView {
  id: string;
  label: string;
  drillCount: number;
  estimatedDurationMinutes: number;
}

export interface GameFilmReportView {
  id: string;
  uploadedAt: string;
  videoUrl?: string;
  basis?: string;
  provenance: AnalysisProvenance;
  framesAnalyzed?: number;
  subject?: string;
  events: GameEvent[];
  strengths: GameFilmObservationView[];
  weaknesses: GameFilmObservationView[];
  recommendedWorkouts: RecommendedWorkoutView[];
}

const EVENT_LABELS: Record<GameEvent["type"], string> = {
  shot: "Shot",
  turnover: "Turnover",
  assist: "Assist",
  drive: "Drive",
  defensive_stop: "Defensive stop",
  off_ball_movement: "Off-ball movement",
};

function categoryLabel(category: string): string {
  return (
    GAME_CATEGORY_LABELS[category as GameAnalysisCategory] ?? "Observation"
  );
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function GameFilmReport({ report }: { report: GameFilmReportView }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPending, startTransition] = useTransition();

  const headings = provenanceSectionHeadings(report.provenance);
  const disclosure = provenanceDisclosure(
    report.provenance,
    report.framesAnalyzed,
  );

  function handleShare() {
    startTransition(async () => {
      try {
        const { conversationId } = await shareGameFilmWithCoachAction(report.id);
        router.push(`/coach/${conversationId}`);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't share that with Coach right now.",
        );
      }
    });
  }

  /** Jump the clip to the moment an event was read from. */
  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    video.play().catch(() => {});
    video.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div>
      <PageHeader
        back={{ href: "/analyze/game-film", label: "Back to Game Film" }}
        eyebrow="Game Film"
        title="Game Film Review"
        description={
          report.subject
            ? `${report.uploadedAt} - following ${report.subject}`
            : report.uploadedAt
        }
        action={
          <Button disabled={isPending} onClick={handleShare}>
            <MessageCircle className="size-4" />
            {isPending ? "Sharing..." : "Share With Coach"}
          </Button>
        }
      />

      {/* Footage and the disclosure about it belong together, and on a desktop
          they belong beside the findings rather than above a long scroll. The
          left column is the evidence; the right column is what was made of it. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-4">
          {report.strengths.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex size-7 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground"
                  >
                    <ThumbsUp className="size-3.5" />
                  </span>
                  {headings.strengths}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                {report.strengths.map((item) => (
                  <div key={item.category} className="py-3 first:pt-0 last:pb-0">
                    <Badge variant="success" className="mb-1.5">
                      {categoryLabel(item.category)}
                    </Badge>
                    <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                      {item.text}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {report.weaknesses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-foreground"
                  >
                    <Target className="size-3.5" />
                  </span>
                  {headings.weaknesses}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                {report.weaknesses.map((item) => (
                  <div key={item.category} className="py-3 first:pt-0 last:pb-0">
                    <Badge variant="brand" className="mb-1.5">
                      {categoryLabel(item.category)}
                    </Badge>
                    <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                      {item.text}
                    </p>
                    {item.recommendation && (
                      <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed text-pretty">
                        <span className="font-semibold">Try this: </span>
                        {item.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* BRD 7.7's "identify relevant events", as real seekable moments.
              Only ever populated when a model actually read the frames - the
              heuristic path leaves this empty rather than inventing times. */}
          {report.events.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Moments picked out of your clip</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                {report.events.map((event, index) => (
                  <button
                    key={`${event.timestampInVideoSeconds}-${index}`}
                    type="button"
                    onClick={() => seekTo(event.timestampInVideoSeconds)}
                    disabled={!report.videoUrl}
                    className="press flex w-full items-start gap-3 py-3 text-left transition-colors outline-none first:pt-0 last:pb-0 hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info-soft-foreground"
                    >
                      <Play className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="tabular text-xs font-semibold">
                          {formatTimestamp(event.timestampInVideoSeconds)}
                        </span>
                        <Badge variant="outline">
                          {EVENT_LABELS[event.type]}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground text-pretty">
                        {event.description}
                      </span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* BRD v1.1 §7's "Game Weakness -> Recommended Workout", as a real
              startable workout rather than a suggestion in prose. */}
          {report.recommendedWorkouts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Workouts built from this review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.recommendedWorkouts.map((workout) => (
                  <Link
                    key={workout.id}
                    href={`/train/${workout.id}`}
                    className={buttonVariants({
                      variant: "outline",
                      className:
                        "h-auto w-full justify-between gap-3 py-3 text-left",
                    })}
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate font-semibold">
                        {workout.label}
                      </span>
                      <span className="tabular text-xs font-normal text-muted-foreground">
                        {workout.drillCount} drill
                        {workout.drillCount === 1 ? "" : "s"} - ~
                        {workout.estimatedDurationMinutes} min
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-9">
          {report.videoUrl && (
            <video
              ref={videoRef}
              src={report.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl border border-border/70 bg-black shadow-sm"
            />
          )}

          {/* The disclosure travels with the footage: a player should know
              what this review is before they weigh what it says. */}
          <Card className="border-brand/25 bg-brand-soft/30">
            <CardContent className="space-y-1.5">
              <p className="font-heading text-sm font-semibold tracking-tight">
                {disclosure.headline}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                {disclosure.detail}
              </p>
              {report.basis && (
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground italic text-pretty">
                  {report.basis}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
