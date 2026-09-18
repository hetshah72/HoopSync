import { ObjectId } from "mongodb";
import Link from "next/link";
import { ChevronRight, MessageCircle, Paperclip } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { listConversationsForUser } from "@/server/services/coachService";
import { PageHeader, SectionHeading } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { NewConversationButton } from "@/components/coach/new-conversation-button";
import { personalityLabel } from "@/lib/coach-personalities";

export default async function CoachPage() {
  const session = await auth();
  const conversations = session?.user?.id
    ? await listConversationsForUser(new ObjectId(session.user.id))
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Coach"
        title="Ask your coach"
        description="Share a session or a feed card and Coach picks the conversation up with your real numbers already attached."
        action={<NewConversationButton />}
      />

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No conversations yet"
          description="Start one above, or share a shooting session or feed item with Coach to get a conversation with real context already attached."
        />
      ) : (
        <>
          <SectionHeading
            title="Your conversations"
            count={conversations.length}
            className="mb-3"
          />
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {conversations.map((c) => (
              <li
                key={c._id.toString()}
                className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
              >
                <Link
                  href={`/coach/${c._id}`}
                  className="press flex h-full items-center gap-3.5 px-4 py-3.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-foreground"
                  >
                    <MessageCircle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      {c.title ?? "New conversation"}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                      <span className="truncate">
                        {personalityLabel(c.personality)}
                      </span>
                      {c.contextRefs.length > 0 && (
                        <>
                          <span aria-hidden>&middot;</span>
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <Paperclip aria-hidden className="size-3" />
                            {c.contextRefs.length} context reference
                            {c.contextRefs.length === 1 ? "" : "s"} attached
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
