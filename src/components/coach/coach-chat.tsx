"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COACH_PERSONALITIES, personalityLabel } from "@/lib/coach-personalities";
import { updateCoachPersonalityAction } from "@/server/actions/coachActions";
import type { CoachPersonality } from "@/types/db";

interface MessageView {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Only present on generated replies. `"fallback"` means the text was
   * composed by HoopSync from the player's own records because no model was
   * available - labeled below so a composed reply is never read as a generated
   * one, the same disclosure rule Game Film applies to heuristic reports.
   */
  source?: "ai" | "fallback";
  createdAt: string;
}

interface SendMessageResponse {
  data: {
    userMessage: MessageView;
    assistantMessage: MessageView | null;
    assistantError?: string;
  };
}

export function CoachChat({
  conversationId,
  title,
  personality,
  hasContext,
  initialMessages,
}: {
  conversationId: string;
  title: string;
  personality: CoachPersonality;
  hasContext: boolean;
  initialMessages: MessageView[];
}) {
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [currentPersonality, setCurrentPersonality] = useState<CoachPersonality>(personality);
  const [input, setInput] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const [isChangingPersonality, startPersonalityChange] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function handleSend() {
    const content = input.trim();
    if (!content || isSending) return;

    startSending(async () => {
      setLastError(null);
      try {
        const response = await fetch(`/api/coach/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error?.message ?? "Couldn't send that message.");
        }

        const { userMessage, assistantMessage, assistantError } = (body as SendMessageResponse).data;
        setMessages((prev) => [
          ...prev,
          userMessage,
          ...(assistantMessage ? [assistantMessage] : []),
        ]);
        setInput("");
        if (assistantError) setLastError(assistantError);
        scrollToBottom();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't send that message.");
      }
    });
  }

  function handlePersonalityChange(next: CoachPersonality | null) {
    if (!next) return;
    const previous = currentPersonality;
    setCurrentPersonality(next);
    startPersonalityChange(async () => {
      try {
        await updateCoachPersonalityAction(conversationId, next);
      } catch {
        setCurrentPersonality(previous);
        toast.error("Couldn't change Coach's personality.");
      }
    });
  }

  return (
    // One panel that owns the viewport height, with only the transcript
    // scrolling inside it - the header and composer stay put. The height comes
    // from `--app-chrome` (set by the app shell, and different on phone and
    // desktop) rather than the hardcoded `100vh-9.5rem` this used to carry,
    // which went stale the moment the chrome changed.
    <div className="mx-auto flex h-[calc(100svh-var(--app-chrome))] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/70 px-4 py-3">
        <Link
          href="/coach"
          aria-label="Back to Coach"
          className={buttonVariants({
            variant: "ghost",
            size: "icon-sm",
            className: "rounded-full",
          })}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading font-semibold tracking-tight">
            {title}
          </p>
          {hasContext && (
            <Badge variant="success" className="mt-1">
              Real session context attached
            </Badge>
          )}
        </div>
        <Select
          value={currentPersonality}
          onValueChange={handlePersonalityChange}
          disabled={isChangingPersonality}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {(value: CoachPersonality | null) => (value ? personalityLabel(value) : "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COACH_PERSONALITIES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span
              aria-hidden
              className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-foreground ring-1 ring-brand/15"
            >
              <MessageCircle className="size-5" />
            </span>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
              Ask Coach anything - a skill question, what to work on next, or
              how to prep for a game.
            </p>
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              className={cn(
                "flex items-end gap-2.5",
                isUser ? "justify-end" : "justify-start",
              )}
            >
              {/* The assistant is marked by an avatar as well as by side and
                  colour, so the two speakers stay distinguishable without
                  relying on left/right alone. */}
              {!isUser && (
                <span
                  aria-hidden
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground"
                >
                  <MessageCircle className="size-3.5" />
                </span>
              )}
              <div className="max-w-[80%] space-y-1">
                <div
                  className={cn(
                    "px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                    isUser
                      ? "rounded-2xl rounded-br-md bg-brand-strong text-brand-foreground"
                      : "rounded-2xl rounded-bl-md border border-border/60 bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
                {m.source === "fallback" && (
                  <p className="px-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
                    Written from your saved data - no AI model was available for
                    this reply.
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {lastError && (
          <p
            role="status"
            className="rounded-xl border border-border/60 bg-muted/60 px-3 py-2 text-center text-xs leading-relaxed text-muted-foreground"
          >
            {lastError}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* The send button must stay a direct child of the textarea's parent -
          the founder-loop e2e walk finds it as `textarea.locator("..")`. */}
      <div className="flex shrink-0 items-end gap-2 border-t border-border/70 bg-muted/30 p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Message Coach..."
          disabled={isSending}
          className="max-h-40 min-h-10 flex-1 resize-none py-2.5"
          rows={1}
        />
        <Button
          size="icon-lg"
          disabled={isSending || input.trim().length === 0}
          onClick={handleSend}
        >
          <Send className="size-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  );
}
