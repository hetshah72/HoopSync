"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { notificationPreferencesSchema } from "@/lib/validation/notifications";
import { ValidationError } from "@/server/errors";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/services/notificationService";
import { updateNotificationPreferences } from "@/server/services/profileService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

/**
 * The layout renders the unread badge on every signed-in page, so read-state
 * changes have to revalidate the shell as well as the list. `revalidatePath`
 * with "layout" is what reaches it - revalidating "/notifications" alone would
 * update the list and leave a stale count in the chrome behind it.
 */
function revalidateChrome(): void {
  revalidatePath("/", "layout");
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await markNotificationRead(new ObjectId(userId), parseId(notificationId));
  revalidateChrome();
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await markAllNotificationsRead(new ObjectId(userId));
  revalidateChrome();
  return { ok: true };
}

export async function dismissNotificationAction(
  notificationId: string,
): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await dismissNotification(new ObjectId(userId), parseId(notificationId));
  revalidateChrome();
  return { ok: true };
}

export async function updateNotificationPreferencesAction(input: {
  types?: Record<string, boolean>;
  quietHours?: { startHour: number; endHour: number };
  timeZone?: string;
}): Promise<{ ok: true }> {
  const userId = await requireUserId();

  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Check your notification settings.",
      parsed.error.flatten(),
    );
  }

  await updateNotificationPreferences(new ObjectId(userId), parsed.data);
  revalidatePath("/profile");
  return { ok: true };
}
