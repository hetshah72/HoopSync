"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { DrillMedia } from "@/components/train/drill-media";
import { DrillTimer } from "@/components/train/drill-timer";
import { formatDuration, formatPrescription } from "@/lib/workout-duration";
import { AskCoachButton } from "@/components/coach/ask-coach-button";
import {
  askCoachAboutWorkoutAction,
  completeWorkoutAction,
  recordDrillElapsedAction,
  startWorkoutAction,
  toggleDrillCompletionAction,
  toggleDrillSkippedAction,
} from "@/server/actions/workoutActions";
import type {
  DrillDifficulty,
  MediaAssetSource,
  WorkoutStatus,
} from "@/types/db";

export interface ActiveWorkoutDrillView {
  drillId: string;
  order: number;
  name: string;
  description?: string;
  videoUrl?: string;
  /** Drives the clip's disclosure (BRD 7.14) - never hardcode the label. */
  videoSource?: MediaAssetSource;
  coachingCues: string[];
  difficulty?: DrillDifficulty;
  sets?: number;
  reps?: number;
  durationSeconds?: number;
  completed: boolean;
  skipped: boolean;
  elapsedSeconds: number;
}

export interface ActiveWorkoutView {
  id: string;
  label: string;
  status: WorkoutStatus;
  difficulty: DrillDifficulty;
  estimatedDurationMinutes: number;
  actualDurationSeconds?: number;
  coverageNote?: string;
  drills: ActiveWorkoutDrillView[];
}

/**
 * Resuming should put the player back where the work actually is, not at the
 * top. Picks the first drill that is neither done nor deliberately skipped.
 */
function firstUnfinishedIndex(drills: ActiveWorkoutDrillView[]): number {
  const index = drills.findIndex((d) => !d.completed && !d.skipped);
  return index === -1 ? 0 : index;
}

