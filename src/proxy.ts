import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/server/auth/auth.config";

/**
 * The proxy's own NextAuth instance, built from the database-free config.
 *
 * Deliberately not the instance exported from `@/server/auth/auth` - that one
 * carries the Mongo adapter, and this matcher runs on every route, so a
 * database that fails to configure would 500 the entire app rather than one
 * page. This instance only ever runs the `session` action, which on the JWT
 * strategy decodes the cookie and never reads the adapter.
 */
const { auth } = NextAuth(authConfig);

/**
 * Matched as prefixes, so each entry is a full path rather than a parent of
 * one - `"/auth"` would silently make every future `/auth/*` route public.
 *
 * `/auth/error` is Auth.js's `pages.error` target and has to be reachable
 * signed out: it is, by definition, where someone whose sign-in just failed
 * ends up. Gating it would bounce them to `/sign-in?callbackUrl=/auth/error`,
 * and Auth.js refuses to use an error page it was asked to authenticate -
 * it logs ErrorPageLoop and falls back to its own unbranded page, which is
 * the exact screen that route exists to replace.
 */
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth/error"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api/auth");

  if (!req.auth && !isPublic) {
    // API routes should get a JSON 401, not a redirect to an HTML page -
    // API clients don't follow redirects the way a browser page nav does.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "You must be signed in." } },
        { status: 401 },
      );
    }
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    // Carry the query string too, or a player bounced from
    // `/analyze/game-film?tab=report` comes back to the wrong tab.
    signInUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except static assets, images, and Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
