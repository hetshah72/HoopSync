import "server-only";
import { ObjectId } from "mongodb";
import { getDb } from "@/server/db/client";
import {
  drillsCollection,
  mediaAssetsCollection,
  nbaPlayersCollection,
  usersCollection,
} from "@/server/db/collections";
import { COLLECTIONS } from "@/lib/db-constants";
import type { DrillDifficulty, Role, SkillCategory } from "@/types/db";

/**
 * Read-side aggregations for the admin dashboard (BRD 6.2).
 *
 * Counts rather than documents wherever possible: an admin overview that loads
 * every workout to count them would get slower with every player who signs up,
 * which is precisely backwards for the screen you look at when the product is
 * working.
 */

export interface CollectionCount {
  name: string;
  count: number;
}

/**
 * Row counts for every collection the app owns.
 *
 * Driven off `COLLECTIONS` rather than a hand-kept list, so a collection added
 * later shows up here without anyone remembering to update the dashboard - the
 * same reason `tests/integration/db-init.test.ts` iterates it.
 */
export async function countAllCollections(): Promise<CollectionCount[]> {
  const db = await getDb();
  const names = Object.values(COLLECTIONS);

  const counts = await Promise.all(
    names.map(async (name) => ({
      name,
      // A collection that hasn't been created yet reads as empty rather than
      // throwing - `db:init` may not have run in a fresh environment.
      count: await db
        .collection(name)
        .estimatedDocumentCount()
        .catch(() => 0),
    })),
  );

  return counts;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name?: string;
  role: Role;
  createdAt: Date;
  /** Absent until they finish onboarding. */
  displayName?: string;
  onboardingCompletedAt?: Date;
  currentStreak?: number;
  totalWorkoutsCompleted?: number;
  lastActivityDate?: Date;
}

/**
 * The player list, joined to profile and stats in one aggregation.
 *
 * `$lookup` rather than N+1 per-user reads: the dashboard shows a page of
 * users at a time and three round trips per row would dominate the response.
 *
 * Deliberately projects a narrow set of fields. The wider profile carries date
 * of birth, height and weight for players who are mostly minors, and an admin
 * list is a screen for operating the product, not for browsing children's
 * personal details - so it surfaces identity plus activity and nothing more.
 * `passwordHash` is excluded explicitly as well as by omission.
 */
export async function listUsersForAdmin(
  limit = 100,
): Promise<AdminUserRow[]> {
  const collection = await usersCollection();

  const rows = await collection
    .aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: COLLECTIONS.playerProfiles,
          localField: "_id",
          foreignField: "userId",
          as: "profile",
        },
      },
      {
        $lookup: {
          from: COLLECTIONS.userStats,
          localField: "_id",
          foreignField: "userId",
          as: "stats",
        },
      },
      {
        $project: {
          email: 1,
          name: 1,
          role: 1,
          createdAt: 1,
          displayName: { $first: "$profile.displayName" },
          onboardingCompletedAt: { $first: "$profile.onboardingCompletedAt" },
          currentStreak: { $first: "$stats.currentStreak" },
          totalWorkoutsCompleted: { $first: "$stats.totalWorkoutsCompleted" },
          lastActivityDate: { $first: "$stats.lastActivityDate" },
        },
      },
    ])
    .toArray();

  return rows.map((row) => ({
    id: String(row._id),
    email: row.email,
    name: row.name,
    role: (row.role ?? "player") as Role,
    createdAt: row.createdAt,
    displayName: row.displayName,
    onboardingCompletedAt: row.onboardingCompletedAt,
    currentStreak: row.currentStreak,
    totalWorkoutsCompleted: row.totalWorkoutsCompleted,
    lastActivityDate: row.lastActivityDate,
  }));
}

/** Writes the stored role. See `setUserRole` in adminService for the caveats. */
export async function updateUserRole(
  userId: ObjectId,
  role: Role,
): Promise<boolean> {
  const collection = await usersCollection();
  const result = await collection.updateOne({ _id: userId }, { $set: { role } });
  return result.matchedCount === 1;
}

export interface DrillBreakdown {
  total: number;
  authored: number;
  variants: number;
  bySkill: { skill: SkillCategory; count: number }[];
  byDifficulty: { difficulty: DrillDifficulty; count: number }[];
}

/**
 * What the drill library actually contains.
 *
 * Splits authored from variant because the ~1,000-drill headline figure is
 * only meaningful alongside it (see `src/lib/drill-library.ts`) - an admin
 * looking at content volume should see both halves, not a single number that
 * implies a thousand independently written drills.
 */
export async function drillBreakdown(): Promise<DrillBreakdown> {
  const collection = await drillsCollection();

  const [total, variants, bySkillRaw, byDifficultyRaw] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection.countDocuments({ variantOf: { $exists: true } }),
    collection
      .aggregate([
        { $unwind: "$skillTags" },
        { $group: { _id: "$skillTags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    collection
      .aggregate([{ $group: { _id: "$difficulty", count: { $sum: 1 } } }])
      .toArray(),
  ]);

  return {
    total,
    authored: total - variants,
    variants,
    bySkill: bySkillRaw.map((r) => ({
      skill: r._id as SkillCategory,
      count: r.count as number,
    })),
    byDifficulty: byDifficultyRaw.map((r) => ({
      difficulty: r._id as DrillDifficulty,
      count: r.count as number,
    })),
  };
}

export interface RosterStatus {
  total: number;
  synced: number;
  pendingSync: number;
  withAuthoredEditorial: number;
  lastSyncedAt?: Date;
}

/** Roster freshness, which is what decides whether a sync is worth running. */
export async function rosterStatus(): Promise<RosterStatus> {
  const collection = await nbaPlayersCollection();

  const [total, synced, withAuthoredEditorial, newest] = await Promise.all([
    collection.estimatedDocumentCount(),
    collection.countDocuments({ syncStatus: "synced" }),
    collection.countDocuments({ editorial: { $exists: true } }),
    collection
      .find({ lastSyncedAt: { $exists: true } })
      .sort({ lastSyncedAt: -1 })
      .limit(1)
      .toArray(),
  ]);

  return {
    total,
    synced,
    pendingSync: total - synced,
    withAuthoredEditorial,
    lastSyncedAt: newest[0]?.lastSyncedAt,
  };
}

export interface MediaBreakdown {
  source: string;
  count: number;
}

/**
 * Media by rights basis (BRD 7.14).
 *
 * The one number here that matters operationally is how much content is still
 * `placeholder`: that is the backlog standing between the app and real
 * footage, and it is the thing a licensing conversation turns on.
 */
export async function mediaBreakdown(): Promise<MediaBreakdown[]> {
  const collection = await mediaAssetsCollection();
  const rows = await collection
    .aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return rows.map((r) => ({
    source: String(r._id ?? "unknown"),
    count: r.count as number,
  }));
}
