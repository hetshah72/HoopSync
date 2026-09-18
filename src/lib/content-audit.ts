/**
 * The mechanical check behind BRD 7.14's success criteria.
 *
 *   1. "Every piece of content shipped in the MVP has a traceable, legitimate
 *      source"
 *   2. "No league-owned footage is used before the pending license is in place"
 *
 * Pure and isomorphic: `scripts/db/**` cannot import `@/server/**` (those
 * files start with `import "server-only"`, which throws under `tsx`), so the
 * walking logic lives here and the script supplies the documents. That also
 * makes every rule unit-testable without a database.
 *
 * A note on honesty, because this report is the thing a reviewer screenshots:
 * `describeAuditScope()` states what was walked *and what was not*. A total
 * that silently implies completeness it does not have would be exactly the
 * kind of overstatement this file exists to catch elsewhere.
 */
import { classifyMediaUrl } from "@/lib/media-url-policy";
import type { MediaAssetSource } from "@/types/db";

export type ContentFindingCode =
  | "blocked_host"
  | "missing_asset"
  | "untraceable_url"
  | "missing_rights_holder"
  | "missing_license_notes"
  | "uncleared_in_use";

export interface ContentFinding {
  code: ContentFindingCode;
  /** Where the problem is, e.g. `drills/form-shooting-ladder`. */
  where: string;
  detail: string;
  /**
   * Findings that violate a BRD success criterion fail the run. Advisory ones
   * (an un-backfilled legacy row) are reported without failing, so the script
   * stays useful as a census rather than becoming noise people learn to skip.
   */
  severity: "violation" | "advisory";
}

/** Only the fields the audit reads, so callers can pass raw documents. */
export interface AuditMediaAsset {
  id: string;
  url: string;
  source: MediaAssetSource;
  rightsHolder?: string;
  licenseNotes?: string;
  rightsClearedAt?: Date | null;
}

export interface AuditContentRef {
  /** e.g. `drills/form-shooting-ladder` or `feedItems/<id>`. */
  where: string;
  /** The asset this content claims to be backed by, if any. */
  assetId?: string | null;
  /** A URL rendered directly by the UI, if any. */
  url?: string | null;
  /**
   * True when the content is visible to players. Uncleared rights only matter
   * for content actually in use (BRD 7.14: "Production content must have
   * cleared rights before use").
   */
  inUse: boolean;
}

export interface ContentAuditInput {
  assets: AuditMediaAsset[];
  refs: AuditContentRef[];
  /** From MEDIA_ALLOWED_HOSTS, so a licensed host is not reported as unknown. */
  allowedHosts?: readonly string[];
}

export interface ContentAuditReport {
  findings: ContentFinding[];
  counts: {
    assets: number;
    refs: number;
    violations: number;
    advisories: number;
  };
  bySource: Record<string, number>;
  ok: boolean;
}

export function auditContent(input: ContentAuditInput): ContentAuditReport {
  const findings: ContentFinding[] = [];
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const options = { denyOnly: true, extraHosts: input.allowedHosts };

  for (const asset of input.assets) {
    const where = `mediaAssets/${asset.id}`;

    const verdict = classifyMediaUrl(asset.url, options);
    if (!verdict.ok) {
      findings.push({
        code: "blocked_host",
        where,
        severity: "violation",
        detail: `Asset URL is on a host HoopSync has no right to use: ${asset.url}`,
      });
    }

    if (!asset.rightsHolder) {
      findings.push({
        code: "missing_rights_holder",
        where,
        severity: "advisory",
        detail:
          "No rights holder recorded. Predates the provenance fields; re-run db:seed or set one.",
      });
    }

    if (
      (asset.source === "licensed" || asset.source === "public_domain") &&
      !asset.licenseNotes
    ) {
      findings.push({
        code: "missing_license_notes",
        where,
        severity: "violation",
        detail: `A "${asset.source}" asset records no licence terms, so its rights cannot be traced.`,
      });
    }
  }

  for (const ref of input.refs) {
    if (ref.assetId) {
      const asset = assetsById.get(ref.assetId);
      if (!asset) {
        findings.push({
          code: "missing_asset",
          where: ref.where,
          severity: "violation",
          detail: `References media asset ${ref.assetId}, which does not exist.`,
        });
        continue;
      }

      if (ref.inUse && !asset.rightsClearedAt) {
        findings.push({
          code: "uncleared_in_use",
          where: ref.where,
          severity: "violation",
          detail: `In use, but the rights on ${asset.id} have not been cleared.`,
        });
      }
      continue;
    }

    if (ref.url) {
      // A URL with no asset behind it is the exact gap that made criterion #1
      // unverifiable: it renders, and nothing records where it came from.
      const verdict = classifyMediaUrl(ref.url, options);
      findings.push({
        code: verdict.ok ? "untraceable_url" : "blocked_host",
        where: ref.where,
        severity: verdict.ok ? "advisory" : "violation",
        detail: verdict.ok
          ? `Renders ${ref.url} with no media asset behind it, so its source cannot be traced.`
          : `Renders ${ref.url}, which is on a host HoopSync has no right to use.`,
      });
    }
  }

  const bySource: Record<string, number> = {};
  for (const asset of input.assets) {
    bySource[asset.source] = (bySource[asset.source] ?? 0) + 1;
  }

  const violations = findings.filter((f) => f.severity === "violation").length;

  return {
    findings,
    counts: {
      assets: input.assets.length,
      refs: input.refs.length,
      violations,
      advisories: findings.length - violations,
    },
    bySource,
    ok: violations === 0,
  };
}

