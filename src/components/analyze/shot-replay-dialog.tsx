"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPlus, MessageCircle, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ZONE_LABELS } from "@/lib/shot-zones";
import {
  addCorrectionDrillToWorkoutAction,
  askCoachAboutShotAction,
} from "@/server/actions/shotSessionActions";
import type { ShotZone } from "@/types/db";

export interface ReplayShot {
  id: string;
  zone: ShotZone;
  made: boolean;
  timestampInVideoSeconds: number;
  replayStartSeconds?: number;
  replayEndSeconds?: number;
  feedbackText: string;
  /**
   * The four-part version (BRD 7.6). Absent on sessions finalized before it
   * existed - `feedbackText` is the fallback for exactly those.
   */
  feedback?: {
    observation: string;
    potentialIssue: string;
    correction: string;
    drillName?: string;
  };
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ShotReplayDialog({
  shot,
  sessionId,
  videoUrl,
  onClose,
}: {
  shot: ReplayShot | null;
  sessionId: string;
  videoUrl?: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /**
   * Plays this shot's own clip window.
   *
   * Starts at `replayStartSeconds` (the tap, minus a few seconds) rather than
   * at the tap itself: the player taps as the shot happens, so seeking to the
   * bare timestamp shows the aftermath and not the shot. The window is still
   * anchored to this shot's exact timestamp and no other - BRD v1.1 §6
   * acceptance point 9 - and that exact moment is printed under the video.
   */
  const playShotWindow = useCallback(() => {
    const video = videoRef.current;
    if (!shot || !video) return;

    video.currentTime = shot.replayStartSeconds ?? shot.timestampInVideoSeconds;
    video.play().catch(() => {
      // Autoplay can be blocked - the player can still hit play manually.
    });
  }, [shot]);

  useEffect(() => {
    const video = videoRef.current;
    if (!shot || !video) return;

    playShotWindow();

    // Bound the replay to just this shot instead of running on into the
    // rest of the session footage.
    const stopAt = shot.replayEndSeconds;
    if (stopAt === undefined) return;

    const el = video;
    const handleTimeUpdate = () => {
      if (el.currentTime >= stopAt) {
        el.pause();
      }
    };
    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [shot, playShotWindow]);

  function handleAskCoach() {
    if (!shot) return;
    startTransition(async () => {
      try {
        const { conversationId } = await askCoachAboutShotAction(
          sessionId,
          shot.id,
        );
        onClose();
        router.push(`/coach/${conversationId}`);
      } catch {
        toast.error("Couldn't open Coach for that shot right now.");
      }
    });
  }

  function handleAddCorrectionDrill() {
    if (!shot) return;
    startTransition(async () => {
      try {
        const { drillName } = await addCorrectionDrillToWorkoutAction(
          sessionId,
          shot.id,
        );
        toast.success(`Added "${drillName}" to your workout.`);
      } catch {
        toast.error("Couldn't add a correction drill right now.");
      }
    });
  }

  return (
    <Dialog open={shot !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {shot && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {ZONE_LABELS[shot.zone]}
                <Badge variant={shot.made ? "secondary" : "destructive"}>
                  {shot.made ? "Make" : "Miss"}
                </Badge>
              </DialogTitle>
            </DialogHeader>
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  className="w-full rounded-lg bg-black"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">
                    Shot at {formatTimestamp(shot.timestampInVideoSeconds)}
                    {shot.replayStartSeconds !== undefined &&
                      ` - replaying from ${formatTimestamp(shot.replayStartSeconds)}`}
                  </p>
                  <Button variant="ghost" size="sm" onClick={playShotWindow}>
                    <RotateCcw className="size-4" />
                    Replay
                  </Button>
                </div>
              </>
            ) : (
              // Say the footage is gone rather than rendering an empty player
              // that looks broken. The shot itself is still real data.
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                This session&apos;s footage is no longer available, so
                there&apos;s nothing to replay. The shot was logged at{" "}
                {formatTimestamp(shot.timestampInVideoSeconds)}.
              </div>
            )}

            {shot.feedback ? (
              // observation -> likely issue -> correction -> drill, the
              // structure BRD 7.6 requires of every piece of feedback.
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {shot.feedback.observation}
                </p>
                <div>
                  <Badge variant="outline" className="mb-1">
                    {shot.feedback.potentialIssue}
                  </Badge>
                  <p className="text-muted-foreground">
                    {shot.feedback.correction}
                  </p>
                </div>
                {shot.feedback.drillName && (
                  <p className="text-muted-foreground text-xs">
                    Drill: {shot.feedback.drillName}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {shot.feedbackText}
              </p>
            )}
            <p className="text-muted-foreground border-t pt-2 text-xs italic">
              {shot.feedback
                ? "The tally above is from your own logged shots. The likely issue and correction are simulated - in production a pose-estimation model derives them from the frames around your shot."
                : "Simulated shot feedback. In production, a pose-estimation model derives this from the frames around your shot."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleAskCoach}
              >
                <MessageCircle className="size-4" />
                Ask Coach
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleAddCorrectionDrill}
              >
                <ListPlus className="size-4" />
                Add Drill
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
