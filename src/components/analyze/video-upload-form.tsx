"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadSessionVideo } from "@/lib/shot-session-upload";

export function VideoUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpload() {
    if (!file) {
      toast.error("Choose a video file first.");
      return;
    }

    startTransition(async () => {
      try {
        const sessionId = await uploadSessionVideo(file);
        router.push(`/analyze/shooting/${sessionId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload a shooting clip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="video-file">Video file</Label>
          <Input
            id="video-file"
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          After uploading, play the clip and tap the court where each shot
          happens - that logs a real shot with its exact video moment.
        </p>
        <Button className="w-full" disabled={isPending || !file} onClick={handleUpload}>
          <Upload className="size-4" />
          {isPending ? "Uploading..." : "Upload & Start Logging"}
        </Button>
      </CardContent>
    </Card>
  );
}
