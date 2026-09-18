/**
 * Human copy for the `?error=` codes Auth.js redirects back to `/sign-in`
 * with. Without this the player is returned to a blank form with no hint
 * that anything went wrong - the failure is in the URL and nowhere else.
 *
 * Isomorphic on purpose: the sign-in page renders it on the server.
 */
export function describeAuthError(
  code: string | undefined,
): string | undefined {
  if (!code) return undefined;

  switch (code) {
    /**
     * The email on the OAuth account already belongs to an account here that
     * was created another way. Auth.js refuses to link them automatically,
     * and that's the right call - it would otherwise let anyone who can get
     * an OAuth token for an address take over the existing account. So the
     * copy points at the method that does work rather than at a retry that
     * will fail the same way.
     */
    case "OAuthAccountNotLinked":
      return "That email already has a HoopSync account. Sign in the way you set it up - with your password below, or with the provider you used the first time.";
    case "CredentialsSignin":
      return "Incorrect email or password.";
    case "Verification":
      return "That sign-in link has expired or was already used. Request a new one below.";
    case "EmailSignInError":
      return "We couldn't send that sign-in link. Please try again.";
    case "OAuthSignInError":
    case "OAuthCallbackError":
      return "That sign-in didn't complete. Please try again.";
    case "AccessDenied":
      return "You don't have access to HoopSync with that account.";
    /**
     * Auth.js collapses almost every non-client-safe failure into this one
     * code - a provider that won't configure, an adapter that can't reach
     * Mongo, an OAuth callback that came back malformed. So the copy can't
     * claim a misconfiguration; all it honestly knows is that the failure
     * isn't the player's and isn't one they can fix.
     */
    case "Configuration":
      return "That sign-in didn't finish, and it's on our side rather than yours. Try again in a minute, or use your email and password.";
    default:
      return "We couldn't sign you in. Please try again.";
  }
}

/**
 * The same job as `describeAuthError`, for the failures that land on
 * `/auth/error` rather than back on the sign-in form.
 *
 * A different shape because this is a whole screen and not a strip above a
 * form: it gets a heading, a sentence saying what to do next, and - only where
 * we actually know something - one line naming the cause.
 *
 * Deliberately a second map rather than a widened `describeAuthError`. That
 * one returns a single sentence rendered *inside* the sign-in form and points
 * at controls on that page ("with your password below", "Request a new one
 * below") - wording that is simply false on a page with no form on it.
 * Widening it would also churn both auth pages for no gain.
 */
export type AuthErrorPageCopy = {
  /** The heading. Never names a server internal. */
  title: string;
  /** What to do next. */
  description: string;
  /** The one-line cause, where naming it helps. Omitted where it wouldn't. */
  reason?: string;
};

export function describeAuthPageError(
  code: string | undefined,
): AuthErrorPageCopy {
  switch (code) {
    /**
     * The catch-all. Auth.js masks adapter failures, a missing AUTH_SECRET, an
     * untrusted host, a network blip reaching the provider and an ordinary
     * cancelled Google consent all as "Configuration", on purpose, so that
     * nothing about the server's internals reaches the browser. The copy has
     * to stay inside that boundary: it can say whose fault it is and no more.
     * The real cause is in the server log, where Auth.js already put it.
     */
    case "Configuration":
      return {
        title: "That sign-in didn't finish",
        description:
          "This one's on us, not on your account. Nothing was changed and nothing was saved. Give it a minute and try again, or sign in with your email and password.",
        reason: "The sign-in service couldn't complete that request.",
      };
    case "AccessDenied":
      return {
        title: "That account can't sign in",
        description:
          "Try again with a different account, or create one with your email address.",
        reason: "Access was denied for the account you chose.",
      };
    case "Verification":
      return {
        title: "That link has expired",
        description:
          "Sign-in links work once and then stop. Start again from the sign-in screen to get a fresh one.",
      };
    case "WebAuthnVerificationError":
      return {
        title: "That passkey didn't verify",
        description:
          "Your device couldn't confirm the passkey. Try again, or sign in with your email and password.",
      };
    /**
     * The codes below are `SignInError` kinds, so Auth.js routes them to
     * `pages.signIn` and `describeAuthError` handles them under the form.
     * They're here because `/api/auth/error?error=<code>` redirects here with
     * whatever it was given, and a stale link or a bookmark is enough.
     */
    case "OAuthAccountNotLinked":
    case "AccountNotLinked":
      return {
        title: "That email is already in use",
        description:
          "That email already has a HoopSync account set up another way. Sign in the way you created it - with your password, or with the provider you used the first time.",
      };
    case "OAuthSignInError":
    case "OAuthCallbackError":
      return {
        title: "That sign-in didn't finish",
        description:
          "The hand-off back from your provider didn't complete. Try again, or use your email and password instead.",
      };
    case "CredentialsSignin":
      return {
        title: "We couldn't sign you in",
        description:
          "That email and password didn't match an account. Head back and check both.",
      };
    case "MissingCSRF":
      return {
        title: "That form timed out",
        description:
          "The sign-in page sat open long enough for its security token to expire. Start again from a fresh sign-in screen.",
      };
    default:
      return {
        title: "Something went wrong",
        description:
          "We couldn't finish that sign-in, and the reason didn't reach this page. Head back and try again.",
      };
  }
}
