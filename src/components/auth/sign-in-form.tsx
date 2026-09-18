"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { signInSchema, type SignInInput } from "@/lib/validation/auth";
import { signInWithPassword } from "@/server/actions/authActions";
import {
  AuthField,
  AuthSubmitButton,
  FormAlert,
  PasswordField,
} from "@/components/auth/auth-fields";

/** Email + password sign-in for accounts created through `/sign-up`. */
export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const { errors, isSubmitting } = form.formState;

  async function onValid(data: SignInInput) {
    try {
      const result = await signInWithPassword(data);
      if (!result.ok) {
        form.setError(result.field, { message: result.message });
        return;
      }
      router.replace(redirectTo);
      // See the note in sign-up-form: the destination is server-rendered and
      // the router cache may still hold its signed-out version.
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
        id="signin-email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={errors.email?.message}
        {...form.register("email")}
      />

      <PasswordField
        id="signin-password"
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register("password")}
      />

      <div className="pt-1">
        <AuthSubmitButton pending={isSubmitting} pendingLabel="Signing in...">
          Sign in
        </AuthSubmitButton>
      </div>
    </form>
  );
}
