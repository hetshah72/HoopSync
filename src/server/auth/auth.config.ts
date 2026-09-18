import "server-only";
import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/types/db";

/**
 * The half of the Auth.js config that carries no database.
 *
 * `src/proxy.ts` builds its own NextAuth instance from this rather than
 * importing the one in `auth.ts`. That matters because the proxy matcher
 * covers every route, so anything that throws while this module is being
 * *evaluated* takes the entire app with it - including the /auth/error page
 * whose whole job is to explain the failure. Keeping the adapter and the
 * Credentials `authorize` (which reaches authService -> repositories -> the
 * Mongo client) over in `auth.ts` means the proxy's import graph never touches
 * the driver at all.
 *
 * Safe to split because the proxy only ever runs the `session` action, and on
 * the JWT strategy that action decodes the cookie and returns before it ever
 * reads the adapter.
 *
 * One rule for anyone editing this: nothing cookie-affecting (`useSecureCookies`,
 * `cookies`) may be set on only one of the two instances. The session-cookie
 * name is the HKDF salt for the JWT, so a mismatch means neither instance can
 * decrypt the other's token and every player silently appears signed out.
 * Set it here, where both share it, or in neither.
 */

/**
 * Admin allow-list, comma-separated, from ADMIN_EMAILS.
 *
 * Without this nothing ever assigned the "admin" role, so the one
 * admin-gated action (POST /api/nba-players/sync) was unreachable for every
 * account, forever - a real code gap, not a config one. An env allow-list is
 * the smallest thing that closes it; a proper admin dashboard with role
 * management is explicitly Phase 2 (BRD 6.2).
 */
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function resolveRole(
  email: string | null | undefined,
  storedRole?: Role,
): Role {
  if (email && ADMIN_EMAILS.has(email.toLowerCase())) return "admin";
  return storedRole ?? "player";
}

export const authConfig = {
  /**
   * JWT (not database) sessions, for two reasons: the proxy checks auth state
   * on every request and a signed cookie needs no round trip to do it, and
   * the Credentials provider in `auth.ts` cannot issue a database session at
   * all - Auth.js only persists sessions for adapter-managed sign-ins.
   *
   * The adapter in `auth.ts` still persists users and OAuth accounts.
   *
   * Stated explicitly rather than left to the adapter-presence default so both
   * instances also agree on `jwt.maxAge`: the proxy re-signs the session cookie
   * on every request, so a mismatch would quietly reset everyone's expiry.
   */
  session: { strategy: "jwt" },

  /**
   * Empty on purpose - the proxy never signs anyone in, and Auth.js has no
   * minimum-provider assertion. `auth.ts` owns all of them.
   *
   * Sharing provider *instances* between two NextAuth() calls would not be
   * safe: Auth.js shallow-spreads each provider and then deep-merges into it
   * in place, so both instances would be mutating one shared object graph on
   * every request.
   */
  providers: [],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        // A Google sign-in carries no role at all, so resolve against the
        // allow-list rather than trusting whatever the provider handed back;
        // the password provider's stored role is honoured when it has one, so
        // an account promoted in the database keeps its promotion.
        token.role = resolveRole(user.email, (user as { role?: Role }).role);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },

  /**
   * Both callbacks live here rather than in `auth.ts`, and the `jwt` one is
   * load-bearing for the proxy: reading a session re-encodes and re-issues the
   * cookie, and the proxy copies those Set-Cookie headers onto its response.
   * If the two instances' `jwt` callbacks ever diverged, the proxy would
   * rewrite every player's cookie on every request. Omitting `session` would
   * also leave `req.auth.user` missing `id`/`role` for anyone who later reads
   * more than truthiness off it.
   */
  pages: {
    signIn: "/sign-in",
    /**
     * Everything that isn't a sign-in *attempt* - a provider that won't
     * configure, an adapter that can't reach Mongo, a failed sign-out - lands
     * on our page instead of Auth.js's unstyled "Server error" screen.
     * Sign-in failures keep going to `/sign-in?error=`, where the message
     * belongs beside the form the player is about to retry.
     *
     * Root-relative on purpose: Auth.js builds the redirect as
     * `${origin}${pages.error}` with no normalisation.
     *
     * This route must stay in PUBLIC_PATHS (`src/proxy.ts`) and stay rejected
     * by `resolveCallbackPath` (`src/lib/validation/auth.ts`). If Auth.js ever
     * sees a callbackUrl pointing back here it assumes a redirect loop, logs
     * ErrorPageLoop and renders its built-in page instead - the exact screen
     * this exists to replace.
     */
    error: "/auth/error",
  },
} satisfies NextAuthConfig;
