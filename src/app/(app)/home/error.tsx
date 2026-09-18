"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * Home builds the day's cards on the first view of each day - a Mongo write
 * and, when OPENAI_API_KEY is set, one copy-writer call. It's the most work
 * behind any render in the app, which is why it has the repo's only
 * `loading.tsx`, and this is the other half of that: the feed failing must not
 * cost the player the workout that's already sitting in Train.
 */
export default function HomeError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Today's feed didn't load"
      description="Your training history is safe - this is only the screen built from it. Try again, or go straight to today's workout."
      back={{ href: "/train", label: "Go to Train" }}
    />
  );
}
