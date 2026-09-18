import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { HoopSyncBadge } from "@/components/brand/hoopsync-mark";
import { ErrorState } from "@/components/layout/error-state";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Admin" };

/**
 * The admin dashboard shell (BRD 6.2).
 *
 * Deliberately outside the `(app)` route group. That layout redirects anyone
 * without a completed player profile into onboarding and wraps every screen in
 * the six-tab player navigation - neither of which makes sense here. An
 * administrator is not necessarily a player, and should not have to invent a
 * height and a position to reach a dashboard.
 *
 * Two different failures, two different answers: signed out goes to sign-in,
 * because that is recoverable; signed in without the role is told plainly,
 * because bouncing them to a login form they will pass and be rejected by
 * again is a loop rather than an explanation.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/sign-in?callbackUrl=/admin");
  }

  if (session.user.role !== "admin") {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <ErrorState
          icon={ShieldAlert}
          title="You don't have access to this area"
          description="The admin dashboard is limited to accounts on the administrator list. If you think that's wrong, ask whoever manages the deployment to add your email to ADMIN_EMAILS."
          actions={
            <Link
              href="/home"
              className={buttonVariants({ variant: "brand", size: "sm" })}
            >
              Back to HoopSync
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-svh">
      <div
        aria-hidden
        className="ambient-canvas pointer-events-none fixed inset-0 -z-10"
      />

      <header className="glass sticky top-0 z-40 border-b border-border/70">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            href="/admin"
            className="press flex items-center gap-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <HoopSyncBadge />
            <span className="font-heading text-[1.0625rem] leading-none font-semibold tracking-tight">
              HoopSync
            </span>
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-warning-soft-foreground">
              Admin
            </span>
          </Link>

          <Link
            href="/home"
            className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Back to the app
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <AdminNav />
        <main className="mt-5">{children}</main>
      </div>
    </div>
  );
}
