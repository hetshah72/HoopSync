import Link from "next/link";
import { ObjectId } from "mongodb";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/server/auth/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SideNavLinks } from "@/components/layout/side-nav";
import {
  ThemeToggle,
  ThemeToggleButton,
} from "@/components/layout/theme-toggle";
import { HoopSyncBadge } from "@/components/brand/hoopsync-mark";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { countUnreadNotifications } from "@/server/services/notificationService";
import { redirect } from "next/navigation";
import {
  getProfileByUserId,
  isOnboardingComplete,
} from "@/server/services/profileService";

/** First letter of whatever we can call this player, for the avatar fallback. */
function initialFor(name?: string | null): string {
  return name?.trim()?.[0]?.toUpperCase() ?? "?";
}

/**
 * The app shell, in two layouts rather than one stretched across every width.
 *
 *   < lg   phone: frosted top bar + floating tab bar, content in a single
 *          reading column.
 *   >= lg  desktop: a fixed 16rem navigation rail carrying the brand, the six
 *          destinations and the account controls; no top bar at all, because
 *          everything it held now lives in the rail. Content gets a wider
 *          measure and screens opt into multi-column layouts from there.
 *
 * Behind both sits a fixed ambient wash that never scrolls, with content
 * passing *under* the translucent chrome rather than being clipped by it.
 *
 * `--app-chrome` is the vertical space the phone chrome and its gutters claim.
 * Screens sizing a scroll region to the remaining viewport (Home's snap feed)
 * measure against this instead of hardcoding a figure that goes stale the next
 * time the header changes height.
 */
export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const profile = await getProfileByUserId(new ObjectId(session.user.id));
  if (!isOnboardingComplete(profile)) {
    redirect("/onboarding");
  }

  const displayName =
    profile.displayName ?? session.user.name ?? session.user.email ?? "Player";
  const initial = initialFor(displayName);

  // The uploaded photo wins over the identity provider's: it is the one the
  // player chose, and it is the only one that can change without signing
  // out (session.user.image is frozen into the JWT).
  const avatarUrl = profile.avatarUrl ?? session.user.image;

  // The unread badge (BRD 7.15). Caught rather than awaited bare: this layout
  // wraps every signed-in screen and a throw here escapes `(app)/error.tsx` all
  // the way to the root error page, so a notifications outage would take down
  // the entire app rather than one badge. No badge is the right degradation -
  // the same call the feed makes when generation fails.
  const unreadNotifications = await countUnreadNotifications(
    new ObjectId(session.user.id),
  ).catch(() => 0);

  const notificationBell = <NotificationBell unreadCount={unreadNotifications} />;

  const avatar = (
    <Avatar className="size-8 ring-1 ring-border">
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand-soft-foreground">
        {initial}
      </AvatarFallback>
    </Avatar>
  );

  const signOutForm = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="icon-lg"
        className="rounded-full text-muted-foreground hover:text-foreground"
      >
        <LogOut className="size-[1.05rem]" />
        <span className="sr-only">Sign out</span>
      </Button>
    </form>
  );

  return (
    // Phone: header (3.5) + main's top gutter (1.25) + clearance for the
    // floating tab bar (6). Desktop: just main's own gutters (2.25 + 4), since
    // the rail is beside the content rather than above or below it.
    <div className="relative [--app-chrome:10.75rem] lg:[--app-chrome:6.25rem]">
      <div
        aria-hidden
        className="ambient-canvas pointer-events-none fixed inset-0 -z-10"
      />

      {/* Desktop navigation rail. */}
      <aside className="glass fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-border/70 lg:flex">
        {/* The rail replaces the phone top bar wholesale from `lg` up, so the
            bell has to be repeated here - the two chrome surfaces are mutually
            exclusive by breakpoint and a single placement would vanish on one
            of them. `pr-3` rather than `px-5` so the icon button's own padding
            lands it on the same optical margin as the rows below. */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 pl-5 pr-3">
          <HoopSyncBadge />
          <span className="font-heading text-[1.0625rem] leading-none font-semibold tracking-tight">
            HoopSync
          </span>
          <div className="ml-auto">{notificationBell}</div>
        </div>

        <SideNavLinks />

        <div className="shrink-0 space-y-2 border-t border-border/70 p-3">
          <div className="flex items-center justify-between gap-2 px-1.5">
            <span className="text-[0.6875rem] font-medium text-muted-foreground">
              Theme
            </span>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2.5 rounded-xl p-1.5">
            <Link
              href="/profile"
              aria-label="Your profile"
              className="press flex min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {avatar}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {displayName}
                </span>
                <span className="block truncate text-[0.6875rem] text-muted-foreground">
                  View profile
                </span>
              </span>
            </Link>
            {signOutForm}
          </div>
        </div>
      </aside>

      <div className="flex min-h-svh flex-col lg:pl-64">
        {/* Phone top bar. The rail replaces it wholesale from `lg` up. */}
        <header className="glass sticky top-0 z-40 border-b border-border/70 lg:hidden">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
            <Link
              href="/home"
              className="press flex items-center gap-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <HoopSyncBadge />
              <span className="font-heading text-[1.0625rem] leading-none font-semibold tracking-tight">
                HoopSync
              </span>
            </Link>

            <div className="flex items-center gap-1">
              {notificationBell}
              <ThemeToggleButton />
              {/* The six nav destinations are fixed by BRD v1.1 §4, so profile
                  editing lives in the chrome rather than becoming a seventh. */}
              <Link
                href="/profile"
                aria-label="Your profile"
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon-lg",
                  className: "rounded-full",
                })}
              >
                {avatar}
              </Link>
              {signOutForm}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-24 lg:max-w-5xl lg:px-10 lg:pt-9 lg:pb-16">
          {children}
        </main>

        <BottomNav />
      </div>
    </div>
  );
}
