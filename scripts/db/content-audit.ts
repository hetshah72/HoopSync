/**
 * Content provenance audit (BRD 7.14).
 *
 * Walks every content-bearing field in the database and reports anything that
 * cannot be traced to a legitimate source, or that sits on a host HoopSync has
 * no right to use. Exits non-zero on a violation so CI and a pre-submission
 * check can both depend on it.
 *
 * Read-only: this script never writes.
 *
 * Usage: npm run content:audit
 */
import type { Db, Document } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import {
  auditContent,
  formatAuditReport,
  type AuditContentRef,
  type AuditMediaAsset,
  type ContentAuditReport,
} from "@/lib/content-audit";
import { allowedHostsFromEnv } from "@/lib/media-url-policy";
import { connectForScript } from "./lib/connection";

function idString(value: unknown): string | null {
  return value ? String(value) : null;
}

/** Core logic, exported separately so it's testable against any Db. */
export async function auditDatabase(db: Db): Promise<ContentAuditReport> {
  const [assetDocs, drills, workouts, feedItems, players, profiles, sessions, analyses] =
    await Promise.all([
      db.collection(COLLECTIONS.mediaAssets).find({}).toArray(),
      db.collection(COLLECTIONS.drills).find({}).toArray(),
      db.collection(COLLECTIONS.workouts).find({}).toArray(),
      db.collection(COLLECTIONS.feedItems).find({}).toArray(),
      db.collection(COLLECTIONS.nbaPlayers).find({}).toArray(),
      db.collection(COLLECTIONS.playerProfiles).find({}).toArray(),
      db.collection(COLLECTIONS.shotSessions).find({}).toArray(),
      db.collection(COLLECTIONS.gameFootageAnalyses).find({}).toArray(),
    ]);

  const assets: AuditMediaAsset[] = assetDocs.map((doc) => ({
    id: doc._id.toString(),
    url: String(doc.url),
    source: doc.source,
    rightsHolder: doc.rightsHolder,
    licenseNotes: doc.licenseNotes,
    rightsClearedAt: doc.rightsClearedAt ?? null,
  }));

  const refs: AuditContentRef[] = [];

  for (const drill of drills) {
    if (!drill.videoUrl && !drill.videoAssetId) continue;
    refs.push({
      where: `drills/${drill.slug ?? drill._id}`,
      assetId: idString(drill.videoAssetId),
      url: drill.videoUrl ?? null,
      inUse: true,
    });
  }

  // Snapshots are copies frozen into a player's history, so they are walked
  // separately - a drill fixed today does not retroactively fix the workouts
  // that already copied its footage.
  for (const workout of workouts) {
    for (const drill of (workout.drills ?? []) as Document[]) {
      if (!drill.videoUrl && !drill.videoAssetId) continue;
      refs.push({
        where: `workouts/${workout._id}/drills/${drill.order}`,
        assetId: idString(drill.videoAssetId),
        url: drill.videoUrl ?? null,
        // Historical content the player can still open, but not something an
        // admin can re-clear - flagged, never a publish gate.
        inUse: false,
      });
    }
  }

  for (const item of feedItems) {
    if (!item.mediaAssetId) continue;
    refs.push({
      where: `feedItems/${item._id}`,
      assetId: idString(item.mediaAssetId),
      inUse: true,
    });
  }

  for (const player of players) {
    const clip = player.editorial?.studyClip;
    if (clip?.mediaAssetId) {
      refs.push({
        where: `nbaPlayers/${player.name}/studyClip`,
        assetId: idString(clip.mediaAssetId),
        inUse: true,
      });
    }
    if (player.playerImageUrl || player.playerImageAssetId) {
      refs.push({
        where: `nbaPlayers/${player.name}/image`,
        assetId: idString(player.playerImageAssetId),
        url: player.playerImageUrl ?? null,
        inUse: true,
      });
    }
  }

  for (const profile of profiles) {
    if (!profile.avatarUrl && !profile.avatarAssetId) continue;
    refs.push({
      where: `playerProfiles/${profile._id}/avatar`,
      assetId: idString(profile.avatarAssetId),
      url: profile.avatarUrl ?? null,
      // A player's own photo, shown only to them - never a licensing question.
      inUse: false,
    });
  }

  for (const session of sessions) {
    if (!session.videoAssetId) continue;
    refs.push({
      where: `shotSessions/${session._id}`,
      assetId: idString(session.videoAssetId),
      inUse: false,
    });
  }

  for (const analysis of analyses) {
    if (!analysis.videoAssetId) continue;
    refs.push({
      where: `gameFootageAnalyses/${analysis._id}`,
      assetId: idString(analysis.videoAssetId),
      inUse: false,
    });
  }

  return auditContent({
    assets,
    refs,
    allowedHosts: allowedHostsFromEnv(process.env.MEDIA_ALLOWED_HOSTS),
  });
}

async function main() {
  const { client, db } = await connectForScript();
  try {
    const report = await auditDatabase(db);
    console.log(formatAuditReport(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

// Only run when invoked directly, so the integration test can import
// `auditDatabase` without opening a connection.
if (process.argv[1]?.includes("content-audit")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
