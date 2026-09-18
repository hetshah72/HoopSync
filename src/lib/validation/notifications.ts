import { z } from "zod";
import { NOTIFICATION_TYPES } from "@/types/db";

/**
 * Notification preferences (BRD 7.15).
 *
 * Isomorphic, like every other schema here, so the profile form and the server
 * action validate against one definition.
 *
 * Deliberately its own schema rather than fields bolted onto `onboardingSchema`
 * - the same reasoning `profileService.setAvatar` records for the photo: a
 * toggle is saved on its own with no Save step, and routing it through the
 * onboarding schema would let an unrelated profile answer being momentarily
 * invalid block someone from turning a notification off.
 */
export const notificationPreferencesSchema = z.object({
  /**
   * Only the types that are explicitly off need to be sent; an absent type is
   * enabled. The form sends the full map anyway, which is harmless.
   */
  types: z.record(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),

  quietHours: z
    .object({
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })
    .optional(),

  /**
   * IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Length-
   * capped and pattern-checked rather than validated against the full tz
   * database: the value is only ever passed back to `Intl`, which rejects an
   * unknown zone on its own (and `hourInZone` falls back to server time when it
   * does), so the only job here is to keep something absurd out of the profile.
   */
  timeZone: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_+\-/]+$/, "That doesn't look like a time zone.")
    .optional(),
});

export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesSchema
>;
