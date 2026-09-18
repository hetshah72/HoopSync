import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";
import { getAnalysisForUser } from "@/server/services/gameFootageService";

/**
 * Status-only read for the Game Film report screen while analysis is running.
 *
 * A route handler rather than a Server Action because it is polled: the screen
 * asks every few seconds until the status leaves `processing`, then refreshes
 * the RSC tree to render the finished report. Deliberately tiny - the report
 * itself is still rendered on the server, so this returns no findings.
 */
export const GET = withErrorHandling(
  async (_request: Request, context: { params: Promise<{ analysisId: string }> }) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UnauthorizedError("You must be signed in.");
    }

    const { analysisId } = await context.params;
    if (!/^[0-9a-fA-F]{24}$/.test(analysisId)) {
      throw new ValidationError("Invalid id.");
    }

    const analysis = await getAnalysisForUser(
      new ObjectId(session.user.id),
      new ObjectId(analysisId),
    );
    if (!analysis) {
      throw new NotFoundError("Game film analysis not found.");
    }

    return jsonOk({ status: analysis.status });
  },
);
