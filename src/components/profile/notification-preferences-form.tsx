"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_INFO,
} from "@/lib/notification-types";
import { formatHour } from "@/lib/quiet-hours";
import { quietHoursSummary } from "@/lib/notification-templates";
import { updateNotificationPreferencesAction } from "@/server/actions/notificationActions";
import type { NotificationPreferences, NotificationType } from "@/types/db";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Notification settings (BRD 7.15).
 *
 * Saves on its own rather than joining the profile form below it, matching the
 * avatar control: turning a notification off must never be blocked by an
 * unrelated profile answer being momentarily invalid.
 */
export function NotificationPreferencesForm({
  preferences,
}: {
  preferences?: NotificationPreferences;
}) {
  const [isSaving, startSaving] = useTransition();

  const [enabled, setEnabled] = useState<Record<NotificationType, boolean>>(
    () =>
      Object.fromEntries(
        NOTIFICATION_TYPES.map((type) => [
          type,
          preferences?.types?.[type] !== false,
        ]),
      ) as Record<NotificationType, boolean>,
  );
  const [startHour, setStartHour] = useState(
    preferences?.quietHours?.startHour ?? 22,
  );
  const [endHour, setEndHour] = useState(preferences?.quietHours?.endHour ?? 7);
  const [quietEnabled, setQuietEnabled] = useState(
    Boolean(
      preferences?.quietHours &&
        preferences.quietHours.startHour !== preferences.quietHours.endHour,
    ),
  );

  function handleSave() {
    startSaving(async () => {
      try {
        await updateNotificationPreferencesAction({
          types: enabled,
          quietHours: quietEnabled ? { startHour, endHour } : undefined,
          // Captured here rather than asked for: quiet hours has to mean the
          // player's night, and the browser already knows which one that is.
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        toast.success("Notification settings saved.");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save those settings.",
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" />
          Notifications
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The honesty note. This app labels simulated analysis wherever it
            appears, and the same bar applies here: a settings screen that
            reads like push notifications, on a product that has none, would be
            telling the player something untrue about what they've turned on. */}
        <p className="rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground">
          These appear on the bell inside HoopSync. Nothing is sent to your phone
          or email yet.
        </p>

        <ul className="space-y-1">
          {NOTIFICATION_TYPES.map((type) => {
            const info = NOTIFICATION_TYPE_INFO[type];
            const isOn = enabled[type];
            return (
              <li key={type}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 transition-colors",
                    "hover:bg-accent/60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={(event) =>
                      setEnabled((prev) => ({
                        ...prev,
                        [type]: event.target.checked,
                      }))
                    }
                    className="mt-0.5 size-4 shrink-0 accent-[var(--brand-strong)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {info.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {info.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <Separator />

        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1">
            <input
              type="checkbox"
              checked={quietEnabled}
              onChange={(event) => setQuietEnabled(event.target.checked)}
              className="size-4 shrink-0 accent-[var(--brand-strong)]"
            />
            <span className="text-sm font-medium">Quiet hours</span>
          </label>

          {quietEnabled && (
            <div className="flex flex-wrap items-end gap-3 px-2">
              <div className="min-w-28 flex-1">
                <Label htmlFor="quiet-start" className="text-xs">
                  From
                </Label>
                <NativeSelect
                  id="quiet-start"
                  value={startHour}
                  onChange={(event) => setStartHour(Number(event.target.value))}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="min-w-28 flex-1">
                <Label htmlFor="quiet-end" className="text-xs">
                  Until
                </Label>
                <NativeSelect
                  id="quiet-end"
                  value={endHour}
                  onChange={(event) => setEndHour(Number(event.target.value))}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}

          <p className="px-2 text-xs text-muted-foreground">
            {quietEnabled
              ? quietHoursSummary({ startHour, endHour })
              : "No quiet hours set."}{" "}
            Reminders aren&apos;t raised during this window. Goal and milestone
            updates still appear, since those are a record of something you just
            did.
          </p>
        </div>

        <Button onClick={handleSave} disabled={isSaving} variant="brand">
          {isSaving ? "Saving..." : "Save notification settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
