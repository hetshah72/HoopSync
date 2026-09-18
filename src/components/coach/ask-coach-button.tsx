"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The "Ask Coach" / "Talk to Coach" hand-off, for the three entry points added
 * for BRD 7.9 - player study, workouts, and Confidence check-ins.
 *
 * The hand-off is the same three steps everywhere (call the action, navigate to
 * the conversation, surface a failure as a toast), so it lives here rather than
 * being re-implemented per surface. The differences between the three are the
 * label and which Server Action runs, both passed in.
 *
 * `action` is a Server Action reference handed down from a Server Component.
 * It returns the conversation id rather than redirecting: `redirect()` throws
 * internally, so the `try/catch` below would report a successful navigation as
 * an error (the reason `feedActions` documents the same choice).
 */
export function AskCoachButton({
  action,
  targetId,
  label = "Ask Coach",
  pendingLabel = "Opening...",
  variant = "outline",
  className,
}: {
  action: (id: string) => Promise<{ conversationId: string }>;
  targetId: string;
  label?: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const { conversationId } = await action(targetId);
        router.push(`/coach/${conversationId}`);
      } catch {
        toast.error("Couldn't open Coach right now.");
      }
    });
  }

  return (
    <Button
      variant={variant}
      className={className}
      disabled={isPending}
      onClick={handleClick}
    >
      <MessageCircle className="size-4" />
      {isPending ? pendingLabel : label}
    </Button>
  );
}
