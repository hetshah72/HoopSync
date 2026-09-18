"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractVideoFrames } from "@/lib/extract-video-frames";

type Stage = "idle" | "reading" | "uploading";

export function GameFilmUploadForm({
  analysisEnabled,
}: {
  /** True when a vision model is configured, which changes what we can promise. */
  analysisEnabled: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [jerseyColor, setJerseyColor] = useState("");
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [readProgress, setReadProgress] = useState(0);
  const [isPending, startTransition] = useTransition();

  const busy = isPending || stage !== "idle";

  function handleUpload() {
    if (!file) {
      toast.error("Choose a game clip first.");
      return;
    }

    startTransition(async () => {
      try {
        // Read the frames here rather than server-side: the browser already
        // has the file and a decoder, so the server never handles raw video
        // for analysis. An undecodable clip yields [] and the review falls
        // back, which is why this isn't guarded by a try/catch that aborts.
        let frames: Awaited<ReturnType<typeof extractVideoFrames>> = [];
        if (analysisEnabled) {
          setStage("reading");
          setReadProgress(0);
          frames = await extractVideoFrames(file, {
            onProgress: setReadProgress,
          });
        }

        setStage("uploading");
        const formData = new FormData();
        formData.append("video", file);
        formData.append("frames", JSON.stringify(frames));
        if (jerseyColor.trim()) formData.append("jerseyColor", jerseyColor.trim());
        if (jerseyNumber.trim()) formData.append("jerseyNumber", jerseyNumber.trim());

        const response = await fetch("/api/game-footage/upload", {
          method: "POST",
          body: formData,
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error?.message ?? "Upload failed.");
        }
        router.push(`/analyze/game-film/${body.data.analysisId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setStage("idle");
      }
    });
  }

  const label =
    stage === "reading"
      ? `Reading your clip... ${Math.round(readProgress * 100)}%`
      : stage === "uploading"
        ? "Uploading..."
        : "Upload and review";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload game footage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="game-video">Game clip</Label>
          <Input
            id="game-video"
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            A full game or a long stretch of possessions works best. Up to
            250MB.
          </p>
        </div>

        {/* A game clip has ten players in it. Without this the review is about
            someone, but not necessarily about you. */}
        {analysisEnabled && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Which player are you?</legend>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Your jersey colour"
                placeholder="Jersey colour"
                value={jerseyColor}
                disabled={busy}
                onChange={(e) => setJerseyColor(e.target.value)}
              />
              <Input
                aria-label="Your jersey number"
                placeholder="Number"
                value={jerseyNumber}
                disabled={busy}
                onChange={(e) => setJerseyNumber(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Without this we often can&apos;t tell which player on the court is
              you, and the review will say so rather than guess.
            </p>
          </fieldset>
        )}

        <Button className="w-full" disabled={busy} onClick={handleUpload}>
          <Upload className="size-4" />
          {label}
        </Button>

        {/* Set expectations before the upload, not after it. */}
        <p className="text-xs italic text-muted-foreground">
          {analysisEnabled
            ? "We take a set of still frames from your clip and have an AI model read them. It can misread what it sees, so treat the review as a second opinion rather than a verdict."
            : "Footage analysis isn't switched on here, so your review will be built from your profile - position, level and the skills you chose to focus on - rather than from anything in the video."}
        </p>
      </CardContent>
    </Card>
  );
}
