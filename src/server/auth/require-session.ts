import "server-only";
import { auth } from "@/server/auth/auth";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";

/** Shared by Server Actions: resolves the current user id or throws. */
export async function requireUserId(
  message = "You must be signed in.",
): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError(message);
  }
  return session.user.id;
}

/**
 * The admin gate (BRD 6.2's admin dashboard).
 *
 * Every admin service call goes through this rather than trusting the route
 * layout's own check. The layout gate is what stops an admin screen rendering;
 * this is what stops a Server Action being invoked directly by someone who
 * simply knows its name, which no amount of layout gating prevents.
 *
 * Distinguishes signed-out from signed-in-but-not-admin so the UI can send one
 * to sign-in and tell the other plainly that they don't have access, rather
 * than bouncing a logged-in player through a login loop.
 */
export async function requireAdminUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("You must be signed in.");
  }
  if (session.user.role !== "admin") {
    throw new ForbiddenError("You don't have access to the admin dashboard.");
  }
  return session.user.id;
}
