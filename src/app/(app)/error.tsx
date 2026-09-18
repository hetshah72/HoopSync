"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * The catch-all for every signed-in screen.
 *
 * It renders *inside* `(app)/layout.tsx`, so the rail, the top bar and the tab
 * bar all survive - a player whose Progress screen failed can still tap
 * straight into Train. That also means it declares no chrome of its own; the
 * layout's <main> already supplies the measure and the gutters.
 *
 * What it does NOT catch is `(app)/layout.tsx` itself: an error boundary never
 * wraps the layout in its own segment. Since that layout does a MongoDB read on
 * every single app page, a database outage bubbles past this to
 * `src/app/error.tsx` - which is why that file exists too.
 */
export default function AppError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
