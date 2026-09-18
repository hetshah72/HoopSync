"use client";

import { RouteError } from "@/components/layout/route-error";

/**
 * The boundary above the app shell. It catches what `(app)/error.tsx` can't:
 * `(app)/layout.tsx` throwing (it reads the player's profile from MongoDB on
 * every app page, so this is the database-is-down screen), plus `/onboarding`,
 * `/sign-in` and `/sign-up`.
 *
 * It still renders inside the root layout, so it has the fonts, the tokens and
 * the Toaster - but no header and no nav, because none of those exist at this
 * level. Hence the ambient wash and the centred card: without them this is a
 * paragraph alone in the top-left corner.
 *
 * `flex-1` works because the root layout's <body> is already
 * `flex min-h-full flex-col`.
 */
export default function RootError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="ambient-canvas flex flex-1 items-center justify-center px-4 py-16">
      <RouteError
        {...props}
        title="HoopSync isn't loading"
        description="We couldn't reach your training data. Nothing you've logged is lost - try again, and if it keeps failing it's on our side, not yours."
        back={{ href: "/sign-in", label: "Sign in again" }}
        className="bg-card w-full max-w-md"
      />
    </main>
  );
}
