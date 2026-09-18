"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTENT_ACCEPT,
  CONTENT_DURATION_MESSAGE,
  CONTENT_MAX_BYTES,
  CONTENT_MAX_DURATION_SECONDS,
  CONTENT_SIZE_MESSAGE,
  INGESTIBLE_CONTRIBUTORS,
  INGESTIBLE_SOURCES,
  clearsOnIngest,
  pendingClearanceReason,
  requiresLicenseNotes,
} from "@/lib/content-ingest";
import {
  MEDIA_CONTRIBUTOR_LABELS,
  MEDIA_SOURCE_LABELS,
} from "@/lib/media-provenance";
import type { MediaAssetContributor, MediaAssetSource } from "@/types/db";

/**
 * Taking delivery of a clip (BRD 7.14).
 *
 * The rights questions are on the same form as the file rather than a later
 * step, because "we'll fill that in afterwards" is how an asset ends up in the
 * database with nothing recorded about where it came from.
 *
 * Duration is read from the file in the browser and sent along - there is no
 * server-side probe in this app - so the cap is enforced here first and
 * re-checked by the Zod schema. It is a content guardrail, not a security
 * boundary, and `src/lib/content-ingest.ts` says so.
 */
export function ContentIngestForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [source, setSource] = useState<MediaAssetSource>("generated");
  const [contributor, setContributor] =
    useState<MediaAssetContributor>("hoopsync");
  const [isPending, startTransition] = useTransition();

  async function readDuration(file: File): Promise<number | undefined> {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(Number.isFinite(video.duration) ? video.duration : undefined);
      };
      video.onerror = () => resolve(undefined);
      video.src = URL.createObjectURL(file);
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("clip");

    if (!(file instanceof File) || file.size === 0) {
      toast.error("Choose a clip to upload.");
      return;
    }
    if (file.size > CONTENT_MAX_BYTES) {
      toast.error(CONTENT_SIZE_MESSAGE);
      return;
    }

    startTransition(async () => {
      const duration = await readDuration(file);
      if (duration !== undefined) {
        if (duration > CONTENT_MAX_DURATION_SECONDS) {
          toast.error(CONTENT_DURATION_MESSAGE);
          return;
        }
        data.set("durationSeconds", String(Math.round(duration)));
      }

      const response = await fetch("/api/admin/content", {
        method: "POST",
        body: data,
      });
      const body = await response.json();
      if (!response.ok) {
        toast.error(body?.error?.message ?? "Upload failed.");
        return;
      }

      toast.success(
        clearsOnIngest(contributor)
          ? "Clip added and cleared - it's live on the feed."
          : "Clip added. Clear its rights below to publish it.",
      );
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a clip</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clip">Video file</Label>
            <Input id="clip" name="clip" type="file" accept={CONTENT_ACCEPT} required />
            <p className="text-xs text-muted-foreground">
              {CONTENT_MAX_DURATION_SECONDS} seconds or shorter - the feed is
              short-form.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="source">Rights basis</Label>
              <NativeSelect
                id="source"
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value as MediaAssetSource)}
              >
                {INGESTIBLE_SOURCES.map((value) => (
                  <option key={value} value={value}>
                    {MEDIA_SOURCE_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contributor">Who supplied it</Label>
              <NativeSelect
                id="contributor"
                name="contributor"
                value={contributor}
                onChange={(e) =>
                  setContributor(e.target.value as MediaAssetContributor)
                }
              >
                {INGESTIBLE_CONTRIBUTORS.map((value) => (
                  <option key={value} value={value}>
                    {MEDIA_CONTRIBUTOR_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                {pendingClearanceReason(contributor)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rightsHolder">Rights holder</Label>
            <Input
              id="rightsHolder"
              name="rightsHolder"
              required
              placeholder="HoopSync"
              maxLength={200}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="attribution">Credit line (optional)</Label>
              <Input
                id="attribution"
                name="attribution"
                placeholder="Courtesy of ..."
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                Shown to players under the clip.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sourceUrl">Where it came from (optional)</Label>
              <Input
                id="sourceUrl"
                name="sourceUrl"
                type="url"
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="licenseNotes">
              Licence terms{requiresLicenseNotes(source) ? "" : " (optional)"}
            </Label>
            <Textarea
              id="licenseNotes"
              name="licenseNotes"
              rows={2}
              required={requiresLicenseNotes(source)}
              placeholder={
                requiresLicenseNotes(source)
                  ? "Contract reference, licence type, permitted uses..."
                  : "Anything worth recording about permissions."
              }
            />
            {requiresLicenseNotes(source) && (
              <p className="text-xs text-muted-foreground">
                Required for {MEDIA_SOURCE_LABELS[source].toLowerCase()} - it is
                what makes the rights traceable.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Card title</Label>
            <Input id="title" name="title" required maxLength={120} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">What the clip shows</Label>
            <Textarea id="body" name="body" rows={2} required maxLength={500} />
          </div>

          <Button type="submit" disabled={isPending} className="w-full">
            <Upload className="size-4" />
            {isPending ? "Uploading…" : "Add clip"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
