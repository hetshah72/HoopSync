"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncRosterAction } from "@/server/actions/adminActions";

/**
 * Triggers the balldontlie roster sync (BRD 7.4).
 *
 * Reports the real counts rather than "done": `matched` is the number that
 * actually matters, because that is hand-authored editorial being adopted by a
 * real roster record instead of duplicated into a second player.
 *
 * The sync walks the whole league behind a rate limiter, so this can take a
 * while - the button stays disabled for the duration rather than letting an
 * impatient second click start a competing run.
 */
export function RosterSyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      try {
        const result = await syncRosterAction();
        toast.success(
          `Synced ${result.fetched} players: ${result.created} new, ${result.matched} matched to existing editorial, ${result.skipped} skipped.`,
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "The roster sync failed.",
        );
      }
    });
  }

  return (
    <Button onClick={handleSync} disabled={isPending} size="sm" variant="outline">
      <RefreshCw className={isPending ? "size-4 animate-spin" : "size-4"} />
      {isPending ? "Syncing..." : "Sync roster"}
    </Button>
  );
}
