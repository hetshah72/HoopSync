import Link from "next/link";
import { Bell } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The entry point to the notification centre, in the app shell chrome.
 *
 * A link, not a popover. Three reasons, in order of weight: there is no popover
 * primitive in this design system and a notification list is the wrong place to
 * introduce one; the desktop layout has no top bar at all, so a panel anchored
 * to a rail button would open somewhere strange; and `/saved` already
 * establishes that a real destination reached from chrome is how this app
 * handles surfaces that can't be nav items. The six nav destinations are fixed
 * by BRD v1.1 §4 (see `nav-items.ts`), so this cannot become a seventh tab.
 *
 * Server Component: the count comes from the layout's own read, so there is no
 * polling and nothing to hydrate. It refreshes when a Server Action
 * revalidates the layout, which is exactly when the count can have changed.
 */
export function NotificationBell({
  unreadCount,
  className,
}: {
  unreadCount: number;
  className?: string;
}) {
  const capped = unreadCount > 9 ? "9+" : String(unreadCount);
  const hasUnread = unreadCount > 0;

  return (
    <Link
      href="/notifications"
      aria-label={
        hasUnread
          ? `Notifications, ${unreadCount} unread`
          : "Notifications, none unread"
      }
      className={cn(
        buttonVariants({
          variant: "ghost",
          size: "icon-lg",
          className: "relative rounded-full",
        }),
        className,
      )}
    >
      <Bell className="size-[1.05rem]" />
      {hasUnread && (
        // The count is already in the link's accessible name, so the badge
        // itself is decorative - announcing it again would read the number
        // twice.
        <span
          aria-hidden
          className={cn(
            "absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1",
            // `--brand-strong`, not `--brand`: globals.css splits the ember in
            // three because vivid orange can't hit 4.5:1 behind text, and this
            // badge carries a numeral.
            "bg-brand-strong text-[0.625rem] leading-4 font-semibold text-brand-foreground",
            "ring-2 ring-background",
          )}
        >
          {capped}
        </span>
      )}
    </Link>
  );
}
