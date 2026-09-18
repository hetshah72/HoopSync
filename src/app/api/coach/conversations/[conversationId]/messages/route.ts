import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import { withErrorHandling, jsonOk } from "@/server/http";
import { UnauthorizedError, ValidationError } from "@/server/errors";
import { sendCoachMessageSchema } from "@/lib/validation/coach";
import { sendMessage } from "@/server/services/coachService";

export const POST = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ conversationId: string }> },
  ) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UnauthorizedError("You must be signed in.");
    }

    const { conversationId } = await params;
    if (!/^[0-9a-fA-F]{24}$/.test(conversationId)) {
      throw new ValidationError("Invalid conversation id.");
    }

    const body = await request.json().catch(() => null);
    const parsed = sendCoachMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid message.", parsed.error.flatten());
    }

    const result = await sendMessage(
      new ObjectId(session.user.id),
      new ObjectId(conversationId),
      parsed.data.content,
    );

    return jsonOk({
      userMessage: {
        id: result.userMessage._id.toString(),
        role: result.userMessage.role,
        content: result.userMessage.content,
        createdAt: result.userMessage.createdAt.toISOString(),
      },
      assistantMessage: result.assistantMessage
        ? {
            id: result.assistantMessage._id.toString(),
            role: result.assistantMessage.role,
            content: result.assistantMessage.content,
            // Carried to the client so a composed reply can be labeled as one.
            source: result.assistantMessage.source,
            createdAt: result.assistantMessage.createdAt.toISOString(),
          }
        : null,
      assistantError: result.assistantError,
    });
  },
);
