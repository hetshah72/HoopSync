"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/workout-duration";

/**
 * BRD 7.3's Active Workout "timer", as a real instrument rather than a
 * decoration.
 *
 * Counts *down* for a drill prescribed by time and *up* for one prescribed by
 * sets and reps, because those are genuinely different jobs: a 45-second
 * handle drill needs a target to work against, while a 4x10 shooting drill is
 * paced by the reps and only needs to know how long it took.
 *
 * Elapsed time is reported to the server as a delta via `onReport`, and only
 * on meaningful events - pause, unmount, tab hidden - never on the tick. A
 * per-second write would be one request per second per training player for no
 * extra fidelity.
 */
export function DrillTimer({
  drillKey,
  targetSeconds,
  initialElapsedSeconds,
  disabled,
  onReport,
}: {
  /** Changes when the player moves to another drill, remounting the timer. */
  drillKey: string;
  targetSeconds?: number;
  initialElapsedSeconds: number;
  disabled?: boolean;
  onReport: (deltaSeconds: number) => void;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(initialElapsedSeconds);

  // What we've already told the server about, so each report sends only the
  // new time rather than the running total.
  const reportedRef = useRef(initialElapsedSeconds);
  const elapsedRef = useRef(initialElapsedSeconds);
  const onReportRef = useRef(onReport);

  // Mirrored through effects rather than assigned during render: React may
  // render without committing, and a ref written in the render body can then
  // hold a value the user never actually saw.
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    onReportRef.current = onReport;
  }, [onReport]);

  const flush = useCallback(() => {
    const delta = Math.floor(elapsedRef.current - reportedRef.current);
    if (delta <= 0) return;
    reportedRef.current = elapsedRef.current;
    onReportRef.current(delta);
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);

  // Leaving the drill, closing the tab, or backgrounding the app must not
  // silently discard the time already put in.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [flush, drillKey]);

  const countsDown = typeof targetSeconds === "number" && targetSeconds > 0;
  const remaining = countsDown ? Math.max(0, targetSeconds! - elapsed) : 0;
  const reachedTarget = countsDown && remaining === 0;

  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <div>
        <p
          className={`font-mono text-2xl tabular-nums ${reachedTarget ? "text-primary" : ""}`}
          aria-live="off"
        >
          {countsDown ? formatDuration(remaining) : formatDuration(elapsed)}
        </p>
        <p className="text-xs text-muted-foreground">
          {countsDown
            ? reachedTarget
              ? "Target reached"
              : `of ${formatDuration(targetSeconds!)} target`
            : "Time on this drill"}
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={running ? "secondary" : "default"}
          size="sm"
          disabled={disabled}
          aria-label={running ? "Pause timer" : "Start timer"}
          onClick={() => {
            if (running) flush();
            setRunning((r) => !r);
          }}
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          {running ? "Pause" : "Start"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || elapsed === 0}
          aria-label="Reset timer"
          onClick={() => {
            // Only resets the on-screen count for another attempt. Time
            // already reported stays banked - the player really did train it.
            flush();
            setRunning(false);
            setElapsed(reportedRef.current);
          }}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </div>
  );
}
