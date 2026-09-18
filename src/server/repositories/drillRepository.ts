import "server-only";
import type { Filter, ObjectId } from "mongodb";
import { drillsCollection } from "@/server/db/collections";
import type { DrillDifficulty, DrillDoc, SkillCategory } from "@/types/db";

export async function findDrillById(drillId: ObjectId): Promise<DrillDoc | null> {
  const collection = await drillsCollection();
  return collection.findOne({ _id: drillId });
}

export async function listDrills(): Promise<DrillDoc[]> {
  const collection = await drillsCollection();
  return collection.find().toArray();
}

/**
 * Drills added since a given instant, for the "new content" notification.
 *
 * A count rather than the documents: the notification only ever states how
 * many there are and links to Train, so loading them would be waste.
 */
export async function countDrillsCreatedSince(since: Date): Promise<number> {
  const collection = await drillsCollection();
  return collection.countDocuments({ createdAt: { $gt: since } });
}

export interface DrillGenerationQuery {
  skillTags: SkillCategory[];
  availableEquipment: string[];
  difficulties?: DrillDifficulty[];
  limit?: number;
}

/**
 * The candidate pool for workout generation.
 *
 * Filtering here rather than loading the whole collection and filtering in JS
 * is what lets generation survive the founders' ~1,000-drill target: the
 * {skillTags, difficulty} index does the work and at most `limit` documents
 * ever reach the service.
 *
 * The equipment clause reads "no item this drill requires is outside what the
 * player has" - the server-side form of the previous in-memory check. It
 * correctly matches drills needing no equipment at all.
 */
export async function findDrillsForGeneration(
  query: DrillGenerationQuery,
): Promise<DrillDoc[]> {
  if (query.skillTags.length === 0) return [];
  const collection = await drillsCollection();

  const filter: Filter<DrillDoc> = {
    skillTags: { $in: query.skillTags },
    equipmentNeeded: {
      $not: { $elemMatch: { $nin: query.availableEquipment } },
    },
  };
  if (query.difficulties && query.difficulties.length > 0) {
    filter.difficulty = { $in: query.difficulties };
  }

  return collection
    .find(filter)
    .limit(query.limit ?? 60)
    .toArray();
}

/**
 * How many drills a player could actually be given per skill, right now.
 *
 * Backs the Train screen's per-skill availability hint, so a skill with no
 * usable drills is visibly marked *before* the player taps Generate rather
 * than failing afterwards (BRD v1.1 §8's no-dead-button rule).
 */
export async function countDrillsBySkill(
  skills: SkillCategory[],
  availableEquipment: string[],
  difficulties?: DrillDifficulty[],
): Promise<Record<string, number>> {
  if (skills.length === 0) return {};
  const collection = await drillsCollection();

  const match: Filter<DrillDoc> = {
    skillTags: { $in: skills },
    equipmentNeeded: { $not: { $elemMatch: { $nin: availableEquipment } } },
  };
  if (difficulties && difficulties.length > 0) {
    match.difficulty = { $in: difficulties };
  }

  const rows = await collection
    .aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $unwind: "$skillTags" },
      { $match: { skillTags: { $in: skills } } },
      { $group: { _id: "$skillTags", count: { $sum: 1 } } },
    ])
    .toArray();

  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

/** Batch id lookup - used to read the skill tags behind a player's signature moves. */
export async function findDrillsByIds(ids: ObjectId[]): Promise<DrillDoc[]> {
  if (ids.length === 0) return [];
  const collection = await drillsCollection();
  return collection.find({ _id: { $in: ids } }).toArray();
}

export async function findDrillBySlug(slug: string): Promise<DrillDoc | null> {
  const collection = await drillsCollection();
  return collection.findOne({ slug });
}

/**
 * Batch slug lookup, keyed by slug. Archetype signature moves reference
 * drills by slug (src/lib/player-archetypes.ts is isomorphic and can't hold
 * ObjectIds), so resolving a player profile needs several at once.
 */
export async function findDrillsBySlugs(
  slugs: string[],
): Promise<Map<string, DrillDoc>> {
  if (slugs.length === 0) return new Map();
  const collection = await drillsCollection();
  const drills = await collection.find({ slug: { $in: slugs } }).toArray();
  return new Map(drills.map((drill) => [drill.slug, drill]));
}
