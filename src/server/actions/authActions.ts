"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth/auth";
import { registerWithPassword } from "@/server/services/authService";
import {
  signInSchema,
  signUpSchema,
  type SignInInput,
  type SignUpInput,
} from "@/lib/validation/auth";
import { ConflictError } from "@/server/errors";

/**
 * Sign-up and sign-in for email/password accounts.
 *
 * Two deliberate departures from the shape of the other actions here:
 *
 * 1. They *return* failures instead of throwing them. Next.js redacts the
 *    message of an error thrown out of a Server Action in a production
 *    build, replacing it with a generic digest - so "Incorrect email or
 *    password" would reach the player as "an error occurred" in the only
 *    build that matters. These failures are expected outcomes of a form, not
 *    exceptions, and the caller needs the real message and the field it
 *    belongs to. Anything genuinely unexpected (database down) still throws.
 *
 * 2. They don't `redirect()`. The client forms await these inside a
 *    try/catch, and NEXT_REDIRECT thrown from here would land in that catch
 *    and report a successful sign-in as a failure (same reasoning as
 *    `saveProfile` in profileActions). `signIn(..., { redirect: false })`
 *    still writes the session cookie - it only skips the redirect - so
 *    navigation is left to the caller.
 */
export type AuthResult =
  | { ok: true }
  | { ok: false; field: "email" | "password" | "root"; message: string };

export async function signUpWithPassword(
  input: SignUpInput,
): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    // The form validates with this same schema before submitting, so getting
    // here means the client was bypassed - no need to itemize the problems.
    return {
      ok: false,
      field: "root",
      message: "Please check the form and try again.",
    };
  }

  try {
    await registerWithPassword(parsed.data);
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, field: "email", message: err.message };
    }
    throw err;
  }

  try {
    await signIn("password", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // The account exists and only the automatic sign-in failed, so say
      // that rather than implying nothing was created and inviting a retry
      // that would now collide with their own brand-new account.
      return {
        ok: false,
        field: "root",
        message:
          "Your account was created, but we couldn't sign you in automatically. Please sign in below.",
      };
    }
    throw err;
  }

  return { ok: true };
}

/**
 * Starts the Google OAuth hand-off, and makes sure a failure lands somewhere
 * designed.
 *
 * Both auth pages used to call `signIn("google", ...)` straight from an inline
 * form action with nothing around it. That reads as harmless, but Auth.js
 * treats a Server Action as a "raw" call and *rethrows* AuthError instead of
 * redirecting - so `pages.error` was never consulted and the player got Next's
 * "Application error: a server-side exception has occurred (Digest: ...)",
 * which is uglier than the unbranded page this whole change set replaces.
 *
 * Unlike the password actions above this one does redirect, because there is
 * no client-side caller to hand a result to - the form posts straight here.
 */
export async function signInWithGoogle(redirectTo: string): Promise<void> {
  try {
    await signIn("google", { redirectTo });
  } catch (err) {
    /**
     * A successful `signIn` signals itself by throwing NEXT_REDIRECT, so the
     * only genuine failure here is an AuthError. Everything else - the success
     * redirect included - has to rethrow untouched, or a completed sign-in
     * would be reported as a broken one.
     */
    if (err instanceof AuthError) {
      redirect(`/auth/error?error=${encodeURIComponent(err.type)}`);
    }
    throw err;
  }
}

export async function signInWithPassword(
  input: SignInInput,
): Promise<AuthResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      field: "root",
      message: "Enter your email and password.",
    };
  }

  try {
    await signIn("password", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    // Auth.js raises CredentialsSignin (an AuthError) whenever `authorize`
    // returns null. One message for every cause, matching the service's
    // refusal to distinguish unknown email from wrong password - see
    // verifyPasswordCredentials.
    if (err instanceof AuthError) {
      return {
        ok: false,
        field: "root",
        message: "Incorrect email or password.",
      };
    }
    throw err;
  }

  return { ok: true };
}
