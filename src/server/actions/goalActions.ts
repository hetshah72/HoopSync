"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { createGoalSchema } from "@/lib/validation/goal";
import { ValidationError } from "@/server/errors";
import {
  abandonGoal,
  createGoalForUser,
  deleteGoalForUser,
  reactivateGoal,
} from "@/server/services/goalService";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

export async function createGoalAction(input: {
  type: string;
  targetValue: number;
  targetDate?: string;
}): Promise<{ ok: true }> {
  const userId = await requireUserId();

  const parsed = createGoalSchema.safeParse({
    type: input.type,
    targetValue: input.targetValue,
    targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
  });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Check the goal details.",
      parsed.error.flatten(),
    );
  }

  await createGoalForUser(new ObjectId(userId), parsed.data);
  revalidatePath("/progress");
  return { ok: true };
}

export async function abandonGoalAction(goalId: string): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await abandonGoal(new ObjectId(userId), parseId(goalId));
  revalidatePath("/progress");
  return { ok: true };
}

export async function reactivateGoalAction(goalId: string): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await reactivateGoal(new ObjectId(userId), parseId(goalId));
  revalidatePath("/progress");
  return { ok: true };
}

export async function deleteGoalAction(goalId: string): Promise<{ ok: true }> {
  const userId = await requireUserId();
  await deleteGoalForUser(new ObjectId(userId), parseId(goalId));
  revalidatePath("/progress");
  return { ok: true };
}
