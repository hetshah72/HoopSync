import { z } from "zod";
import { GOAL_TYPE_IDS, goalTemplateFor } from "@/lib/goal-types";

/**
 * Shared by the Goals form and the server action (BRD 7.12). The per-type
 * target bounds live on the template rather than being duplicated here, so
 * adding a goal type doesn't mean editing this file too.
 */
export const createGoalSchema = z
  .object({
    type: z.enum(GOAL_TYPE_IDS),
    targetValue: z.number().int("Set a whole number target.").positive(),
    targetDate: z.date().optional(),
  })
  .superRefine((value, ctx) => {
    const template = goalTemplateFor(value.type);
    if (!template) return;

    if (
      value.targetValue < template.minTarget ||
      value.targetValue > template.maxTarget
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValue"],
        message: `Pick a target between ${template.minTarget} and ${template.maxTarget} ${template.unit}.`,
      });
    }

    if (value.targetDate && !template.supportsTargetDate) {
      ctx.addIssue({
        code: "custom",
        path: ["targetDate"],
        message: "This goal type doesn't use a target date.",
      });
    }
  });

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