export function ActiveWorkout({ workout: initial }: { workout: ActiveWorkoutView }) {
  const router = useRouter();
  const [workout, setWorkout] = useState(initial);
  const [drillIndex, setDrillIndex] = useState(() =>
    firstUnfinishedIndex(initial.drills),
  );
  const [isPending, startTransition] = useTransition();

  const drill = workout.drills[drillIndex];
  const isLastDrill = drillIndex === workout.drills.length - 1;
  const isComplete = workout.status === "completed";

  const doneCount = useMemo(
    () => workout.drills.filter((d) => d.completed).length,
    [workout.drills],
  );
  const skippedCount = useMemo(
    () => workout.drills.filter((d) => d.skipped).length,
    [workout.drills],
  );

  function patchDrill(order: number, patch: Partial<ActiveWorkoutDrillView>) {
    setWorkout((w) => ({
      ...w,
      drills: w.drills.map((d) => (d.order === order ? { ...d, ...patch } : d)),
    }));
  }

  function handleStart() {
    startTransition(async () => {
      try {
        await startWorkoutAction(workout.id);
        setWorkout((w) => ({ ...w, status: "in_progress" }));
      } catch {
        toast.error("Couldn't start this workout right now.");
      }
    });
  }

  // Optimistic with rollback: the toggle should feel instant mid-workout, but
  // a failed write must not leave the screen claiming work that wasn't saved.
  function handleToggleComplete() {
    const next = !drill.completed;
    patchDrill(drill.order, { completed: next, skipped: false });
    startTransition(async () => {
      try {
        await toggleDrillCompletionAction(workout.id, drill.order, next);
      } catch {
        toast.error("Couldn't save that - try again.");
        patchDrill(drill.order, { completed: !next });
      }
    });
  }

  function handleSkip() {
    const next = !drill.skipped;
    patchDrill(drill.order, { skipped: next, completed: false });
    startTransition(async () => {
      try {
        await toggleDrillSkippedAction(workout.id, drill.order, next);
        if (next && !isLastDrill) setDrillIndex((i) => i + 1);
      } catch {
        toast.error("Couldn't save that - try again.");
        patchDrill(drill.order, { skipped: !next });
      }
    });
  }

  function handleReportElapsed(order: number, deltaSeconds: number) {
    patchDrill(order, {
      elapsedSeconds:
        (workout.drills.find((d) => d.order === order)?.elapsedSeconds ?? 0) +
        deltaSeconds,
    });
    // Fire-and-forget: losing a few seconds of timing is never worth
    // interrupting a training session with an error toast.
    void recordDrillElapsedAction(workout.id, order, deltaSeconds).catch(
      () => {},
    );
  }

  function handleCompleteWorkout() {
    startTransition(async () => {
      try {
        const { completedGoalTitles, unlockedMilestones } =
          await completeWorkoutAction(workout.id);
        toast.success("Workout complete - Progress updated.");
        // A goal that finished off this workout is the clearest proof the
        // player has that goals really do track themselves (BRD 7.12), so it
        // gets said here rather than left to be discovered on Progress.
        for (const title of completedGoalTitles) {
          toast.success(`Goal complete: ${title}`);
        }
        // Milestones (BRD 7.13) come last and use the plain `toast`, not
        // `toast.success` - the training confirmation above stays the headline,
        // which is the founder's constraint that gamification never outrank the
        // development value. Note notificationService.notifyProgressMilestones
        // also fires at the shared thresholds; that one is the persistent inbox
        // entry, this is the in-session acknowledgement.
        for (const label of unlockedMilestones) {
          toast(`Milestone: ${label}`);
        }
        router.push("/train");
        router.refresh();
      } catch {
        toast.error("Couldn't complete this workout right now.");
      }
    });
  }

  if (workout.status === "pending") {
    return (
      // The pre-start view is a run sheet, not a summary: the player reads it
      // to decide whether to commit to the next 35 minutes, so the drills get
      // numbered rows they can actually scan rather than a grey two-column list.
      <Card>
        <CardHeader className="gap-2.5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-brand-ink uppercase">
            Up next
          </p>
          <CardTitle className="text-xl">{workout.label}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="capitalize">
              {workout.difficulty}
            </Badge>
            <Badge variant="secondary">
              {workout.drills.length} drill
              {workout.drills.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="secondary">
              ~{workout.estimatedDurationMinutes} min
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workout.coverageNote && (
            <p className="rounded-xl border border-border/60 bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {workout.coverageNote}
            </p>
          )}
          <ol className="divide-y divide-border/60 rounded-xl border border-border/60">
            {workout.drills.map((d, i) => (
              <li
                key={d.drillId}
                className="flex items-center gap-3 px-3 py-2.5 text-sm"
              >
                <span
                  aria-hidden
                  className="tabular inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-[0.6875rem] font-semibold text-muted-foreground"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {d.name}
                </span>
                {formatPrescription(d) && (
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {formatPrescription(d)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <Button
            size="lg"
            className="w-full"
            disabled={isPending}
            onClick={handleStart}
          >
            {isPending ? "Starting..." : "Start Workout"}
          </Button>
          {/* BRD 7.9: "discuss and adjust workouts". Offered before the player
              commits rather than mid-session - this is the moment they're
              deciding whether the session is the right one, and interrupting a
              running workout to open a chat is the wrong trade. */}
          <AskCoachButton
            action={askCoachAboutWorkoutAction}
            targetId={workout.id}
            label="Ask Coach about this workout"
            variant="ghost"
            className="w-full"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {/* Reflects work actually done, not where you happen to be standing. */}
        <Progress value={(doneCount / workout.drills.length) * 100} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Drill {drillIndex + 1} of {workout.drills.length}
          </span>
          <span>
            {doneCount} of {workout.drills.length} done
            {skippedCount > 0 && ` - ${skippedCount} skipped`}
          </span>
        </div>
      </div>

      {isComplete && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          This workout is complete - it&apos;s a record of what you did, so it
          can&apos;t be edited.
          {workout.actualDurationSeconds
            ? ` Total time: ${formatDuration(workout.actualDurationSeconds)}.`
            : ""}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-3 text-base">
            <span>{drill.name}</span>
            <span className="flex shrink-0 gap-1.5">
              {drill.difficulty && (
                <Badge variant="outline">{drill.difficulty}</Badge>
              )}
              {drill.completed && <Badge variant="secondary">Done</Badge>}
              {drill.skipped && <Badge variant="outline">Skipped</Badge>}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {formatPrescription(drill) && (
            <p className="text-sm font-medium">{formatPrescription(drill)}</p>
          )}

          <DrillMedia
            name={drill.name}
            description={drill.description}
            videoUrl={drill.videoUrl}
            videoSource={drill.videoSource}
          />

          {!isComplete && (
            <DrillTimer
              key={drill.order}
              drillKey={String(drill.order)}
              targetSeconds={drill.durationSeconds}
              initialElapsedSeconds={drill.elapsedSeconds}
              onReport={(delta) => handleReportElapsed(drill.order, delta)}
            />
          )}

          {drill.coachingCues.length > 0 && (
            <div>
              <p className="text-sm font-medium">Coaching cues</p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {drill.coachingCues.map((cue) => (
                  <li key={cue}>{cue}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={drill.completed ? "secondary" : "outline"}
              disabled={isPending || isComplete}
              onClick={handleToggleComplete}
            >
              {drill.completed ? (
                <Check className="size-4" />
              ) : (
                <Circle className="size-4" />
              )}
              {drill.completed ? "Marked complete" : "Mark complete"}
            </Button>
            <Button
              variant="ghost"
              disabled={isPending || isComplete}
              onClick={handleSkip}
            >
              <SkipForward className="size-4" />
              {drill.skipped ? "Un-skip" : "Skip"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          disabled={drillIndex === 0}
          onClick={() => setDrillIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={isLastDrill}
          onClick={() =>
            setDrillIndex((i) => Math.min(workout.drills.length - 1, i + 1))
          }
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Reachable from any drill: a player who finishes early shouldn't have
          to page to the end to say so. */}
      <Button
        className="w-full"
        disabled={isPending || isComplete}
        onClick={handleCompleteWorkout}
      >
        <Flag className="size-4" />
        {isComplete
          ? "Completed"
          : isPending
            ? "Finishing..."
            : "Complete Workout"}
      </Button>
    </div>
  );
}
