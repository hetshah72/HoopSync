import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { FormAlert } from "@/components/auth/auth-fields";
import { buttonVariants } from "@/components/ui/button";
import { describeAuthPageError } from "@/lib/auth-errors";

/**
 * Auth.js's built-in "Server error" page, replaced.
 *
 * Auth.js sends every failure whose `kind` isn't "signIn" here (see
 * `pages.error` in `src/server/auth/auth.config.ts`): a provider that won't
 * configure, an adapter that can't reach MongoDB, a sign-out that failed.
 * Sign-in failures keep going to `/sign-in?error=`, where the message belongs
 * beside the form the player is about to retry - don't move them here.
 *
 * Three constraints on this file, all load-bearing:
 *
 * 1. It imports nothing from `src/server/**` and is not a Client Component.
 *    The most likely reason anyone is here is that auth or the database is
 *    broken; a page that depended on either would fail alongside it and leave
 *    the player with a blank screen, which is worse than the unbranded page
 *    this replaces.
 * 2. It never renders the raw `?error=` value. Auth.js passes that parameter
 *    through untouched from `/api/auth/error`, so it is attacker-controlled.
 *    React escapes it, so the risk isn't script injection - it's that anyone
 *    could put "Your account is suspended, call 1-800-..." on a real HoopSync
 *    URL under the HoopSync logo. The parameter selects copy we wrote; it is
 *    never itself copy, and it never builds an href.
 * 3. It must stay reachable signed out - see PUBLIC_PATHS in `src/proxy.ts`.
 */

export const metadata: Metadata = {
  title: "Sign-in problem",
  // This page answers to a query string, so without this every `?error=`
  // variant is a separately crawlable URL - and none of them should ever be a
  // search result for "HoopSync".
  robots: { index: false, follow: false },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  // Hand-written rather than `PageProps<"/auth/error">`, matching both auth
  // pages: the generated route types don't know about a new route until
  // typegen reruns, and `npm run typecheck` is a bare `tsc --noEmit`.
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { title, description, reason } = describeAuthPageError(error);

  return (
    <AuthShell>
      <div className="space-y-1.5">
        {/* `h2`, not `h1` - AuthShell's brand panel owns the `h1`, so this
            matches the sign-in and sign-up screens exactly. */}
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <div className="mt-8 space-y-5">
        <FormAlert message={reason} />

        <Link
          href="/sign-in"
          className={buttonVariants({
            variant: "brand",
            size: "lg",
            className: "w-full rounded-xl",
          })}
        >
          Back to sign in
        </Link>

        <p className="text-muted-foreground text-center text-sm">
          Don&apos;t have an account yet?{" "}
          <Link
            href="/sign-up"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
