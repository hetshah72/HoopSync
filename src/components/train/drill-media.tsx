"use client";

import { Video } from "lucide-react";
import { MediaDisclosureNote } from "@/components/content/media-disclosure";
import { disclosureFor } from "@/lib/media-provenance";
import type { MediaAssetSource } from "@/types/db";

/**
 * The "video/instruction" half of BRD 7.3's Active Workout requirement.
 *
 * Both halves matter and they are not interchangeable: `description` is the
 * real, authored instruction for the drill, while the clip may be a shared
 * placeholder.
 *
 * The disclosure used to be a hardcoded sentence that said "placeholder demo
 * clip" no matter what the asset actually was - which was true of every drill
 * today and would have become a lie about licensed footage the moment any was
 * attached. It now comes from the source snapshotted on the workout's drill
 * (`WorkoutDrillSnapshot.videoSource`), so the label tracks the content.
 *
 * `videoSource` is absent on workouts snapshotted before provenance existed.
 * That is treated as "placeholder", which is the truth for every such row and
 * is the safe direction to default: understating our rights to footage is
 * harmless, overstating them is the thing BRD 7.14 forbids.
 */
export function DrillMedia({
  name,
  description,
  videoUrl,
  videoSource,
}: {
  name: string;
  description?: string;
  videoUrl?: string;
  videoSource?: MediaAssetSource;
}) {
  const disclosure = disclosureFor({ source: videoSource ?? "placeholder" });

  return (
    <div className="space-y-3">
      {videoUrl ? (
        <div className="space-y-1.5">
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            muted
            loop
            preload="metadata"
            aria-label={`${disclosure.sourceLabel} for ${name}`}
            className="aspect-video w-full rounded-lg bg-black"
          />
          <MediaDisclosureNote disclosure={disclosure} />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
          <Video className="size-4 shrink-0" aria-hidden />
          <span>
            No demo clip for this drill yet - the instruction and coaching cues
            below are the full guidance.
          </span>
        </div>
      )}

      {description && (
        <div>
          <p className="text-sm font-medium">How to do it</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      )}
    </div>
  );
}
