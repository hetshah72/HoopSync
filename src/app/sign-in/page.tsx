import Link from "next/link";

import { signInWithGoogle } from "@/server/actions/authActions";
import { resolveCallbackPath } from "@/lib/validation/auth";
import { describeAuthError } from "@/lib/auth-errors";
import { SignInForm } from "@/components/auth/sign-in-form";
import { FormAlert } from "@/components/auth/auth-fields";
import { AuthDivider } from "@/components/auth/auth-divider";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = resolveCallbackPath(callbackUrl);
  const signUpHref =
    redirectTo === "/home"
      ? "/sign-up"
      : `/sign-up?callbackUrl=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthShell>
      <div className="space-y-1.5">
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          Welcome back
        </h2>
        <p className="text-sm text-muted-foreground">
          Sign in to pick up your training where you left off.
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
          <GoogleButton label="Continue with Google" />
        </form>

        <AuthDivider label="or" />

        <SignInForm redirectTo={redirectTo} />

        <p className="text-center text-sm text-muted-foreground">
          New to HoopSync?{" "}
          <Link
            href={signUpHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
