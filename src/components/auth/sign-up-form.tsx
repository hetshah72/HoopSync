"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  PASSWORD_MIN_LENGTH,
  signUpSchema,
  type SignUpInput,
} from "@/lib/validation/auth";
import { signUpWithPassword } from "@/server/actions/authActions";
import {
  AuthField,
  AuthSubmitButton,
  FormAlert,
  PasswordField,
} from "@/components/auth/auth-fields";

/**
 * Name / email / password / confirm sign-up.
 *
 * Validates against the same schema the Server Action re-validates with, so
 * a mismatched confirmation or a too-short password is caught before a
 * round trip - and a client that skips this gains nothing.
 *
 * On success the session cookie is already set by the action, so this only
 * has to navigate: the app shell sends a player with no completed profile to
 * onboarding, which is where a brand-new account belongs.
 */
export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const { errors, isSubmitting } = form.formState;

  async function onValid(data: SignUpInput) {
    try {
      const result = await signUpWithPassword(data);
      if (!result.ok) {
        form.setError(result.field, { message: result.message });
        return;
      }
      router.replace(redirectTo);
      // The destination renders on the server and reads the session; without
      // this it can be served from the client router cache as it looked
      // while signed out.
      router.refresh();
    } catch {
      form.setError("root", {
        message: "Something went wrong. Please try again.",
      });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4" noValidate>
      <FormAlert message={errors.root?.message} />

      <AuthField
        id="name"
        label="Name"
        autoComplete="name"
        placeholder="e.g. Jordan"
        error={errors.name?.message}
        {...form.register("name")}
      />

      <AuthField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={errors.email?.message}
        {...form.register("email")}
      />

      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
        error={errors.password?.message}
        {...form.register("password")}
      />

      <PasswordField
        id="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />

      <div className="pt-1">
        <AuthSubmitButton pending={isSubmitting} pendingLabel="Creating account...">
          Create account
        </AuthSubmitButton>
      </div>
    </form>
  );
}
