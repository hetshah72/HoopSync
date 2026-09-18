import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import { listNotifications } from "@/server/services/notificationService";
import { PageHeader } from "@/components/layout/page-header";
import { NotificationList } from "@/components/notifications/notification-list";

export const metadata = { title: "Notifications" };

/**
 * The notification centre (BRD 7.15).
 *
 * Deliberately not a seventh nav destination - the six are fixed by BRD v1.1
 * §4 - so this is reached from the bell in the app shell chrome, the same way
 * Saved is reached from the bookmark control on Home and Profile from the
 * header avatar.
 *
 * Nothing is generated here. Time-triggered reminders are raised when Home
 * loads (see feedService) and event-triggered ones when the thing they describe
 * actually happens, so this page is a pure read - which is what makes it safe
 * to open repeatedly without minting anything.
 */
export default async function NotificationsPage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;
  const items = userId ? await listNotifications(userId) : [];

  return (
    <div>
      <PageHeader
        back={{ href: "/home", label: "Back to Home" }}
        eyebrow="Your updates"
        title="Notifications"
        description="Reminders, goal updates and milestones, drawn from your own training records."
      />

      <NotificationList items={items} />
    </div>
  );
}
