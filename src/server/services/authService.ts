import "server-only";
import {
  findUserByEmail,
  insertUserIfEmailFree,
} from "@/server/repositories/userRepository";
import {
  hashPassword,
  spendFailedVerificationCost,
  verifyPassword,
} from "@/lib/password";
import { ConflictError } from "@/server/errors";
import type { SignUpInput } from "@/lib/validation/auth";
import type { Role } from "@/types/db";

/**
 * Email/password account creation and credential checking.
 *
 * Kept out of `auth.config.ts` so the Credentials provider's `authorize` is
 * a thin adapter over this, and so sign-up (which runs from a Server Action,
 * not through Auth.js at all) and sign-in share one definition of what a
 * valid account is.
 */

/** What a verified credential yields - the shape Auth.js wants back from
 * `authorize`, and deliberately nothing more (no password hash, ever). */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  role: Role;
}

/**
 * Creates a password account. Input must already be schema-validated.
 *
 * Throws `ConflictError` if the email is taken - including when it's taken
 * by a Google account. Adopting that account by simply attaching a password
 * would let anyone who knows a player's email set a password on it and walk
 * in, since nothing in this flow proves the person signing up controls the
 * address. The sign-in page points them at the method that does work
 * instead (see `describeAuthError`).
 */
export async function registerWithPassword(
  input: SignUpInput,
): Promise<AuthenticatedUser> {
  const { name, email, password } = input;

  const existing = await findUserByEmail(email);
  if (existing) throw emailTakenError();

  const created = await insertUserIfEmailFree({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: "player",
  });
  // Lost the race against a simultaneous sign-up with the same email.
  if (!created) throw emailTakenError();

  return {
    id: created._id.toString(),
    email: created.email,
    name: created.name,
    role: created.role,
  };
}

function emailTakenError(): ConflictError {
  return new ConflictError(
    "An account already exists for that email. Sign in instead.",
  );
}

/**
 * Checks an email/password pair. Returns `null` for every kind of failure -
 * unknown email, account with no password, wrong password - because telling
 * them apart is exactly what a credential-stuffing attempt wants. The UI
 * shows one message for all three, and `spendFailedVerificationCost` keeps
 * the *timing* from saying what the message doesn't.
 */
export async function verifyPasswordCredentials(
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const user = await findUserByEmail(email);

  if (!user?.passwordHash) {
    await spendFailedVerificationCost(password);
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