/**
 * What the audit covers, stated alongside every report so the numbers are not
 * read as a completeness claim they cannot support.
 */
export function describeAuditScope(): { walked: string[]; notWalked: string[] } {
  return {
    walked: [
      "mediaAssets (every row: host, rights holder, licence terms)",
      "drills.videoUrl / videoAssetId",
      "workouts.drills[].videoUrl / videoAssetId (snapshots)",
      "feedItems.mediaAssetId",
      "nbaPlayers.editorial.studyClip.mediaAssetId and playerImageUrl",
      "playerProfiles.avatarUrl / avatarAssetId",
      "shotSessions.videoAssetId and gameFootageAnalyses.videoAssetId",
    ],
    notWalked: [
      "users.image - the OAuth provider's avatar URL. It is not HoopSync content and has no asset row; it is shown only to the account that owns it.",
      "Text content (feed copy, editorial prose). Its provenance is FeedItemProvenance and the archetype `sources` model, not this audit.",
    ],
  };
}

const EXAMPLES_PER_CODE = 5;

function groupByCode(
  findings: ContentFinding[],
): Map<ContentFindingCode, ContentFinding[]> {
  const grouped = new Map<ContentFindingCode, ContentFinding[]>();
  for (const finding of findings) {
    const existing = grouped.get(finding.code);
    if (existing) existing.push(finding);
    else grouped.set(finding.code, [finding]);
  }
  return grouped;
}

export function formatAuditReport(report: ContentAuditReport): string {
  const scope = describeAuditScope();
  const lines: string[] = [];

  lines.push("Content provenance audit (BRD 7.14)");
  lines.push("");
  lines.push(
    `  ${report.counts.assets} media assets, ${report.counts.refs} content references walked.`,
  );

  const sources = Object.entries(report.bySource)
    .map(([source, count]) => `${count} ${source}`)
    .join(", ");
  if (sources) lines.push(`  By rights basis: ${sources}.`);

  lines.push("");
  lines.push("  Walked:");
  for (const item of scope.walked) lines.push(`    - ${item}`);
  lines.push("  Not walked:");
  for (const item of scope.notWalked) lines.push(`    - ${item}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("  No findings. Every piece of content traces to a legitimate source.");
    return lines.join("\n");
  }

  // Grouped by code rather than listed one per line. Frozen workout snapshots
  // alone produce hundreds of identical advisories, and a report nobody reads
  // to the end enforces nothing - the point is that a real violation stands
  // out, not that every instance is transcribed.
  for (const [severity, heading] of [
    ["violation", "VIOLATIONS"],
    ["advisory", "ADVISORIES"],
  ] as const) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    lines.push(`  ${heading} (${group.length}):`);
    for (const [code, items] of groupByCode(group)) {
      lines.push(`    [${code}] x${items.length}`);
      lines.push(`      ${items[0].detail}`);
      for (const item of items.slice(0, EXAMPLES_PER_CODE)) {
        lines.push(`        - ${item.where}`);
      }
      if (items.length > EXAMPLES_PER_CODE) {
        lines.push(`        ... and ${items.length - EXAMPLES_PER_CODE} more`);
      }
    }
    lines.push("");
  }

  lines.push(
    report.ok
      ? "  No violations. Advisories above are record-keeping gaps, not licensing ones."
      : `  ${report.counts.violations} violation(s) - BRD 7.14 is not satisfied.`,
  );

  return lines.join("\n");
}
