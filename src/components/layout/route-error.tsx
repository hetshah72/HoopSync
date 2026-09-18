"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { ErrorState } from "@/components/layout/error-state";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * The body of every `error.tsx` in the app, so adding a segment boundary is six
 * lines of copy rather than a fresh opinion about what a broken screen looks
 * like.
 *
 * `retry`, never `reset`. Next 16 passes both, but `reset` only clears the
 * boundary's local state and re-renders the same tree - for the failure that
 * actually happens here (a Server Component fetch that threw) it re-renders
 * the identical broken output and the player presses a button that visibly
 * does nothing. `retry` re-fetches inside a transition, and is the only one of
 * the two that can recover a server render.
 *
 * The `console.error` is for the browser console during development. It is
 * *not* how server errors get recorded: in a production build the `error` this
 * receives has been redacted to a generic message plus `digest`. The real stack
 * is already on the server - see `onRequestError` in `src/instrumentation.ts` -
 * and the digest shown on screen is what joins the two.
 */
export function RouteError({
  error,
  retry,
  title = "This screen didn't load",
  description = "Something went wrong on our side, not yours. Try again - if it keeps happening, head back and pick up from there.",
  back = { href: "/home", label: "Back to Home" },
  className,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: string;
  back?: { href: string; label: string };
  className?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      icon={TriangleAlert}
      title={title}
      description={description}
      digest={error.digest}
      className={className}
      actions={
        <>
          <Button variant="brand" onClick={() => retry()}>
            Try again
          </Button>
          {/* Always a second, navigational way out: if the cause is permanent
              (a database that's down), "Try again" renders the same error and
              the player would otherwise be stuck on this screen. */}
          <Link
            href={back.href}
            className={buttonVariants({ variant: "outline" })}
          >
            {back.label}
          </Link>
        </>
      }
    />
  );
}
