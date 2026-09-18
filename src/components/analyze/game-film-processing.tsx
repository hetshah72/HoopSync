"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";

const POLL_INTERVAL_MS = 3_000;
/** Past this we stop asking and let the player decide what to do. */
const MAX_POLLS = 60;

/**
 * Waits for a Game Film analysis to finish.
 *
 * The analysis runs after the upload response (see the upload route's
 * `after()` call), so the report screen can render before there is anything to
 * show. Rather than telling the player to refresh - which is what this screen
 * used to do - it asks the status endpoint until the status leaves
 * `processing`, then refreshes the RSC tree so the finished report renders
 * server-side as usual.
 *
 * Deliberately a small poll rather than React Query: nothing else in this
 * codebase uses it, and one screen waiting on one boolean doesn't justify
 * introducing a second data-fetching model.
 */
export function GameFilmProcessing({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;

    const timer = setInterval(async () => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(timer);
        if (!cancelled) setGaveUp(true);
        return;
      }

      try {
        const response = await fetch(
          `/api/game-footage/${analysisId}/status`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = await response.json();
        if (!cancelled && body?.data?.status && body.data.status !== "processing") {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // A dropped poll is not worth surfacing - the next one will try again.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [analysisId, router]);

  return (
    <EmptyState
      icon={LoaderCircle}
      title={gaveUp ? "This is taking longer than usual" : "Reviewing your clip"}
      description={
        gaveUp
          ? "Your upload is saved. Check back from the Game Film screen in a minute."
          : "We're reading through your footage now. This page will update on its own."
      }
      action={
        <Link
          href="/analyze/game-film"
          className={buttonVariants({ variant: "outline" })}
        >
          Back to Game Film
        </Link>
      }
    />
  );
}
