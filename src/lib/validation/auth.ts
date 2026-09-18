import { z } from "zod";

/**
 * Email/password account schemas, shared by the client forms
 * (`src/components/auth/**`) and the server actions that re-validate their
 * input - one definition, so the browser and the server can't drift.
 */

export const PASSWORD_MIN_LENGTH = 8;
/**
 * An upper bound only so an absurd input can't be turned into work: every
 * submitted password is run through a deliberately slow KDF
 * (`src/server/auth/password.ts`), and scrypt's cost scales with input
 * length. No real password gets near this.
 */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Email as it is *stored and compared* - trimmed and lower-cased before the
 * format check, so "  Jordan@Example.com " and "jordan@example.com" can
 * never become two accounts. Everything downstream (sign-up, sign-in, the
 * `users` lookup) parses through this rather than normalizing by hand.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

const nameSchema = z
  .string()
  .trim()
  // Matches onboarding's `displayName` bounds: this name is what prefills it.
  .min(1, "Tell us what to call you.")
  .max(80, "That name is too long.");

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, "That password is too long.")
  .regex(/[a-zA-Z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

export const signUpSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  // Reported on `confirmPassword` rather than at the object root so the form
  // can render it under the field the player has to fix.
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Sign-in deliberately does *not* reuse `passwordSchema`: the rules can
 * tighten over time, and an existing account whose password predates the
 * change must still be able to get in. Length/complexity is a sign-up
 * concern; here the only question is whether the password is correct.
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Narrows a `callbackUrl` query parameter down to somewhere it is safe to
 * send a freshly signed-in player.
 *
 * The proxy puts the path it bounced you from into `?callbackUrl=`, and the
 * sign-in forms navigate there client-side once the session cookie is set.
 * That parameter is attacker-controllable, so anything that isn't plainly a
 * path inside this app is discarded: `https://evil.example`, `//evil.example`
 * and `/\evil.example` are all destinations a browser will happily leave the
 * site for. Auth.js applies its own same-origin check to the OAuth and
 * magic-link flows; this is the equivalent for the client-side navigation.
 *
 * The auth pages and the auth error page are rejected too - landing back on
 * the sign-in screen immediately after signing in reads as a failure, and
 * landing on an error screen after a success reads as a bug.
 *
 * Rejecting `/auth/error` also matters for a second, less obvious reason: it
 * is the input that trips Auth.js's own ErrorPageLoop guard, which reads the
 * `callbackUrl` string rather than testing whether the page is actually gated.
 * Keeping the value out of circulation is the real mitigation there - making
 * the page public is not enough on its own.
 */
const REJECTED_CALLBACK_PATHS = ["/sign-in", "/sign-up", "/auth/error"];

export function resolveCallbackPath(
  raw: string | undefined,
  fallback = "/home",
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Compared against the path alone: the proxy preserves the query string it
  // bounced you from, so an exact match would miss `/auth/error?error=X`.
  const [path] = raw.split(/[?#]/, 1);
  if (REJECTED_CALLBACK_PATHS.includes(path)) return fallback;
  return raw;
}
