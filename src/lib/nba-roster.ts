/**
 * Pure roster-sync logic, shared by the two callers that need it:
 *   - src/server/services/nbaPlayerService.ts (POST /api/nba-players/sync)
 *   - scripts/db/sync-roster.ts              (npm run db:sync-roster)
 *
 * It lives in src/lib/** rather than src/server/** because the CLI script
 * physically cannot import anything under src/server: those files start with
 * `import "server-only"`, whose default export throws outside Next.js's
 * "react-server" export condition, and `tsx` doesn't set one. Keeping the
 * whole decision-making half pure means both callers share one
 * implementation and only differ in how they hand the operations to mongo.
 *
 * The single most important invariant here: **roster sync never writes
 * `editorial`.** Hand-authored Learn/Skills/Signature-Move content is
 * adopted by the real player record, never clobbered by it.
 */
import type { AnyBulkWriteOperation } from "mongodb";
import { classifyArchetype } from "@/lib/player-archetypes";
import type { NbaPlayerDoc } from "@/types/db";

/** Only the wire fields this app actually consumes. */
export interface BalldontlieTeam {
  id: number;
  full_name: string;
  abbreviation: string;
}

export interface BalldontliePlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string | null;
  jersey_number: string | null;
  height: string | null; // "6-6" (feet-inches)
  weight: string | null; // "185" (pounds, as a string)
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: BalldontlieTeam | null;
}

/** "6-6" -> 78. Defensive: balldontlie's height format has varied across API versions. */
export function parseHeightToInches(height: string | null): number | undefined {
  if (!height) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(height.trim());
  if (!match) return undefined;
  const feet = Number(match[1]);
  const inches = Number(match[2]);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return undefined;
  return feet * 12 + inches;
}

/** balldontlie returns weight as a string ("185"); anything else is dropped. */
export function parsePositiveInt(value: string | number | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

export function playerFullName(player: BalldontliePlayer): string {
  return `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
}

/**
 * Exactly the fields the roster owns. Deliberately excludes `editorial` and
 * `createdAt`, which belong to content seeding and insert-time respectively.
 */
export type SyncedPlayerFields = Pick<
  NbaPlayerDoc,
  "externalId" | "syncStatus" | "name" | "team" | "position" | "lastSyncedAt"
> &
  Partial<
    Pick<
      NbaPlayerDoc,
      | "jerseyNumber"
      | "heightInches"
      | "weightPounds"
      | "college"
      | "country"
      | "draftYear"
      | "draftRound"
      | "draftNumber"
      | "archetypeKey"
      | "playerImageUrl"
    >
  >;

/**
 * `undefined` values would be written as nulls by some drivers and would
 * clobber a previously-known value with nothing, so they're stripped. A
 * player whose college is missing this sync keeps the college we already had.
 */
function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export function buildSyncedFields(
  player: BalldontliePlayer,
  syncedAt: Date,
): SyncedPlayerFields {
  const heightInches = parseHeightToInches(player.height);
  const position = player.position?.trim() || "Unknown";

  return omitUndefined({
    externalId: String(player.id),
    syncStatus: "synced" as const,
    name: playerFullName(player),
    team: player.team?.full_name ?? "Unassigned",
    position,
    lastSyncedAt: syncedAt,
    jerseyNumber: player.jersey_number?.trim() || undefined,
    heightInches,
    weightPounds: parsePositiveInt(player.weight),
    college: player.college?.trim() || undefined,
    country: player.country?.trim() || undefined,
    draftYear: parsePositiveInt(player.draft_year),
    draftRound: parsePositiveInt(player.draft_round),
    draftNumber: parsePositiveInt(player.draft_number),
    // Recomputed every sync so an upstream height/position correction flows
    // straight through to which archetype pack backs the profile.
    archetypeKey: classifyArchetype({ position, heightInches }),
  });
}

export interface RosterSyncOperations {
  operations: AnyBulkWriteOperation<NbaPlayerDoc>[];
  created: number;
  matched: number;
  skipped: number;
}

/**
 * Turns a fetched roster into one batch of upserts.
 *
 * Reconciliation is by case-insensitive exact name, which is how an
 * editorial-seeded player (`syncStatus: "pending_sync"`, placeholder team)
 * gets adopted by their real roster record instead of being duplicated.
 *
 * @param existingNames lowercased names already present in the collection.
 */
export function buildRosterSyncOperations(
  players: BalldontliePlayer[],
  existingNames: Set<string>,
  syncedAt: Date,
): RosterSyncOperations {
  const operations: AnyBulkWriteOperation<NbaPlayerDoc>[] = [];
  // Guards against the API returning the same player on two pages, which
  // would otherwise produce two conflicting ops in one bulkWrite.
  const seen = new Set<string>();
  let created = 0;
  let matched = 0;
  let skipped = 0;

  for (const player of players) {
    const name = playerFullName(player);
    if (!name) {
      skipped++;
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    const fields = buildSyncedFields(player, syncedAt);
    const isExisting = existingNames.has(key);
    if (isExisting) {
      matched++;
    } else {
      created++;
    }

    operations.push({
      updateOne: {
        // Anchored, case-insensitive - matches findPlayerByExactName's
        // reconciliation key so both paths agree on what "already exists".
        filter: {
          name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        },
        update: {
          $set: fields,
          // Only ever set on insert: an empty editorial shell for a brand-new
          // player. Never touched for an existing one, so authored content
          // survives every sync.
          $setOnInsert: {
            createdAt: syncedAt,
            editorial: emptyEditorial(),
          },
        },
        upsert: true,
      },
    });
  }

  return { operations, created, matched, skipped };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A brand-new synced player carries no authored content. The archetype pack
 * (resolved at read time from `archetypeKey`) is what actually populates
 * their profile - this shell just keeps the document shape uniform.
 */
export function emptyEditorial(): NbaPlayerDoc["editorial"] {
  return {
    learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
    skills: {
      shooting: 0,
      finishing: 0,
      ballHandling: 0,
      playmaking: 0,
      defense: 0,
      athleticism: 0,
    },
    strengths: [],
    weaknesses: [],
    bio: { careerInfo: "" },
    signatureMoves: [],
  };
}
