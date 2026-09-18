/**
 * NBA roster sync (BRD 7.4: "search and browse across the full current
 * league roster - must not be a hardcoded or limited player list").
 *
 * Pulls every currently-active player from balldontlie.io and upserts them
 * into `nbaPlayers`. Safe to re-run: reconciliation is by case-insensitive
 * exact name, and hand-authored `editorial` content is only ever written
 * with $setOnInsert, so re-syncing adopts a seeded player's real roster
 * facts without touching their authored Learn/Skills/Signature-Move content.
 *
 * Why a script and not just the API route: `POST /api/nba-players/sync`
 * exists and works, but a full sync is a long-running batch job, which is a
 * poor fit for a serverless request. This is the operational path, alongside
 * `db:init` and `db:seed`.
 *
 * Why it re-implements the mongo write instead of calling nbaPlayerService:
 * every file under src/server/** starts with `import "server-only"`, whose
 * default export throws outside Next.js's "react-server" export condition -
 * and `tsx` doesn't set one. All the actual decision-making is shared with
 * the service through the pure helpers in src/lib/nba-roster.ts; only the
 * ~10-line bulkWrite differs.
 *
 * Usage: npm run db:sync-roster
 *   Requires BALLDONTLIE_API_KEY in .env.local. Note that GET
 *   /players/active is an ALL-STAR tier endpoint - a free-tier key will be
 *   rejected with a message saying so.
 */
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import { buildRosterSyncOperations, type BalldontliePlayer } from "@/lib/nba-roster";
import { fetchAllActivePlayersWith } from "@/lib/nba-roster-fetch";
import type { NbaPlayerDoc } from "@/types/db";
import { connectForScript } from "./lib/connection";

const BULK_BATCH_SIZE = 500;

export interface RosterSyncSummary {
  fetched: number;
  created: number;
  matched: number;
  skipped: number;
}

/** Core sync logic, exported separately so it's testable against any Db. */
export async function syncRosterIntoDb(
  db: Db,
  players: BalldontliePlayer[],
): Promise<RosterSyncSummary> {
  const collection = db.collection<NbaPlayerDoc>(COLLECTIONS.nbaPlayers);

  const existing = await collection
    .find({}, { projection: { name: 1 } })
    .toArray();
  const existingNames = new Set(existing.map((doc) => doc.name.toLowerCase()));

  const { operations, created, matched, skipped } = buildRosterSyncOperations(
    players,
    existingNames,
    new Date(),
  );

  for (let i = 0; i < operations.length; i += BULK_BATCH_SIZE) {
    const batch = operations.slice(i, i + BULK_BATCH_SIZE);
    // Unordered: one player failing collection validation shouldn't abandon
    // the rest of the roster.
    await collection.bulkWrite(batch, { ordered: false });
  }

  return { fetched: players.length, created, matched, skipped };
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing BALLDONTLIE_API_KEY. Copy .env.example to .env.local and set it " +
        "before running the roster sync. Note that GET /players/active requires " +
        "balldontlie's ALL-STAR tier or higher.",
    );
  }

  console.log("Syncing the current NBA roster from balldontlie.io:");
  const players = await fetchAllActivePlayersWith({
    apiKey,
    baseUrl: process.env.BALLDONTLIE_API_BASE_URL,
    onProgress: (fetched, page) =>
      console.log(`  fetched ${fetched} players (page ${page})`),
  });

  const { client, db } = await connectForScript();
  try {
    const summary = await syncRosterIntoDb(db, players);
    console.log(
      `  done: ${summary.fetched} fetched, ${summary.created} new, ` +
        `${summary.matched} reconciled with existing records` +
        (summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""),
    );
    console.log(
      "  hand-authored editorial content was preserved - roster sync never writes `editorial`.",
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Roster sync failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
