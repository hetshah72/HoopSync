"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { objectIdString } from "@/lib/validation/common";
import { ValidationError } from "@/server/errors";
import { setUserRole } from "@/server/services/adminService";
import { syncRoster } from "@/server/services/nbaPlayerService";
import { requireAdminUserId } from "@/server/auth/require-session";

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError("Invalid id.");
  }
  return new ObjectId(parsed.data);
}

/**
 * Every action here checks admin before doing anything, even though the
 * service it calls checks again. That is deliberate rather than redundant: a
 * Server Action is an HTTP endpoint that anyone who knows its name can invoke,
 * so the route layout's gate protects the screen and nothing else.
 */
export async function setUserRoleAction(input: {
  userId: string;
  role: "player" | "admin";
}): Promise<{ ok: true }> {
  await requireAdminUserId();

  if (input.role !== "player" && input.role !== "admin") {
    throw new ValidationError("Unknown role.");
  }

  await setUserRole(parseId(input.userId), input.role);
  revalidatePath("/admin/players");
  return { ok: true };
}

export interface SyncRosterActionResult {
  ok: true;
  fetched: number;
  created: number;
  matched: number;
  skipped: number;
}

/**
 * Runs the balldontlie roster sync (BRD 7.4).
 *
 * The same service the admin-only API route calls - a second entry point for
 * it, not a second implementation. Returns the real counts so the dashboard
 * reports what changed rather than just "done": `matched` is the interesting
 * one, since that is authored editorial being adopted by a real roster record
 * rather than duplicated.
 */
export async function syncRosterAction(): Promise<SyncRosterActionResult> {
  await requireAdminUserId();

  const result = await syncRoster();
  revalidatePath("/admin/content");

  return {
    ok: true,
    fetched: result.fetched,
    created: result.created,
    matched: result.matched,
    skipped: result.skipped,
  };
}
