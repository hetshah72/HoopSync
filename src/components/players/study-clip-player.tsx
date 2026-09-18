"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaDisclosureNote } from "@/components/content/media-disclosure";
import type { MediaView } from "@/server/services/mediaProvenanceService";
import { cn } from "@/lib/utils";

/**
 * The study clip with guided call-outs (BRD 7.4: "Watch a study clip with
 * guided call-outs", "a short study clip with call-outs of what to watch
 * for").
 *
 * Call-outs are real timestamps into the clip: tapping one seeks the video
 * there, and the active call-out highlights as the video plays past it -
 * the same <video> + `timeupdate` + seek pattern the shot replay dialog uses
 * for exact-shot replay in Analyze.
 *
 * Footage provenance is disclosed rather than implied. Per BRD 6.4/7.14 the
 * MVP must not depend on league footage, so this currently plays a
 * clearly-labeled placeholder; the call-outs themselves are real HoopSync
 * coaching notes and are the thing actually being studied. The disclosure
 * comes from the asset's own descriptor, so swapping in licensed film changes
 * the label with it - neither the call-outs nor this component need editing.
 */
export interface StudyCalloutView {
  atSeconds: number;
  label: string;
  text: string;
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function StudyClipPlayer({
  media,
  callouts,
}: {
  media: MediaView;
  callouts: StudyCalloutView[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Sorted so "the last call-out at or before the playhead" is a simple
  // scan; the caller isn't required to author them in order.
  const ordered = [...callouts].sort((a, b) => a.atSeconds - b.atSeconds);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || ordered.length === 0) return;

    const handleTimeUpdate = () => {
      const current = video.currentTime;
      let index = -1;
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].atSeconds <= current) index = i;
        else break;
      }
      setActiveIndex(index);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
    // `ordered` is rebuilt each render; depend on the stable call-out shape
    // instead so the listener isn't torn down and re-added every tick.
  }, [callouts]); // eslint-disable-line react-hooks/exhaustive-deps

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => {
      // Autoplay can be blocked - the player can still hit play manually.
    });
  }

  if (ordered.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Study clip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <video
          ref={videoRef}
          src={media.url}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-lg bg-black"
        />

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            What to watch for - tap to jump to that moment
          </p>
          <ul className="space-y-1">
            {ordered.map((callout, index) => (
              <li key={`${callout.atSeconds}-${callout.label}`}>
                <button
                  type="button"
                  onClick={() => seekTo(callout.atSeconds)}
                  aria-current={index === activeIndex ? "true" : undefined}
                  className={cn(
                    "flex w-full gap-3 rounded-lg border p-2 text-left transition-colors hover:bg-muted/50",
                    index === activeIndex
                      ? "border-primary/50 bg-primary/5"
                      : "border-transparent",
                  )}
                >
                  <span className="mt-0.5 flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                    <Play className="size-3" />
                    {formatTimestamp(callout.atSeconds)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {callout.label}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {callout.text}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <MediaDisclosureNote
          disclosure={media.disclosure}
          className="border-t pt-2"
        />
      </CardContent>
    </Card>
  );
}
