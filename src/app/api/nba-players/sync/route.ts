import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { syncRoster } from "@/server/services/nbaPlayerService";

export const POST = withErrorHandling(async () => {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError("You must be signed in.");
  }
  if (session.user.role !== "admin") {
    throw new ForbiddenError("Only admins can trigger a roster sync.");
  }

  const result = await syncRoster();
  return jsonOk(result);
});
