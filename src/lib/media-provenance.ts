/**
 * How a piece of media describes its own origin (BRD 7.14 / 6.4 / 11.1).
 *
 * The rule this file exists to enforce: HoopSync must never show footage
 * without saying what it is. BRD 6.4 permits clearly-labeled placeholders
 * precisely so the product can be demonstrated before a league licence
 * exists - but "clearly labeled" is the whole bargain, and a label is only
 * worth something if it is derived from the asset rather than typed by hand
 * next to it.
 *
 * Before this file there were three different answers to the same question:
 * a hardcoded sentence in `drill-media.tsx` (which asserted "placeholder"
 * regardless of what the asset actually was, and would have called licensed
 * footage a placeholder the moment any was attached), a boolean
 * `isPlaceholderFootage` prop on `study-clip-player.tsx`, and nothing at all
 * in the feed. One descriptor, derived from `MediaAssetDoc.source`, is what
 * stops those drifting apart - which is exactly how an honesty rule quietly
 * breaks.
 *
 * Isomorphic on purpose: the server resolves the descriptor, the client
 * renders it, and `content:audit` and the e2e suite assert against the same
 * exported labels rather than hardcoding strings that can silently reword.
 */
import type { MediaAssetContributor, MediaAssetSource } from "@/types/db";

/**
 * The five rights bases, as shown to a player.
 *
 * Exported as a named constant so tests assert membership rather than
 * duplicating the copy. If a label is reworded here, every surface and every
 * assertion moves with it.
 */
export const MEDIA_SOURCE_LABELS: Record<MediaAssetSource, string> = {
  original: "Original footage",
  generated: "Generated demo",
  licensed: "Licensed footage",
  public_domain: "Public domain",
  placeholder: "Placeholder footage",
};

export const MEDIA_CONTRIBUTOR_LABELS: Record<MediaAssetContributor, string> = {
  hoopsync: "HoopSync",
  coach_trainer: "Coach / trainer",
  user: "Player-recorded",
  licensor: "Licensed source",
  institution: "College / HS / overseas",
};

/**
 * Rows written before the contributor axis existed are HoopSync's own seeded
 * content, so absent means "hoopsync" - never the other way round. Defaulting
 * the other direction would retroactively attribute HoopSync's own material
 * to a third party.
 */
export function mediaContributor(asset: {
  contributor?: MediaAssetContributor;
}): MediaAssetContributor {
  return asset.contributor ?? "hoopsync";
}

export interface MediaDisclosure {
  source: MediaAssetSource;
  /** Short chip text, e.g. over a video or beside a poster frame. */
  sourceLabel: string;
  /**
   * The honest sentence rendered at the point of playback, or null when the
   * content speaks for itself (a player's own upload needs no disclaimer).
   */
  note: string | null;
  /** The credit line, when one is owed. */
  attribution: string | null;
  /** Kept as its own flag so callers can style the placeholder case. */
  isPlaceholder: boolean;
}

/**
 * The only place a disclosure sentence is written.
 *
 * Note what is *not* here: `licenseNotes`. That field records internal
 * storage/ops prose and is not fit to show a player; `attribution` is the
 * field that reaches the screen.
 */
export function disclosureFor(asset: {
  source: MediaAssetSource;
  attribution?: string;
  rightsHolder?: string;
  contributor?: MediaAssetContributor;
}): MediaDisclosure {
  const attribution = creditLineFor(asset);

  return {
    source: asset.source,
    sourceLabel: MEDIA_SOURCE_LABELS[asset.source],
    note: noteFor(asset.source),
    attribution,
    isPlaceholder: asset.source === "placeholder",
  };
}

function noteFor(source: MediaAssetSource): string | null {
  switch (source) {
    case "placeholder":
      // Deliberately neutral about *what* it stands in for, because the same
      // sentence has to be true over a drill demo and over an NBA study clip.
      // The surrounding UI supplies the subject; this supplies the honesty.
      return (
        "Placeholder footage - a labeled stand-in, not real footage of this. " +
        "HoopSync does not use professional-league film without a licence, and " +
        "the coaching notes around it are real."
      );
    case "generated":
      return "A generated demonstration, not footage of a real player.";
    case "licensed":
      return "Used under licence.";
    case "public_domain":
      return "Public-domain footage.";
    case "original":
      // A player's own clip, or HoopSync's own demo. Nothing to disclaim.
      return null;
  }
}

/**
 * Credit is only owed where someone outside HoopSync owns the content. A
 * player's own upload does not get a "courtesy of" line on their own screen.
 */
function creditLineFor(asset: {
  source: MediaAssetSource;
  attribution?: string;
  rightsHolder?: string;
  contributor?: MediaAssetContributor;
}): string | null {
  if (asset.attribution) return asset.attribution;

  const contributor = mediaContributor(asset);
  if (contributor === "hoopsync" || contributor === "user") return null;
  if (asset.source === "original" || asset.source === "placeholder") return null;

  return asset.rightsHolder ? `Courtesy of ${asset.rightsHolder}` : null;
}
