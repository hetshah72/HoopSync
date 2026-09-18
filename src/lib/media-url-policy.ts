/**
 * Where HoopSync is willing to load content from (BRD 7.14 success criterion
 * #2: "No league-owned footage is used before the pending license is in
 * place").
 *
 * Two lists doing two different jobs, and the split matters:
 *
 *   - The DENYLIST is the BRD-load-bearing half. League-owned and known
 *     highlight-scrape hosts are refused at write *and* re-checked at read,
 *     so a URL that got into the database before this existed still cannot
 *     reach a screen.
 *   - The ALLOWLIST is a write-time hygiene check only, and it is
 *     data-driven. An earlier draft of this made it a closed compile-time
 *     constant, which would have made the licensed-content path the whole
 *     feature exists to serve permanently unreachable: an admin could never
 *     register a licensed clip without a code change and a redeploy.
 *
 * Pure and isomorphic because both `scripts/db/**` and `src/server/**` must
 * reach it - scripts cannot import `@/server/**` (those files start with
 * `import "server-only"`, which throws under `tsx`), so shared policy has to
 * live here. Same reason as `src/lib/nba-roster.ts`.
 */

/**
 * Hosts whose footage HoopSync has no right to, pending the licence BRD 6.4
 * describes. Matched on the registrable domain, so subdomains are covered.
 *
 * This is not a security boundary - it cannot stop a determined contributor
 * with a proxy. It is a guardrail that makes the wrong thing fail loudly
 * rather than ship quietly, which is what success criterion #2 needs.
 */
export const BLOCKED_MEDIA_HOSTS: readonly string[] = [
  "nba.com",
  "nbaimages.com",
  "wnba.com",
  "gleague.nba.com",
  "turner.com",
  "ncaa.com",
  "espn.com",
  "espncdn.com",
  "foxsports.com",
  "bleacherreport.com",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "tiktok.com",
  "instagram.com",
  "cdninstagram.com",
  "fbcdn.net",
  "twimg.com",
];

/** Hosts we always accept: our own storage. Unioned with the env allowlist. */
const BUILT_IN_ALLOWED_HOSTS: readonly string[] = [
  "storage.googleapis.com",
];

export type MediaUrlVerdict =
  | { ok: true }
  | { ok: false; reason: "blocked_host"; host: string }
  | { ok: false; reason: "unlisted_host"; host: string }
  | { ok: false; reason: "unsupported_scheme"; scheme: string }
  | { ok: false; reason: "malformed" };

export interface MediaUrlPolicyOptions {
  /**
   * Extra hosts to accept, from `MEDIA_ALLOWED_HOSTS` - the mechanism by
   * which an admin can take delivery of licensed footage without a redeploy.
   */
  extraHosts?: readonly string[];
  /**
   * Skip the allowlist and apply only the denylist. Used on the read path:
   * refusing to render an already-stored asset because its host is merely
   * unlisted would brick content that was legitimately accepted earlier,
   * whereas a league host must be refused however it got in.
   */
  denyOnly?: boolean;
}

/** Parses `MEDIA_ALLOWED_HOSTS` (comma-separated). Safe on the client, where it is empty. */
export function allowedHostsFromEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Relative URLs are our own bytes - the dev-only `public/uploads` fallback in
 * `mediaStorageService`, and vendored files under `public/`. They have no
 * host to check and are always allowed.
 */
function isRelative(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

function registrableSuffixMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/**
 * The single verdict function. Callers translate it into their own error type
 * - this module deliberately throws nothing, so it stays importable from a
 * script, a repository, and a React component alike.
 */
export function classifyMediaUrl(
  url: string,
  options: MediaUrlPolicyOptions = {},
): MediaUrlVerdict {
  if (isRelative(url)) return { ok: true };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "unsupported_scheme", scheme: parsed.protocol };
  }

  const host = parsed.hostname.toLowerCase();

  const blocked = BLOCKED_MEDIA_HOSTS.find((candidate) =>
    registrableSuffixMatches(host, candidate),
  );
  if (blocked) return { ok: false, reason: "blocked_host", host };

  if (options.denyOnly) return { ok: true };

  const allowed = [...BUILT_IN_ALLOWED_HOSTS, ...(options.extraHosts ?? [])];
  const permitted = allowed.some((candidate) =>
    registrableSuffixMatches(host, candidate),
  );
  if (!permitted) return { ok: false, reason: "unlisted_host", host };

  return { ok: true };
}

/** Human-readable rejection, used verbatim in the thrown error and the audit report. */
export function mediaUrlRejectionMessage(
  verdict: Exclude<MediaUrlVerdict, { ok: true }>,
): string {
  switch (verdict.reason) {
    case "blocked_host":
      return (
        `Refusing content from ${verdict.host}: HoopSync has no licence for ` +
        "league-owned or scraped footage (BRD 7.14). Use original, generated, " +
        "properly licensed, public-domain, or clearly labeled placeholder content."
      );
    case "unlisted_host":
      return (
        `Refusing content from ${verdict.host}: the host is not on the allowed ` +
        "list. Upload the file to HoopSync's own storage, or add the host to " +
        "MEDIA_ALLOWED_HOSTS once its licence is on file."
      );
    case "unsupported_scheme":
      return `Refusing a media URL with an unsupported scheme (${verdict.scheme}).`;
    case "malformed":
      return "Refusing a media URL that could not be parsed.";
  }
}
