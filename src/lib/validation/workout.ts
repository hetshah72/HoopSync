import { z } from "zod";
import { SKILL_CATEGORIES } from "@/lib/validation/onboarding";
import { objectIdString } from "@/lib/validation/common";

/**
 * Shared by the Train form and the workout Server Actions (BRD 7.3).
 *
 * The per-drill actions previously took `order`/`completed` straight off the
 * wire with no validation at all, relying on the Mongo query to reject a bad
 * `order`. These schemas make the action layer state its own contract.
 */

/** Drill `order` is 1-based and assigned by the generator, never by the client. */
export const drillOrder = z
  .number()
  .int("Drill position must be a whole number.")
  .positive("Drill position must be positive.");

export const setDrillCompletionSchema = z.object({
  workoutId: objectIdString,
  order: drillOrder,
  completed: z.boolean(),
});

export const setDrillSkippedSchema = z.object({
  workoutId: objectIdString,
  order: drillOrder,
  skipped: z.boolean(),
});

/**
 * Elapsed time is reported as a delta since the client's last report, so it is
 * bounded: a single report can't claim more than an hour, which keeps a stuck
 * or malicious client from inflating training totals without a round-trip per
 * second.
 */
export const recordDrillElapsedSchema = z.object({
  workoutId: objectIdString,
  order: drillOrder,
  deltaSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60, "That's more time than a single drill report can carry."),
});

/**
 * "Select a skill, or a player to model a workout after" (BRD 7.3) - one
 * discriminated union so the action can't be called with both or neither.
 */
export const generateWorkoutSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("skill"),
    targetSkills: z
      .array(z.enum(SKILL_CATEGORIES))
      .min(1, "Pick at least one skill to focus on.")
      // More than three target skills spreads a short workout so thin that
      // each skill gets a token drill, which defeats the point of focusing.
      .max(3, "Pick up to three skills so the workout stays focused."),
  }),
  z.object({
    mode: z.literal("player"),
    playerId: objectIdString,
  }),
]);

export type GenerateWorkoutInput = z.infer<typeof generateWorkoutSchema>;
