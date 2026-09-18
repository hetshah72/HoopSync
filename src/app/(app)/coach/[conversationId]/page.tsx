import { ObjectId } from "mongodb";
import { notFound } from "next/navigation";
import { auth } from "@/server/auth/auth";
import {
  countResolvedContext,
  getConversationForUser,
  listMessages,
} from "@/server/services/coachService";
import { CoachChat } from "@/components/coach/coach-chat";

export default async function CoachConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(conversationId)) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    notFound();
  }
  const userId = new ObjectId(session.user.id);

  const conversation = await getConversationForUser(userId, new ObjectId(conversationId));
  if (!conversation) {
    notFound();
  }

  // Both reads are independent - the badge shouldn't wait on the transcript.
  const [messages, resolvedContextCount] = await Promise.all([
    listMessages(userId, conversation._id),
    countResolvedContext(userId, conversation),
  ]);

  return (
    <CoachChat
      conversationId={conversation._id.toString()}
      title={conversation.title ?? "New conversation"}
      personality={conversation.personality}
      hasContext={resolvedContextCount > 0}
      initialMessages={messages.map((m) => ({
        id: m._id.toString(),
        role: m.role,
        content: m.content,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
