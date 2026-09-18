import "server-only";
import { ObjectId } from "mongodb";
import {
  countAllCollections,
  drillBreakdown,
  listUsersForAdmin,
  mediaBreakdown,
  rosterStatus,
  updateUserRole,
  type AdminUserRow,
  type CollectionCount,
  type DrillBreakdown,
  type MediaBreakdown,
  type RosterStatus,
} from "@/server/repositories/adminRepository";
import { isOpenAiConfigured } from "@/server/external/openaiClient";
import { requireAdminUserId } from "@/server/auth/require-session";
import { NotFoundError, ValidationError } from "@/server/errors";
import { COLLECTIONS } from "@/lib/db-constants";
import type { Role } from "@/types/db";

/**
 * The admin dashboard's read and write model (BRD 6.2: "admin dashboard for
 * player, content, user, and AI management").
 *
 * Every exported function calls `requireAdminUserId()` itself rather than
 * trusting the route layout that rendered it. The layout gate stops a screen
 * appearing; it does nothing about a Server Action invoked directly by anyone
 * who knows its name, and these functions read and write across every player's
 * data.
 */

export interface AdminOverview {
  collections: CollectionCount[];
  /** The handful worth reading first, in the order they matter. */
  highlights: { label: string; value: number; hint: string }[];
}

const HIGHLIGHTS: { collection: string; label: string; hint: string }[] = [
  { collection: COLLECTIONS.users, label: "Accounts", hint: "Total sign-ups" },
  {
    collection: COLLECTIONS.playerProfiles,
    label: "Profiles",
    hint: "Players who started onboarding",
  },
  {
    collection: COLLECTIONS.workouts,
    label: "Workouts",
    hint: "Generated and completed",
  },
  {
    collection: COLLECTIONS.shotSessions,
    label: "Shot sessions",
    hint: "Tap-logged sessions",
  },
  {
    collection: COLLECTIONS.coachMessages,
    label: "Coach messages",
    hint: "Both sides of every conversation",
  },
  {
    collection: COLLECTIONS.drills,
    label: "Drills",
    hint: "Authored plus variants",
  },
];

export async function getAdminOverview(): Promise<AdminOverview> {
  await requireAdminUserId();

  const collections = await countAllCollections();
  const byName = new Map(collections.map((c) => [c.name, c.count]));

  return {
    collections,
    highlights: HIGHLIGHTS.map((h) => ({
      label: h.label,
      value: byName.get(h.collection) ?? 0,
      hint: h.hint,
    })),
  };
}

export async function listPlayers(limit = 100): Promise<AdminUserRow[]> {
  await requireAdminUserId();
  return listUsersForAdmin(limit);
}

/**
 * Promotes or demotes an account.
 *
 * Two things about this are not obvious and are surfaced in the UI rather than
 * buried here, because an admin who misreads either will think the control is
 * broken:
 *
 * 1. It takes effect at that person's **next sign-in**. Sessions are JWTs
 *    (auth.config.ts) and the role is stamped into the token when it is
 *    minted, so an already-signed-in user keeps the role they had.
 * 2. The `ADMIN_EMAILS` environment allow-list **wins over this field**.
 *    Demoting an address that appears there has no lasting effect - the next
 *    token mint resolves it back to admin.
 *
 * An admin also cannot demote themselves, which is the cheapest possible guard
 * against locking every administrator out of the dashboard at once.
 */
export async function setUserRole(
  targetUserId: ObjectId,
  role: Role,
): Promise<void> {
  const actingUserId = await requireAdminUserId();

  if (targetUserId.toString() === actingUserId) {
    throw new ValidationError("You can't change your own role.");
  }

  const updated = await updateUserRole(targetUserId, role);
  if (!updated) {
    throw new NotFoundError("That account no longer exists.");
  }
}

export interface ContentStatus {
  drills: DrillBreakdown;
  roster: RosterStatus;
  media: MediaBreakdown[];
}

export async function getContentStatus(): Promise<ContentStatus> {
  await requireAdminUserId();

  const [drills, roster, media] = await Promise.all([
    drillBreakdown(),
    rosterStatus(),
    mediaBreakdown(),
  ]);

  return { drills, roster, media };
}

/**
 * What each AI-shaped surface is actually doing right now.
 *
 * This exists because the honesty rules the UI follows for players (simulated
 * analysis is labelled, archetype content describes a role rather than a
 * person) are only enforceable if somebody can see the real configuration.
 * "Is the Coach answering from a model or from templates today?" is an
 * operational question, and before this screen the only way to answer it was
 * to read the environment on the server.
 *
 * `configured` never contains a key or any part of one - only whether one is
 * present.
 */
export interface AiSurfaceStatus {
  surface: string;
  /** What runs when a key is present. */
  live: string;
  /** What runs when it isn't - never "nothing". */
  fallback: string;
  configured: boolean;
  /** True when output is generated rather than measured, and must be labelled. */
  mustBeLabelled: boolean;
}

export interface AiStatus {
  openAiConfigured: boolean;
  chatModel: string;
  visionModel: string;
  surfaces: AiSurfaceStatus[];
  coachRateLimit: { maxMessages: number; windowMinutes: number };
}

export async function getAiStatus(): Promise<AiStatus> {
  await requireAdminUserId();

  const configured = isOpenAiConfigured();

  return {
    openAiConfigured: configured,
    // Defaults mirror `openaiClient`, so this screen reports what would
    // actually be called rather than what is merely set.
    chatModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    visionModel: process.env.OPENAI_VISION_MODEL || "gpt-4o",
    coachRateLimit: { maxMessages: 20, windowMinutes: 10 },
    surfaces: [
      {
        surface: "AI Coach",
        live: "Model-generated replies, grounded in the player's own records",
        fallback: "Deterministic replies built from the same records",
        configured,
        mustBeLabelled: false,
      },
      {
        surface: "Feed card copy",
        live: "Model rewrites the prose around figures the templates fixed",
        fallback: "Template copy only",
        configured,
        mustBeLabelled: true,
      },
      {
        surface: "Game film analysis",
        live: "Vision pass over frames lifted from the clip",
        fallback: "Heuristic review built from the player's profile",
        configured,
        mustBeLabelled: true,
      },
      {
        surface: "Shot mechanics",
        live: "Not yet - real pose estimation is still Phase 2",
        fallback: "Simulated mechanical narrative over real tap-logged shots",
        configured: false,
        mustBeLabelled: true,
      },
      {
        surface: "Notification copy",
        live: "Not used - notifications are template-only by design",
        fallback: "Deterministic templates",
        configured: false,
        mustBeLabelled: false,
      },
    ],
  };
}
