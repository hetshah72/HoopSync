import Link from "next/link";

import { signInWithGoogle } from "@/server/actions/authActions";
import { resolveCallbackPath } from "@/lib/validation/auth";
import { describeAuthError } from "@/lib/auth-errors";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { FormAlert } from "@/components/auth/auth-fields";
import { AuthDivider } from "@/components/auth/auth-divider";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";

/**
 * Account creation: Google, or name / email / password / confirm.
 *
 * Google is the same single call as on sign-in - OAuth has no separate
 * "sign up", the first successful callback is what creates the account - so
 * the button is worded for the page it's on rather than implying a different
 * flow.
 *
 * Whichever route a player takes, they land in onboarding: the app shell
 * redirects anyone without a completed profile there.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = resolveCallbackPath(callbackUrl);
  const signInHref =
    redirectTo === "/home"
      ? "/sign-in"
      : `/sign-in?callbackUrl=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthShell>
      <div className="space-y-1.5">
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          Create your account
        </h2>
        <p className="text-sm text-muted-foreground">
          Start training with HoopSync. It takes about a minute.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <FormAlert message={describeAuthError(error)} />

        <form
          action={async () => {
            "use server";
            await signInWithGoogle(redirectTo);
          }}
        >
          <GoogleButton label="Sign up with Google" />
        </form>

        <AuthDivider label="or" />

        <SignUpForm redirectTo={redirectTo} />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={signInHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
