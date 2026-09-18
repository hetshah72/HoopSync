import { pickDeterministic } from "@/lib/deterministic";
import { computeZoneBreakdown, fgPercent, ZONE_LABELS } from "@/lib/shot-zones";
import {
  PARAMETER_LABELS,
  templateForParameter,
  type MechanicsShot,
} from "@/lib/shot-mechanics";
import type { ShotFeedback, ShotMechanicParameter, ShotZone } from "@/types/db";

/**
 * Per-shot technical feedback (BRD 7.5 "Individual Shot Replay").
 *
 * This replaces a pair of hardcoded sentences that rendered identically on
 * every shot in a session. BRD 7.6 is explicit that the observation -> issue
 * -> correction -> drill structure applies to *every* piece of feedback, and
 * the replay dialog is the most-tapped feedback surface in the app - two canned
 * lines were the clearest place the requirement was unmet.
 *
 * Two halves, deliberately separate:
 *
 *   `observation` is REAL - this shot's own zone tally, from the player's own
 *   tap-logged shots. No generated claim goes in it.
 *
 *   `potentialIssue` / `correction` are GENERATED. That is what
 *   `isSimulated: true` marks, and why the dialog shows a disclosure beside
 *   them. Nothing here comes from a video frame - no pose estimation exists
 *   yet (BRD v1.1 §5 puts that in Phase 2).
 *
 * The issue/correction/drill text is drawn from the same parameter bank the
 * nine-parameter session analysis uses (`@/lib/shot-mechanics`) rather than a
 * second bank of its own. One source means a shot's correction can never
 * contradict the Mechanics tab sitting a few pixels away, and the drill-slug
 * coverage test already guards the whole bank.
 *
 * Variety without randomness: the parameter and variant are chosen by hashing
 * the shot's own id, so a reload never rewrites feedback the player already
 * read, while two misses from the same zone still draw different reads.
 *
 * Pure and isomorphic - usable from services, scripts and tests alike.
 */

/**
 * Which parameters are worth raising for a shot from a given zone.
 *
 * A three-pointer, a mid-range pull-up and a layup fail for different
 * mechanical reasons, so they must not share copy - telling someone their
 * guide hand steered a layup is noise. This also fixes the defect the old
 * session-level picker had, where a Paint weakness could be diagnosed as a
 * late wrist load.
 */
const ZONE_PLAUSIBLE_PARAMETERS: Record<ShotZone, ShotMechanicParameter[]> = {
  paint: ["lower_body_balance", "landing_position", "release_timing"],
  free_throw_mid: [
    "wrist_loading",
    "elbow_alignment",
    "follow_through_arc",
    "landing_position",
  ],
  left_mid: [
    "shooting_pocket",
    "elbow_alignment",
    "release_timing",
    "lower_body_balance",
  ],
  right_mid: [
    "shooting_pocket",
    "elbow_alignment",
    "release_timing",
    "lower_body_balance",
  ],
  top_of_key_3: [
    "wrist_loading",
    "lower_body_balance",
    "follow_through_arc",
    "jump_consistency",
  ],
  left_wing_3: [
    "wrist_loading",
    "shooting_pocket",
    "follow_through_arc",
    "release_timing",
  ],
  right_wing_3: [
    "wrist_loading",
    "shooting_pocket",
    "follow_through_arc",
    "release_timing",
  ],
  left_corner_3: [
    "follow_through_arc",
    "lower_body_balance",
    "landing_position",
  ],
  right_corner_3: [
    "follow_through_arc",
    "lower_body_balance",
    "landing_position",
  ],
};

/**
 * The one-line identity of a shot, available the moment it is logged - before
 * the session context the full feedback needs exists.
 */
export function headlineFor(zone: ShotZone, made: boolean): string {
  return `${made ? "Make" : "Miss"} - ${ZONE_LABELS[zone]}`;
}

export interface ShotFeedbackInput {
  /** Stable per shot, so the same shot always draws the same read. */
  shotId: string;
  zone: ShotZone;
  made: boolean;
  /** Every shot in the session, for the real zone tally in `observation`. */
  shots: MechanicsShot[];
}

export function generateShotFeedback(input: ShotFeedbackInput): ShotFeedback {
  const { shotId, zone, made, shots } = input;

  const stats = computeZoneBreakdown(shots)[zone] ?? { attempts: 0, makes: 0 };
  const pct = fgPercent(stats.makes, stats.attempts);
  const zoneLabel = ZONE_LABELS[zone];

  const parameter = pickDeterministic(ZONE_PLAUSIBLE_PARAMETERS[zone], shotId)!;
  const template = templateForParameter(parameter, shotId);

  const observation = made
    ? `That one dropped. You're ${stats.makes}/${stats.attempts} (${pct}%) from ${zoneLabel} this session.`
    : `${zoneLabel} is running ${stats.makes}/${stats.attempts} (${pct}%) for you this session, so this miss sits inside a pattern rather than on its own.`;

  // BRD 7.6 asks for all four parts on *every* message, makes included. On a
  // make the honest "likely issue" is the thing most likely to slip next - an
  // invented fault attached to a shot that went in would read as criticism of
  // a good rep.
  const potentialIssue = made
    ? `${PARAMETER_LABELS[parameter]} - most likely to slip first`
    : template.potentialIssue;

  return {
    headline: headlineFor(zone, made),
    observation,
    potentialIssue,
    correction: template.correction,
    drillSlug: template.drillSlug,
    isSimulated: true,
  };
}

/**
 * Feedback for every shot at once, which is how finalize uses it - the zone
 * tallies are session-wide, so generating them one shot at a time would
 * recompute the same breakdown for every shot.
 */
export function generateFeedbackForSession<
  T extends MechanicsShot & { id: string },
>(shots: T[]): Map<string, ShotFeedback> {
  return new Map(
    shots.map((shot) => [
      shot.id,
      generateShotFeedback({
        shotId: shot.id,
        zone: shot.zone,
        made: shot.made,
        shots,
      }),
    ]),
  );
}
