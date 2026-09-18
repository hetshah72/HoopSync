"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CourtDiagram } from "@/components/analyze/court-diagram";
import { ChipGroup } from "@/components/ui/chip-group";
import { zoneFromLocation, ZONE_LABELS } from "@/lib/shot-zones";
import { SHOT_TYPE_LABELS } from "@/lib/shot-mechanics";
import { SHOT_TYPES, type ShotType, type ShotZone } from "@/types/db";
import {
  deleteShotAction,
  finalizeSessionAction,
  logShotAction,
} from "@/server/actions/shotSessionActions";

/** Optional at the point of logging - see `shotType` on ShotRecord. */
const SHOT_TYPE_OPTIONS = SHOT_TYPES.map((value) => ({
  value,
  label: SHOT_TYPE_LABELS[value],
}));

interface LoggedShot {
  id: string;
  zone: ShotZone;
  location: { xPct: number; yPct: number };
  made: boolean;
  timestampInVideoSeconds: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ShotLogger({
  sessionId,
  videoUrl,
  initialShots,
}: {
  sessionId: string;
  videoUrl: string;
  initialShots: LoggedShot[];
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shots, setShots] = useState<LoggedShot[]>(initialShots);
  const [pendingTap, setPendingTap] = useState<{
    xPct: number;
    yPct: number;
    zone: ShotZone;
    timestamp: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  /**
   * Sticky across taps: a player working on catch-and-shoot reps is logging a
   * dozen of them in a row, and re-picking the type every time would make an
   * optional field feel like a required one.
   */
  const [shotType, setShotType] = useState<ShotType | null>(null);

  function handleCourtClick(xPct: number, yPct: number) {
    const timestamp = videoRef.current?.currentTime ?? 0;
    setPendingTap({
      xPct,
      yPct,
      zone: zoneFromLocation(xPct, yPct),
      timestamp,
    });
  }

  function confirmShot(made: boolean) {
    if (!pendingTap) return;
    const tap = pendingTap;
    setPendingTap(null);

    startTransition(async () => {
      try {
        const result = await logShotAction(sessionId, {
          xPct: tap.xPct,
          yPct: tap.yPct,
          zone: tap.zone,
          made,
          ...(shotType ? { shotType } : {}),
          timestampInVideoSeconds: tap.timestamp,
        });
        setShots(
          result.shots.map((s) => ({
            id: s.id,
            zone: s.zone,
            location: s.location,
            made: s.made,
            timestampInVideoSeconds: s.timestampInVideoSeconds,
          })),
        );
      } catch {
        toast.error("Couldn't log that shot - try again.");
      }
    });
  }

  function handleRemoveShot(shotId: string) {
    if (!window.confirm("Remove this shot?")) return;
    setShots((prev) => prev.filter((s) => s.id !== shotId));
    startTransition(async () => {
      try {
        await deleteShotAction(sessionId, shotId);
      } catch {
        toast.error("Couldn't remove that shot.");
      }
    });
  }

  function handleFinish() {
    startTransition(async () => {
      try {
        const { completedGoalTitles, unlockedMilestones } =
          await finalizeSessionAction(sessionId);
        // Same as completing a workout: a goal this session finished is worth
        // saying in the moment (BRD 7.12), not leaving to be found later.
        for (const title of completedGoalTitles) {
          toast.success(`Goal complete: ${title}`);
        }
        // Milestones (BRD 7.13) stay secondary - plain `toast`, and last. See
        // the matching note in active-workout.tsx.
        for (const label of unlockedMilestones) {
          toast(`Milestone: ${label}`);
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't finish this session.",
        );
      }
    });
  }

  const makes = shots.filter((s) => s.made).length;

  return (
    <div className="space-y-4">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        playsInline
        className="w-full rounded-lg bg-black"
      />
      <p className="text-muted-foreground text-sm">
        Play the video and tap the court where each shot happens - the
        video&apos;s current time becomes that shot&apos;s exact moment for
        replay later.
      </p>

      <CourtDiagram
        shots={shots.map((s) => ({ id: s.id, ...s.location, made: s.made }))}
        onCourtClick={handleCourtClick}
        onShotClick={handleRemoveShot}
      />

      {pendingTap && (
        <Card>
          {/* Stacked rather than one row: the shot-type chips need the full
              width on a phone, and Make/Miss must stay reachable with a thumb. */}
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{ZONE_LABELS[pendingTap.zone]}</p>
                <p className="text-muted-foreground">
                  at {formatTime(pendingTap.timestamp)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingTap(null)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs">
                Shot type (optional) - tap one and it sticks for your next shots
              </p>
              <ChipGroup
                options={SHOT_TYPE_OPTIONS}
                value={shotType ?? ""}
                onChange={(value) =>
                  setShotType((current) =>
                    // Tapping the selected chip clears it, so "I don't want to
                    // say" stays reachable after a mis-tap.
                    current === value ? null : (value as ShotType),
                  )
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => confirmShot(false)}
              >
                Miss
              </Button>
              <Button disabled={isPending} onClick={() => confirmShot(true)}>
                <Check className="size-4" />
                Make
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {makes}/{shots.length} logged - tap a marker to{" "}
          <Trash2 className="inline size-3" /> remove it
        </span>
      </div>

      <Button
        className="w-full"
        disabled={isPending || shots.length === 0}
        onClick={handleFinish}
      >
        {isPending ? "Finishing..." : "Finish & Analyze Session"}
      </Button>
    </div>
  );
}
