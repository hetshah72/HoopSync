import { z } from "zod";
import { SHOT_TYPES, SHOT_ZONES } from "@/types/db";

export const logShotSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  zone: z.enum(SHOT_ZONES),
  made: z.boolean(),
  /**
   * Optional by design (BRD 7.6 "for the same shot type"). Tagging it makes
   * the reference comparison shot-type specific, and skipping it costs the
   * player nothing - the analysis falls back to the general standard rather
   * than inferring a shot type they never gave us.
   */
  shotType: z.enum(SHOT_TYPES).optional(),
  timestampInVideoSeconds: z.number().min(0),
});

export type LogShotInput = z.infer<typeof logShotSchema>;
