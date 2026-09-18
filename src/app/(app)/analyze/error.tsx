"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * Covers `/analyze`, `/analyze/shooting/*` and `/analyze/game-film/*`.
 *
 * The reassurance is the point: a player who just logged a session and hit this
 * needs to know the shots they tapped are already stored, and that only the
 * screen reading them back failed.
 */
export default function AnalyzeError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="That analysis didn't load"
      description="Your logged shots and uploaded clips are still saved. Try again, or head back to Analyze and reopen it."
      back={{ href: "/analyze", label: "Back to Analyze" }}
    />
  );
}
