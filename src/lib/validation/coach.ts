import { z } from "zod";

export const sendCoachMessageSchema = z.object({
  content: z.string().trim().min(1, "Message can't be empty.").max(4000),
});

export type SendCoachMessageInput = z.infer<typeof sendCoachMessageSchema>;

export const coachPersonalitySchema = z.enum([
  "encouraging",
  "balanced",
  "direct",
  "elite_trainer",
]);
