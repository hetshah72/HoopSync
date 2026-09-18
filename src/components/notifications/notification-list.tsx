"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell,
  CheckCheck,
  Dumbbell,
  Flame,
  Library,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { cn } from "@/lib/utils";
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions/notificationActions";
import type { NotificationType } from "@/types/db";
import type { NotificationView } from "@/server/services/notificationService";

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  workout_reminder: Dumbbell,
  streak_reminder: Flame,
  goal_update: Target,
  coach_recommendation: Sparkles,
  new_content: Library,
  progress_milestone: CheckCheck,
};

/** "3h ago". Relative time reads better than a date on a list you check daily. */
function relativeTime(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The notification centre list (BRD 7.15).
 *
 * Client-side for the same reason `feed-card.tsx` is: every row mutates through
 * a Server Action, and an optimistic flip with a revert on failure is what
 * makes marking something read feel instant. The rendered timestamp is computed
 * from a `now` captured on mount rather than at module scope, so a long-open
 * tab doesn't keep claiming everything happened "just now" - and so the server
 * and client don't disagree on the first paint.
 */
export function NotificationList({ items }: { items: NotificationView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());

  // Optimistic overlays, keyed by id. The server list stays the source of
  // truth; these only cover the gap until the revalidation lands.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visible = items.filter((item) => !dismissedIds.has(item.id));
  const unreadCount = visible.filter(
    (item) => !item.read && !readIds.has(item.id),
  ).length;

  function handleMarkAllRead() {
    const previous = readIds;
    setReadIds(new Set(visible.map((item) => item.id)));
    startTransition(async () => {
      try {
        await markAllNotificationsReadAction();
        router.refresh();
      } catch {
        setReadIds(previous);
        toast.error("Couldn't mark those as read.");
      }
    });
  }

  function handleOpen(item: NotificationView) {
    if (item.read || readIds.has(item.id)) return;
    // Fire-and-forget: the player is navigating away, and a failed read-mark
    // must not interrupt that. The badge self-corrects on the next render.
    setReadIds((prev) => new Set(prev).add(item.id));
    startTransition(async () => {
      try {
        await markNotificationReadAction(item.id);
      } catch {
        // Deliberately silent - see above.
      }
    });
  }

  function handleDismiss(item: NotificationView) {
    setDismissedIds((prev) => new Set(prev).add(item.id));
    startTransition(async () => {
      try {
        await dismissNotificationAction(item.id);
        router.refresh();
      } catch {
        setDismissedIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        toast.error("Couldn't dismiss that.");
      }
    });
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="You're all caught up"
        description="Reminders, goal updates and milestones show up here as they happen. Nothing needs you right now."
      />
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isPending}
          >
            Mark all read
          </Button>
        </div>
      )}

      <ul className="space-y-2.5">
        {visible.map((item) => {
          const Icon = TYPE_ICON[item.type];
          const read = item.read || readIds.has(item.id);

          return (
            <li key={item.id}>
              <Card
                size="sm"
                className={cn(
                  "relative transition-colors",
                  !read && "border-brand/30 bg-brand-soft/30",
                )}
              >
                <div className="flex items-start gap-3 pr-7">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl",
                      read
                        ? "bg-muted text-muted-foreground"
                        : "bg-brand-soft text-brand-soft-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* The whole row is the link, so the title carries the
                        destination rather than adding a separate CTA - a
                        notification with two targets is a notification you
                        have to read twice. */}
                    <Link
                      href={item.href}
                      onClick={() => handleOpen(item)}
                      className="press block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span
                          className={cn(
                            "font-heading text-sm tracking-tight",
                            read ? "font-medium" : "font-semibold",
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                          {relativeTime(item.createdAt, now)}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {item.body}
                      </span>
                    </Link>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDismiss(item)}
                  aria-label={`Dismiss "${item.title}"`}
                  className="press absolute top-2 right-2 rounded-lg p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <X className="size-3.5" />
                </button>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
