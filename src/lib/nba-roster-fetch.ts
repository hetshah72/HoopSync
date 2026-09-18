/**
 * balldontlie.io v1 roster fetching - pagination, retry and backoff.
 *
 * Lives in src/lib/** (not src/server/external) purely so
 * `npm run db:sync-roster` can reuse it: scripts run under `tsx`, and
 * anything importing `server-only` throws there. src/server/external/
 * balldontlieClient.ts is the thin app-facing wrapper that binds this to
 * env vars and AppError.
 *
 * Endpoint/tier note, verified against balldontlie's published pricing:
 * `GET /players/active` is an **ALL-STAR tier** endpoint ($9.99/mo, 60
 * req/min). The free tier (5 req/min) has only `GET /players`, which returns
 * every player in league history with no "active" flag - not a current
 * roster. A free key will therefore 401 here, and `describeAuthFailure`
 * below says so explicitly rather than leaving a bare "HTTP 401".
 */
import type { BalldontliePlayer } from "@/lib/nba-roster";

export type { BalldontliePlayer, BalldontlieTeam } from "@/lib/nba-roster";

interface PaginatedResponse<T> {
  data: T[];
  meta: { next_cursor?: number | null; per_page: number };
}

const DEFAULT_BASE_URL = "https://api.balldontlie.io/v1";
const PER_PAGE = 100;
/** ~570 active players at 100/page needs ~6 pages; 50 is a runaway guard. */
const MAX_PAGES = 50;
const MAX_ATTEMPTS_PER_PAGE = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export interface FetchRosterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests so retry paths don't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  onProgress?: (fetched: number, page: number) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeAuthFailure(status: number): string {
  if (status === 401) {
    return (
      "balldontlie rejected the API key (HTTP 401). Note that GET /players/active " +
      "requires the ALL-STAR tier or higher - a free-tier key cannot read the " +
      "active roster."
    );
  }
  if (status === 403) {
    return (
      "balldontlie refused the request (HTTP 403). GET /players/active requires " +
      "the ALL-STAR tier or higher; check the plan attached to this key."
    );
  }
  return `balldontlie API request failed (HTTP ${status}).`;
}

/**
 * Honours `Retry-After` when the API sends it (it does on 429), falling back
 * to exponential backoff. The free tier allows only 5 requests/minute, so a
 * misconfigured key hits 429 immediately rather than after a few pages -
 * without this the sync failed on the first rate-limit response.
 */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1_000, MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

async function fetchPage(
  cursor: number | undefined,
  options: FetchRosterOptions,
): Promise<PaginatedResponse<BalldontliePlayer>> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;

  const url = new URL(`${baseUrl}/players/active`);
  url.searchParams.set("per_page", String(PER_PAGE));
  if (cursor !== undefined) {
    url.searchParams.set("cursor", String(cursor));
  }

  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PAGE; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { Authorization: options.apiKey },
      });
    } catch (err) {
      // Network-level failure: worth retrying, unlike a 4xx.
      lastError =
        err instanceof Error ? err.message : "Could not reach the balldontlie API.";
      await sleep(backoffMs(attempt, null));
      continue;
    }

    if (response.ok) {
      return (await response.json()) as PaginatedResponse<BalldontliePlayer>;
    }

    // 401/403 are configuration problems - retrying can't fix them, and
    // hammering a rejected key is worse than failing fast.
    if (response.status === 401 || response.status === 403) {
      throw new Error(describeAuthFailure(response.status));
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = describeAuthFailure(response.status);
      await sleep(backoffMs(attempt, response.headers.get("retry-after")));
      continue;
    }

    throw new Error(describeAuthFailure(response.status));
  }

  throw new Error(
    `balldontlie API request failed after ${MAX_ATTEMPTS_PER_PAGE} attempts. ${lastError}`.trim(),
  );
}

export async function fetchAllActivePlayersWith(
  options: FetchRosterOptions,
): Promise<BalldontliePlayer[]> {
  const players: BalldontliePlayer[] = [];
  let cursor: number | undefined;
  let page = 0;

  do {
    const response = await fetchPage(cursor, options);
    players.push(...(response.data ?? []));
    page++;
    options.onProgress?.(players.length, page);

    const next = response.meta?.next_cursor ?? undefined;
    // A cursor that doesn't advance would loop forever; treat it as the end.
    cursor = next === cursor ? undefined : (next ?? undefined);
  } while (cursor !== undefined && page < MAX_PAGES);

  return players;
}
