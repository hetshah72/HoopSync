"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * Covers `/coach` and `/coach/[conversationId]`. Coach reaches an external
 * model, so it fails in ways the rest of the app doesn't - a timeout mid-reply
 * is a normal outcome here, not a broken install.
 */
export default function CoachError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Coach didn't load"
      description="Your conversations are saved. Try again - if Coach stays quiet, it's on our side and nothing you've asked has been lost."
      back={{ href: "/coach", label: "Your conversations" }}
    />
  );
}
