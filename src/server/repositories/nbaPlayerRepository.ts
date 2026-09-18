import "server-only";
import { ObjectId, type AnyBulkWriteOperation, type Filter } from "mongodb";
import { nbaPlayersCollection } from "@/server/db/collections";
import { escapeRegex } from "@/lib/nba-roster";
import {
  normalizePositionGroup,
  type PlayerArchetypeKey,
  type PositionGroup,
} from "@/lib/player-archetypes";
import type { NbaPlayerDoc } from "@/types/db";

export interface ListPlayersOptions {
  search?: string;
  team?: string;
  positionGroup?: PositionGroup;
  limit?: number;
  skip?: number;
}

export interface ListPlayersResult {
  players: NbaPlayerDoc[];
  /** Total matching the filters, so the UI can page honestly. */
  total: number;
}

export const PLAYERS_PAGE_SIZE = 40;

function buildFilter(options: ListPlayersOptions): Filter<NbaPlayerDoc> {
  const filter: Filter<NbaPlayerDoc> = {};

  const search = options.search?.trim();
  if (search) {
    // Substring, case-insensitive. The collection's {name:"text"} index can
    // only do whole-word stemmed matching, so "Cur" would never find
    // "Curry" through $text - a search-as-you-type box needs regex.
    filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  const team = options.team?.trim();
  if (team) {
    filter.team = team;
  }

  return filter;
}

/**
 * Position filtering happens in the query for the common cases and is
 * normalized in JS for the rest: balldontlie emits "G", "F-C", "C" while our
 * own editorial seed uses "Point Guard"/"Small Forward", so no single regex
 * cleanly separates the three groups. Matching the group after the fact
 * keeps `normalizePositionGroup` the single source of truth.
 */
function matchesPositionGroup(
  player: NbaPlayerDoc,
  group: PositionGroup | undefined,
): boolean {
  if (!group) return true;
  return normalizePositionGroup(player.position) === group;
}

export async function listPlayers(
  options: ListPlayersOptions = {},
): Promise<ListPlayersResult> {
  const collection = await nbaPlayersCollection();
  const filter = buildFilter(options);
  const limit = options.limit ?? PLAYERS_PAGE_SIZE;
  const skip = options.skip ?? 0;

  if (!options.positionGroup) {
    const [players, total] = await Promise.all([
      collection.find(filter).sort({ name: 1 }).skip(skip).limit(limit).toArray(),
      collection.countDocuments(filter),
    ]);
    return { players, total };
  }

  // With a position filter the count has to come from the normalized match,
  // so page through the filtered set rather than trusting a mongo count.
  const all = await collection.find(filter).sort({ name: 1 }).toArray();
  const matching = all.filter((p) => matchesPositionGroup(p, options.positionGroup));
  return {
    players: matching.slice(skip, skip + limit),
    total: matching.length,
  };
}

export async function findPlayerById(id: ObjectId): Promise<NbaPlayerDoc | null> {
  const collection = await nbaPlayersCollection();
  return collection.findOne({ _id: id });
}

/** Case-insensitive exact match - used to reconcile a sync against an editorial-seeded player. */
export async function findPlayerByExactName(
  name: string,
): Promise<NbaPlayerDoc | null> {
  const collection = await nbaPlayersCollection();
  return collection.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  });
}

export async function countPlayers(): Promise<number> {
  const collection = await nbaPlayersCollection();
  return collection.countDocuments();
}

/**
 * Players carrying hand-authored signature moves - the marquee tier.
 *
 * Home's "player to learn from" card (BRD 7.2) prefers these because their
 * Learn text is written about that specific player, so the card can say
 * something true and concrete rather than describing a role.
 */
export async function listPlayersWithAuthoredEditorial(
  limit = 25,
): Promise<NbaPlayerDoc[]> {
  const collection = await nbaPlayersCollection();
  return collection
    .find({ "editorial.signatureMoves.0": { $exists: true } })
    .limit(limit)
    .toArray();
}

/**
 * Synced players classified into any of the given archetypes - the fallback
 * when no authored player matches the skill being trained. Archetype content
 * describes a role, so the UI must label it as such.
 */
export async function listPlayersByArchetype(
  archetypeKeys: readonly PlayerArchetypeKey[],
  limit = 25,
): Promise<NbaPlayerDoc[]> {
  if (archetypeKeys.length === 0) return [];
  const collection = await nbaPlayersCollection();
  return collection
    .find({ archetypeKey: { $in: [...archetypeKeys] }, syncStatus: "synced" })
    .limit(limit)
    .toArray();
}

/** Distinct team names, for the browse filter. Excludes unsynced placeholders. */
export async function listTeams(): Promise<string[]> {
  const collection = await nbaPlayersCollection();
  const teams = await collection.distinct("team", { syncStatus: "synced" });
  return teams.filter((team): team is string => Boolean(team)).sort();
}

/** Lowercased names of every player already stored - the sync reconciliation key. */
export async function listExistingPlayerNames(): Promise<Set<string>> {
  const collection = await nbaPlayersCollection();
  const docs = await collection
    .find({}, { projection: { name: 1 } })
    .toArray();
  return new Set(docs.map((doc) => doc.name.toLowerCase()));
}

export async function insertPlayer(
  doc: Omit<NbaPlayerDoc, "_id">,
): Promise<NbaPlayerDoc> {
  const collection = await nbaPlayersCollection();
  const full: NbaPlayerDoc = { ...doc, _id: new ObjectId() };
  await collection.insertOne(full);
  return full;
}

/**
 * Applies a whole roster sync in batches.
 *
 * Replaces the previous find-then-write-per-player loop, which issued two
 * serialized round-trips for each of ~570 players and was the documented
 * reason a full sync was expected to time out on a serverless host.
 */
const BULK_BATCH_SIZE = 500;

export async function bulkUpsertSyncedPlayers(
  operations: AnyBulkWriteOperation<NbaPlayerDoc>[],
): Promise<void> {
  if (operations.length === 0) return;
  const collection = await nbaPlayersCollection();

  for (let i = 0; i < operations.length; i += BULK_BATCH_SIZE) {
    const batch = operations.slice(i, i + BULK_BATCH_SIZE);
    // Unordered: one player's validation failure shouldn't abandon the rest
    // of the roster.
    await collection.bulkWrite(batch, { ordered: false });
  }
}
