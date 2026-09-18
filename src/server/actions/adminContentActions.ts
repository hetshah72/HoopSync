"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/server/errors";
import {
  attachAssetToFeedItem,
  setAssetClearance,
} from "@/server/services/adminContentService";
import { objectIdString } from "@/lib/validation/common";

/**
 * Admin content actions.
 *
 * Every one re-checks the role rather than trusting the page that rendered
 * the button: a Server Action is a public endpoint, and the only thing
 * standing between it and any signed-in player is this check.
 */
async function requireAdminId(): Promise<ObjectId> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError("You must be signed in.");
  if (session.user.role !== "admin") {
    throw new ForbiddenError("Only admins can manage library content.");
  }
  return new ObjectId(session.user.id);
}

function parseId(id: string): ObjectId {
  const parsed = objectIdString.safeParse(id);
  if (!parsed.success) throw new ValidationError("Invalid id.");
  return new ObjectId(parsed.data);
}

export async function setAssetClearanceAction(
  assetId: string,
  cleared: boolean,
): Promise<{ cleared: boolean }> {
  const adminId = await requireAdminId();
  const asset = await setAssetClearance(adminId, parseId(assetId), cleared);
  revalidatePath("/admin/library");
  return { cleared: asset.cleared };
}

export async function attachAssetToFeedItemAction(
  assetId: string,
  feedItemId: string,
): Promise<void> {
  await requireAdminId();
  await attachAssetToFeedItem(parseId(assetId), parseId(feedItemId));
  revalidatePath("/admin/library");
  // The card becomes visible on Home the moment it is attached.
  revalidatePath("/home");
  revalidatePath("/clips");
}
