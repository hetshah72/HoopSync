import "server-only";
import { ExternalServiceError } from "@/server/errors";
import {
  fetchAllActivePlayersWith,
  type BalldontliePlayer,
} from "@/lib/nba-roster-fetch";

/**
 * Thin server-side wrapper around balldontlie.io's v1 API - the source of
 * real, current NBA roster/bio data (BRD 7.4: NBA Player Mode must support
 * the full current roster, not a hardcoded list).
 *
 * The fetch/pagination/backoff logic itself lives in
 * src/lib/nba-roster-fetch.ts so `npm run db:sync-roster` can reuse it -
 * scripts can't import anything under src/server (see that file's header).
 * This module exists to bind it to the app's env + AppError conventions.
 */
export type { BalldontliePlayer, BalldontlieTeam } from "@/lib/nba-roster";
export { parseHeightToInches } from "@/lib/nba-roster";

function requireApiKey(): string {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) {
    throw new ExternalServiceError(
      "BALLDONTLIE_API_KEY is not configured - the NBA roster sync can't run without it.",
    );
  }
  return key;
}

/** Fetches every currently-active NBA player, following cursor pagination. */
export async function fetchAllActivePlayers(): Promise<BalldontliePlayer[]> {
  try {
    return await fetchAllActivePlayersWith({
      apiKey: requireApiKey(),
      baseUrl: process.env.BALLDONTLIE_API_BASE_URL,
    });
  } catch (err) {
    if (err instanceof ExternalServiceError) throw err;
    throw new ExternalServiceError(
      err instanceof Error ? err.message : "The balldontlie roster sync failed.",
    );
  }
}
