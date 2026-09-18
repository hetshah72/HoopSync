import { z } from "zod";
import { CONFIDENCE_FEELINGS } from "@/types/db";

/**
 * Shared by the pre-game check-in and its Server Action (BRD 7.10).
 *
 * `CONFIDENCE_FEELINGS` is a const tuple, so `z.enum` infers the
 * `ConfidenceFeeling` union directly - no cast on the way in, and no cast on
 * the parsed value on the way out.
 */
export const preGameCheckinSchema = z.object({
  feeling: z.enum(CONFIDENCE_FEELINGS),
});

export type PreGameCheckinInput = z.infer<typeof preGameCheckinSchema>;
