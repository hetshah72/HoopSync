import Link from "next/link";
import { Compass } from "lucide-react";

import { ErrorState } from "@/components/layout/error-state";
import { buttonVariants } from "@/components/ui/button";

/**
 * Every URL that matches no route at all.
 *
 * Signed-out visitors rarely reach it: the proxy redirects them to
 * `/sign-in?callbackUrl=<the bad path>` first, and `resolveCallbackPath` hands
 * that path back after they sign in - at which point this is the screen that
 * catches them. So the copy can't assume a signed-in reader, and unlike
 * `(app)/not-found.tsx` there's no shell here, so it carries its own way out.
 */
export default function NotFound() {
  return (
    <main className="ambient-canvas flex flex-1 items-center justify-center px-4 py-16">
      <ErrorState
        className="bg-card w-full max-w-md"
        icon={Compass}
        title="There's nothing at that address"
        description="The link may be out of date, or the page may have moved. Home is the fastest way back into your training."
        actions={
          <Link href="/home" className={buttonVariants({ variant: "brand" })}>
            Back to Home
          </Link>
        }
      />
    </main>
  );
}
