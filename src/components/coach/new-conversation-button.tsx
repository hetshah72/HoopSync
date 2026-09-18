"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createConversationAction } from "@/server/actions/coachActions";

export function NewConversationButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const { conversationId } = await createConversationAction();
        router.push(`/coach/${conversationId}`);
      } catch {
        toast.error("Couldn't start a new conversation.");
      }
    });
  }

  return (
    <Button className="w-full" disabled={isPending} onClick={handleClick}>
      <MessageCirclePlus className="size-4" />
      {isPending ? "Starting..." : "New Conversation"}
    </Button>
  );
}
