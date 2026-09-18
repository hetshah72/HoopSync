/**
 * The admin content-ingestion contract (BRD 7.14: "MVP for the content
 * pipeline itself").
 *
 * Isomorphic so the upload form, the route handler and the tests all agree on
 * one set of limits and one set of rules about which rights facts are
 * mandatory for which rights basis.
 */
import type { MediaAssetContributor, MediaAssetSource } from "@/types/db";

export const CONTENT_MAX_BYTES = 100 * 1024 * 1024;

export const CONTENT_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const CONTENT_ACCEPT = CONTENT_VIDEO_TYPES.join(",");

/**
 * BRD 7.14 asks for content that is "short-form and engaging". Without a
 * number that is a slogan, so ingestion enforces one: 90 seconds is long
 * enough for a full drill demonstration with a reset, and short enough that
 * the reel stays a reel.
 *
 * Note this is a *content* guardrail, not a security boundary - duration is
 * measured in the browser and sent along, because reading it server-side
 * would mean shelling out to ffprobe, which this app does not ship. An admin
 * determined to post a long clip could forge the field; the cap exists to
 * keep honest content short, not to defend against the person we handed the
 * admin role to.
 */
export const CONTENT_MAX_DURATION_SECONDS = 90;

export const CONTENT_SIZE_MESSAGE = `That clip is too large - keep it under ${Math.round(
  CONTENT_MAX_BYTES / (1024 * 1024),
)}MB.`;

export const CONTENT_TYPE_MESSAGE =
  "Upload an MP4, WebM or MOV video.";

export const CONTENT_DURATION_MESSAGE = `Clips must be ${CONTENT_MAX_DURATION_SECONDS} seconds or shorter - the feed is short-form (BRD 7.14).`;

/**
 * Which rights bases an admin may actually choose.
 *
 * `original` is deliberately absent: it means "HoopSync or the player shot
 * this", which is what `storeUpload` records for every player upload already.
 * An admin adding library content is either publishing a generated demo,
 * something licensed, something public-domain, or a labeled placeholder.
 */
export const INGESTIBLE_SOURCES = [
  "generated",
  "licensed",
  "public_domain",
  "placeholder",
] as const;

export type IngestibleSource = (typeof INGESTIBLE_SOURCES)[number];

export const INGESTIBLE_CONTRIBUTORS = [
  "hoopsync",
  "coach_trainer",
  "licensor",
  "institution",
] as const;

/**
 * Whether a licence record is mandatory.
 *
 * Content HoopSync made, and content it is openly labelling as a stand-in,
 * need no licence terms. Anything held under someone else's permission does -
 * a `licensed` row with no record of its licence is exactly the untraceable
 * content BRD 7.14 exists to prevent, which is why the database validator
 * enforces the same rule independently.
 */
export function requiresLicenseNotes(source: MediaAssetSource): boolean {
  return source === "licensed" || source === "public_domain";
}

/**
 * Whether rights are settled the moment the file lands.
 *
 * Keyed on the *contributor*, not the rights basis. HoopSync's own material
 * is cleared because HoopSync owns it. A coach, a licensor or an institution
 * is a third party, and somebody has to confirm a release or a contract
 * exists before their content is published - a coach uploading footage of a
 * minor is the case that makes auto-clearing here indefensible.
 */
export function clearsOnIngest(contributor: MediaAssetContributor): boolean {
  return contributor === "hoopsync";
}

/** The reason a clip is waiting, phrased for the admin who has to act on it. */
export function pendingClearanceReason(
  contributor: MediaAssetContributor,
): string {
  switch (contributor) {
    case "coach_trainer":
      return "Confirm the coach has a release for everyone shown before publishing.";
    case "licensor":
      return "Confirm the licence covers this use before publishing.";
    case "institution":
      return "Confirm the college/HS/overseas rights holder permits this use.";
    case "user":
      return "Confirm the player agreed to their footage being published.";
    case "hoopsync":
      return "HoopSync's own content - cleared on upload.";
  }
}
