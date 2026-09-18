"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Circle, Square, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_SESSION_VIDEO_BYTES,
  MAX_SESSION_VIDEO_LABEL,
  uploadSessionVideo,
} from "@/lib/shot-session-upload";

/**
 * Recording a session inside the app (BRD 7.5: "Player records themselves
 * shooting from within the app").
 *
 * The recording is only the footage. Every shot on it is still entered by the
 * player tapping the court afterwards - nothing here detects anything, which
 * is the whole point of BRD v1.1 §5's manual tap-to-log decision.
 *
 * Browsers disagree about container support - Safari records MP4, Chrome and
 * Firefox record WebM - so the codec is negotiated rather than assumed, and
 * anything without MediaRecorder (or without camera permission) falls back to
 * the upload path instead of showing a button that cannot work.
 */

/** Most-preferred first. Safari takes the mp4 entry, Chrome/Firefox a webm. */
const PREFERRED_MIME_TYPES = [
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

/** Matches videoStorageService.extensionFor, which keys off the same string. */
function extensionFor(mimeType: string): string {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type Phase = "idle" | "ready" | "recording" | "uploading" | "blocked";

export function SessionRecorder() {
  const router = useRouter();
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  // Releasing the camera on unmount matters for real hardware: without it the
  // capture light stays on after the player navigates away.
  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function startCamera() {
    if (!pickMimeType()) {
      setBlockedReason(
        "This browser can't record video. Upload a clip below instead.",
      );
      setPhase("blocked");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera on a phone propped up at the court - the framing this
        // feature actually gets used in.
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => {
          // A blocked autoplay on the preview isn't fatal - the stream is live.
        });
      }
      setPhase("ready");
    } catch {
      // Denial and "no camera attached" are the same dead end for the player,
      // and both have the same answer: upload instead.
      setBlockedReason(
        "No camera access. Grant permission and try again, or upload a clip below.",
      );
      setPhase("blocked");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (!stream || !mimeType) return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => void handleRecordingStopped(mimeType);

    recorderRef.current = recorder;
    // A timeslice keeps chunks arriving during the recording rather than only
    // at stop, so a long session doesn't sit entirely in one buffer.
    recorder.start(1000);
    setElapsed(0);
    setPhase("recording");
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setPhase("uploading");
  }

  async function handleRecordingStopped(mimeType: string) {
    stopStream();

    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    if (blob.size === 0) {
      toast.error("That recording came out empty - try again.");
      setPhase("idle");
      return;
    }
    if (blob.size > MAX_SESSION_VIDEO_BYTES) {
      toast.error(
        `That recording is over ${MAX_SESSION_VIDEO_LABEL}. Record a shorter session, or upload a compressed clip.`,
      );
      setPhase("idle");
      return;
    }

    // The explicit `type` is load-bearing: the upload route accepts only
    // files whose type starts with "video/", and a File built from a Blob
    // without it arrives as application/octet-stream.
    const file = new File(
      [blob],
      `shooting-session-${Date.now()}.${extensionFor(mimeType)}`,
      { type: mimeType },
    );

    try {
      const sessionId = await uploadSessionVideo(file);
      router.push(`/analyze/shooting/${sessionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
      setPhase("idle");
    }
  }

  if (phase === "blocked") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <VideoOff className="size-4" />
            Record a session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{blockedReason}</p>
          {/* On a phone this opens the native camera app, which is a real
              recording path even where MediaRecorder isn't available. */}
          <div className="space-y-1.5">
            <Label htmlFor="camera-capture">Record with your camera app</Label>
            <Input
              id="camera-capture"
              type="file"
              accept="video/*"
              capture="environment"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPhase("uploading");
                try {
                  const sessionId = await uploadSessionVideo(file);
                  router.push(`/analyze/shooting/${sessionId}`);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Upload failed.",
                  );
                  setPhase("blocked");
                }
              }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="size-4" />
          Record a session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <video
            ref={previewRef}
            muted
            playsInline
            autoPlay
            className="aspect-video w-full rounded-lg bg-black object-cover"
          />
          {phase === "recording" && (
            <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground">
              <Circle className="size-2 animate-pulse fill-current" />
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>

        {phase === "idle" && (
          <>
            <p className="text-xs text-muted-foreground">
              Prop your phone up so the hoop and your feet are both in frame.
              You&apos;ll tap-log each shot once you stop recording.
            </p>
            <Button className="w-full" onClick={startCamera}>
              <Video className="size-4" />
              Turn on camera
            </Button>
          </>
        )}

        {phase === "ready" && (
          <Button className="w-full" onClick={startRecording}>
            <Circle className="size-4 fill-current" />
            Start recording
          </Button>
        )}

        {phase === "recording" && (
          <Button variant="destructive" className="w-full" onClick={stopRecording}>
            <Square className="size-4 fill-current" />
            Stop &amp; start logging
          </Button>
        )}

        {phase === "uploading" && (
          <Button className="w-full" disabled>
            Uploading...
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
