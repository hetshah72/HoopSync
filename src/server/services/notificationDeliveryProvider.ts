import "server-only";
import { isWithinQuietHours } from "@/lib/quiet-hours";
import { logger } from "@/server/logger";
import type { NotificationDoc, NotificationPreferences } from "@/types/db";

/**
 * Where a notification goes once it exists.
 *
 * Today there is exactly one channel: the notification lands in Mongo and the
 * player sees it next time they open the app. That is a real delivery, not a
 * placeholder - but it is also the *only* one, and this interface is the line
 * that keeps it swappable. Web push (service worker + VAPID + a subscriptions
 * collection) and email both slot in here as additional providers without
 * anything above the service layer changing, exactly as
 * `ShotMechanicalAnalysisProvider` reserves the seam for real pose estimation.
 *
 * What deliberately does *not* live behind this seam: deciding whether a
 * notification should exist at all. That is `notificationService`'s job and it
 * stays there, so the rules about dedupe, preferences and honesty hold no
 * matter which channel is plugged in.
 */
export interface DeliveryContext {
  preferences?: NotificationPreferences;
  now: Date;
}

export interface DeliveryResult {
  /** Channel that handled them, for logging. */
  channel: string;
  /** How many actually left the app. Zero for in-app-only delivery. */
  dispatched: number;
}

export interface NotificationDeliveryProvider {
  readonly channel: string;
  deliver(
    notifications: NotificationDoc[],
    context: DeliveryContext,
  ): Promise<DeliveryResult>;
}

/**
 * The in-app channel: the row in `notifications` *is* the delivery, so there is
 * nothing to dispatch.
 *
 * It still exists as a provider rather than being skipped, for two reasons.
 * It is the one place that records what was raised, which is what makes the
 * feature debuggable. And it is where quiet hours is honoured for real once a
 * push channel exists - the check is written here, against the same
 * preferences, so adding push does not mean rediscovering that rule.
 */
export class InAppNotificationDeliveryProvider
  implements NotificationDeliveryProvider
{
  readonly channel = "in_app";

  async deliver(
    notifications: NotificationDoc[],
    context: DeliveryContext,
  ): Promise<DeliveryResult> {
    if (notifications.length === 0) {
      return { channel: this.channel, dispatched: 0 };
    }

    // Recorded, not acted on: an in-app notification is read when the player
    // chooses to open the bell, so holding it back overnight would only mean
    // hiding something they came looking for. A push provider reading this
    // same flag would genuinely defer the send.
    const quiet = isWithinQuietHours(context.now, context.preferences);

    logger.info(
      {
        channel: this.channel,
        count: notifications.length,
        types: notifications.map((n) => n.type),
        quietHours: quiet,
      },
      "Notifications raised",
    );

    return { channel: this.channel, dispatched: 0 };
  }
}

export function getNotificationDeliveryProvider(): NotificationDeliveryProvider {
  return new InAppNotificationDeliveryProvider();
}
