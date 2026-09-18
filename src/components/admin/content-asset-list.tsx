"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { MediaSourceChip } from "@/components/content/media-disclosure";
import {
  attachAssetToFeedItemAction,
  setAssetClearanceAction,
} from "@/server/actions/adminContentActions";
import type { ContentAssetView } from "@/server/services/adminContentService";

/**
 * The inventory - the human-facing half of "every piece of content shipped
 * has a traceable, legitimate source" (BRD 7.14).
 *
 * Uncleared rows lead, because they are the ones that need a decision. The
 * publish control is deliberately disabled until rights are cleared rather
 * than hidden: the admin should see that publishing is possible and what is
 * blocking it.
 */
export function ContentAssetList({
  assets,
  attachTargets,
}: {
  assets: ContentAssetView[];
  attachTargets: { id: string; title: string; hasMedia: boolean }[];
}) {
  const ordered = [...assets].sort(
    (a, b) => Number(a.cleared) - Number(b.cleared),
  );

  return (
    <div className="space-y-3">
      {ordered.map((asset) => (
        <AssetRow key={asset.id} asset={asset} attachTargets={attachTargets} />
      ))}
    </div>
  );
}

function AssetRow({
  asset,
  attachTargets,
}: {
  asset: ContentAssetView;
  attachTargets: { id: string; title: string; hasMedia: boolean }[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState(attachTargets[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  function toggleClearance() {
    startTransition(async () => {
      try {
        const { cleared } = await setAssetClearanceAction(asset.id, !asset.cleared);
        toast.success(cleared ? "Rights cleared." : "Clearance withdrawn.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update that.");
      }
    });
  }

  function publish() {
    if (!target) return;
    startTransition(async () => {
      try {
        await attachAssetToFeedItemAction(asset.id, target);
        toast.success("Published to the feed.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't publish that.");
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <MediaSourceChip disclosure={asset.disclosure} />
            <Badge variant={asset.cleared ? "success" : "warning"}>
              {asset.cleared ? "Rights cleared" : "Awaiting clearance"}
            </Badge>
            {asset.durationSeconds !== null && (
              <Badge variant="secondary">
                {Math.round(asset.durationSeconds)}s
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={asset.cleared ? "ghost" : "default"}
            onClick={toggleClearance}
            disabled={isPending}
          >
            {asset.cleared ? "Withdraw clearance" : "Clear rights"}
          </Button>
        </div>

        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <Fact label="Rights holder" value={asset.rightsHolder} />
          <Fact label="Credit shown" value={asset.attribution ?? "None"} />
          <Fact label="Licence terms" value={asset.licenseNotes ?? "None recorded"} />
          <Fact label="Source" value={asset.sourceUrl ?? "Uploaded directly"} />
        </dl>

        {!asset.cleared && asset.pendingReason && (
          <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {asset.pendingReason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <NativeSelect
            aria-label="Library card to publish to"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="max-w-[18rem] flex-1"
          >
            {attachTargets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {item.hasMedia ? " (has a clip)" : ""}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            onClick={publish}
            disabled={isPending || !asset.cleared || !target}
            // Disabled rather than hidden, so the blocker is visible.
            title={
              asset.cleared
                ? "Publish this clip to the selected card"
                : "Clear the rights first"
            }
          >
            <Check className="size-4" />
            Publish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
