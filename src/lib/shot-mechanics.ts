import type { ObjectId } from "mongodb";
import { pickDeterministic } from "@/lib/deterministic";
import {
  computeZoneBreakdown,
  fgPercent,
  THREE_POINT_ZONES,
  ZONE_LABELS,
} from "@/lib/shot-zones";
import { referenceStandardFor } from "@/lib/shot-reference-standards";
import {
  SHOT_MECHANIC_PARAMETERS,
  type MechanicalFinding,
  type ShotMechanicParameter,
  type ShotType,
  type ShotZone,
} from "@/types/db";

/**
 * The nine-parameter shooting-form analysis required by BRD 7.6.
 *
 * Two things make this honest rather than four canned sentences with a new
 * coat of paint:
 *
 * 1. Every finding carries a `basis`. Left-vs-right is genuinely *measured* -
 *    the 9-zone taxonomy has mirrored left_*\/right_* zones, so the split is
 *    computed from the player's own tap-logged shots, which is exactly the
 *    comparison BRD 7.6's worked example makes. Parameters no data can see
 *    (elbow, wrist, arc...) are marked `simulated` and say so in the UI.
 * 2. Nothing claims a pattern the sample can't support. Each signal carries
 *    `sampleAdequate`, and below threshold the parameter falls back to a
 *    generated observation instead of dressing up two attempts as a trend.
 *
 * Pure and isomorphic - no database, no clock, no randomness - so the whole
 * policy is unit-testable and reusable from scripts/db/seed.ts. The provider
 * wrapper stamps the simulated markers before any of this reaches the UI.
 */

export const PARAMETER_LABELS: Record<ShotMechanicParameter, string> = {
  wrist_loading: "Wrist Loading",
  elbow_alignment: "Elbow Alignment",
  release_timing: "Release Timing",
  shooting_pocket: "Shooting Pocket",
  lower_body_balance: "Lower-Body Balance",
  jump_consistency: "Jump Consistency",
  follow_through_arc: "Follow-Through & Arc",
  landing_position: "Landing Position",
  side_to_side: "Side-to-Side Differences",
};

export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  catch_and_shoot: "Catch & Shoot",
  off_dribble: "Off Dribble",
  free_throw: "Free Throw",
};

/**
 * Only the mirrored zones count toward a side comparison. Top of Key,
 * Free-Throw Mid and Paint are centre shots - counting them as "left" or
 * "right" would invent a handedness the tap never expressed.
 */
const LEFT_ZONES: readonly ShotZone[] = [
  "left_wing_3",
  "left_mid",
  "left_corner_3",
];
const RIGHT_ZONES: readonly ShotZone[] = [
  "right_wing_3",
  "right_mid",
  "right_corner_3",
];
const INSIDE_ZONES: readonly ShotZone[] = [
  "paint",
  "free_throw_mid",
  "left_mid",
  "right_mid",
];

/**
 * Minimum attempts *per side* before a left-vs-right difference may be stated
 * as a finding.
 *
 * Matched to `MIN_ATTEMPTS_FOR_CALLOUT` in feedSignalsService, and for the
 * same reason its comment gives: `findBestAndWeakestZones` defaults to 1,
 * which is right for "the zone to work on today" but far too loose for a
 * standing claim about the player's mechanics. A side-to-side form claim is
 * exactly such a standing claim.
 */
export const MIN_ATTEMPTS_PER_SIDE = 5;

/**
 * How far apart the two sides must be before the gap means anything. At five
 * attempts a side, one extra make swings a side by 20 points, so anything
 * under this is inside the noise of a short session.
 */
export const MIN_SIDE_GAP_POINTS = 20;

const MIN_ATTEMPTS_PER_RANGE = 5;
const MIN_RANGE_GAP_POINTS = 20;
/** Eight attempts is the fewest that leaves four per half - below that a
 *  "faded late" claim rests on one or two shots. */
const MIN_ATTEMPTS_FOR_DRIFT = 8;
const MIN_DRIFT_POINTS = 20;

/** The minimum a shot record must carry for this module to analyse it. */
export interface MechanicsShot {
  zone: ShotZone;
  made: boolean;
  shotType?: ShotType;
  timestampInVideoSeconds: number;
}

export interface SideSplit {
  leftAttempts: number;
  leftMakes: number;
  leftPct: number;
  rightAttempts: number;
  rightMakes: number;
  rightPct: number;
  gapPoints: number;
  /** Non-null only when both sides clear the sample bar AND the gap clears
   *  `MIN_SIDE_GAP_POINTS`. This is what gates a *measured* finding. */
  weakerSide: "left" | "right" | null;
  sampleAdequate: boolean;
}

export interface RangeSplit {
  threeAttempts: number;
  threeMakes: number;
  threePct: number;
  insideAttempts: number;
  insideMakes: number;
  insidePct: number;
  gapPoints: number;
  sampleAdequate: boolean;
}

export interface FatigueDrift {
  firstHalfPct: number;
  secondHalfPct: number;
  /** Positive means the player fell off across the session. */
  dropPoints: number;
  sampleAdequate: boolean;
}

export interface ShotTypeTally {
  shotType: ShotType;
  attempts: number;
  makes: number;
  fgPercent: number;
}

export interface SessionSignals {
  attempts: number;
  makes: number;
  side: SideSplit;
  range: RangeSplit;
  drift: FatigueDrift;
  /** Only the types the player actually tagged, busiest first. */
  shotTypes: ShotTypeTally[];
  /** The type the player tagged most often, or null if they tagged none. */
  dominantShotType: ShotType | null;
}

function tally(shots: MechanicsShot[], zones: readonly ShotZone[]) {
  const subset = shots.filter((shot) => zones.includes(shot.zone));
  const makes = subset.filter((shot) => shot.made).length;
  return {
    attempts: subset.length,
    makes,
    pct: fgPercent(makes, subset.length),
  };
}

/**
 * Everything about this session that is genuinely measured, with an explicit
 * adequacy flag on each signal so callers cannot accidentally state a pattern
 * the sample doesn't support.
 */
export function computeSessionSignals(shots: MechanicsShot[]): SessionSignals {
  const left = tally(shots, LEFT_ZONES);
  const right = tally(shots, RIGHT_ZONES);
  const sideSampleAdequate =
    left.attempts >= MIN_ATTEMPTS_PER_SIDE &&
    right.attempts >= MIN_ATTEMPTS_PER_SIDE;
  const sideGap = Math.abs(left.pct - right.pct);
  const sideGapMeaningful =
    sideSampleAdequate && sideGap >= MIN_SIDE_GAP_POINTS;

  const threes = tally(shots, THREE_POINT_ZONES);
  const inside = tally(shots, INSIDE_ZONES);
  const rangeSampleAdequate =
    threes.attempts >= MIN_ATTEMPTS_PER_RANGE &&
    inside.attempts >= MIN_ATTEMPTS_PER_RANGE;

  const ordered = [...shots].sort(
    (a, b) => a.timestampInVideoSeconds - b.timestampInVideoSeconds,
  );
  const midpoint = Math.floor(ordered.length / 2);
  const firstHalf = ordered.slice(0, midpoint);
  const secondHalf = ordered.slice(midpoint);
  const firstPct = fgPercent(
    firstHalf.filter((s) => s.made).length,
    firstHalf.length,
  );
  const secondPct = fgPercent(
    secondHalf.filter((s) => s.made).length,
    secondHalf.length,
  );

  const typeCounts = new Map<ShotType, { attempts: number; makes: number }>();
  for (const shot of shots) {
    if (!shot.shotType) continue;
    const entry = typeCounts.get(shot.shotType) ?? { attempts: 0, makes: 0 };
    entry.attempts += 1;
    if (shot.made) entry.makes += 1;
    typeCounts.set(shot.shotType, entry);
  }
  const shotTypes: ShotTypeTally[] = [...typeCounts.entries()]
    .map(([shotType, entry]) => ({
      shotType,
      attempts: entry.attempts,
      makes: entry.makes,
      fgPercent: fgPercent(entry.makes, entry.attempts),
    }))
    .sort((a, b) => b.attempts - a.attempts);

  return {
    attempts: shots.length,
    makes: shots.filter((shot) => shot.made).length,
    side: {
      leftAttempts: left.attempts,
      leftMakes: left.makes,
      leftPct: left.pct,
      rightAttempts: right.attempts,
      rightMakes: right.makes,
      rightPct: right.pct,
      gapPoints: Math.round(sideGap * 10) / 10,
      weakerSide: sideGapMeaningful
        ? left.pct < right.pct
          ? "left"
          : "right"
        : null,
      sampleAdequate: sideSampleAdequate,
    },
    range: {
      threeAttempts: threes.attempts,
      threeMakes: threes.makes,
      threePct: threes.pct,
      insideAttempts: inside.attempts,
      insideMakes: inside.makes,
      insidePct: inside.pct,
      gapPoints: Math.round(Math.abs(inside.pct - threes.pct) * 10) / 10,
      sampleAdequate: rangeSampleAdequate,
    },
    drift: {
      firstHalfPct: firstPct,
      secondHalfPct: secondPct,
      dropPoints: Math.round((firstPct - secondPct) * 10) / 10,
      sampleAdequate: shots.length >= MIN_ATTEMPTS_FOR_DRIFT,
    },
    shotTypes,
    dominantShotType: shotTypes[0]?.shotType ?? null,
  };
}

// ---------------------------------------------------------------------------
// Template bank - two variants per parameter, all nine covered
// ---------------------------------------------------------------------------

interface ZoneContext {
  zoneLabel: string;
  makes: number;
  attempts: number;
  pct: number;
}

interface ParameterTemplate {
  potentialIssue: string;
  correction: string;
  drillSlug: string;
  /**
   * Used when no measured signal evidences this parameter. It still cites the
   * player's real zone tally - the numbers are always theirs; it is the
   * mechanical read on top that is generated, which is what `basis` marks.
   */
  generatedObservation: (ctx: ZoneContext) => string;
}

const TEMPLATES: Record<ShotMechanicParameter, ParameterTemplate[]> = {
  wrist_loading: [
    {
      potentialIssue:
        "Wrist loading late, after the legs have already started to extend",
      correction:
        "Get the ball into the pocket with the wrist cocked back before your legs start to drive, so the rise adds power to a shot that is already loaded.",
      drillSlug: "form-shooting-close-range",
      generatedObservation: (c) =>
        `You went ${c.makes}/${c.attempts} (${c.pct}%) from ${c.zoneLabel}. A miss pattern in that range most often traces back to the shooting wrist still loading as the body rises, which shortens the time available to aim.`,
    },
    {
      potentialIssue: "Wrist collapsing forward under the ball's weight",
      correction:
        "Hold the cocked-back wrist position for a full second before you shoot in warm-ups, until carrying the ball that way stops taking effort.",
      drillSlug: "one-dribble-pull-up",
      generatedObservation: (c) =>
        `Across your ${c.attempts} ${c.zoneLabel} attempts (${c.makes} down), the common mechanical culprit is a wrist that gives way under the ball instead of holding its angle into the release.`,
    },
  ],
  elbow_alignment: [
    {
      potentialIssue: "Shooting elbow drifting out away from under the ball",
      correction:
        "Keep the shooting elbow stacked directly under the ball through the whole release, not just at the set point - check it in a mirror before you add distance.",
      drillSlug: "form-shooting-close-range",
      generatedObservation: (c) =>
        `Your ${c.zoneLabel} line reads ${c.makes}/${c.attempts} (${c.pct}%). When misses spread left and right rather than short and long, a flaring shooting elbow is the first thing worth checking.`,
    },
    {
      potentialIssue: "Guide hand pushing the ball off-line at release",
      correction:
        "Take the guide hand off a beat earlier and finish with it still pointing where it started - it steers, it never pushes.",
      drillSlug: "form-shooting-close-range",
      generatedObservation: (c) =>
        `From ${c.zoneLabel} you finished ${c.makes} of ${c.attempts}. Side-to-side misses from that spot usually come from the off hand contributing force it shouldn't.`,
    },
  ],
  release_timing: [
    {
      potentialIssue:
        "Releasing on the way down rather than at the top of the jump",
      correction:
        "Let the ball go at or just before the peak so the legs power the shot, instead of the arm pushing after the body has started to drop.",
      drillSlug: "one-dribble-pull-up",
      generatedObservation: (c) =>
        `${c.makes}/${c.attempts} (${c.pct}%) from ${c.zoneLabel}. Shots that come up short from range are most often released a beat late, after the legs have given back the height they generated.`,
    },
    {
      potentialIssue: "Gather taking too long between the catch and the rise",
      correction:
        "Shorten the gap between the ball arriving and your legs starting - the catch and the start of the shot should be one motion, not two.",
      drillSlug: "hesitation-pull-up-signature",
      generatedObservation: (c) =>
        `Your ${c.zoneLabel} attempts came in at ${c.pct}% (${c.makes}/${c.attempts}). A slow gather is the usual cause when a shot feels rushed at the end despite having time at the start.`,
    },
  ],
  shooting_pocket: [
    {
      potentialIssue: "Ball arriving in a different pocket on each attempt",
      correction:
        "Bring the ball to the same spot between chest and shoulder every single rep, so the release always starts from one place.",
      drillSlug: "relocation-catch-and-shoot",
      generatedObservation: (c) =>
        `You shot ${c.makes}/${c.attempts} (${c.pct}%) from ${c.zoneLabel}. An inconsistent result from a single spot most often means the ball is not starting from the same pocket each time.`,
    },
    {
      potentialIssue: "Ball dipping below the waist before it comes up",
      correction:
        "Cut the dip - take the ball straight into the pocket from where you caught it, which removes a whole segment of travel that can go wrong.",
      drillSlug: "relocation-catch-and-shoot",
      generatedObservation: (c) =>
        `At ${c.pct}% from ${c.zoneLabel} (${c.makes}/${c.attempts}), a long path from the catch into the pocket is worth ruling out - the further the ball travels first, the more there is to repeat exactly.`,
    },
  ],
  lower_body_balance: [
    {
      potentialIssue: "Base not set before the shot begins",
      correction:
        "Get your feet set and squared to the rim half a step earlier, before you are already gathering to shoot.",
      drillSlug: "step-back-separation",
      generatedObservation: (c) =>
        `From ${c.zoneLabel} you were ${c.makes}/${c.attempts} (${c.pct}%). When a shot is fine up close and falls away with distance, the base is usually where it starts - the legs are being asked for range the feet aren't set for.`,
    },
    {
      potentialIssue: "Weight drifting onto the toes or off to one side",
      correction:
        "Balance through the middle of the foot and jump straight up - if you land somewhere other than where you took off, the jump took energy the shot needed.",
      drillSlug: "step-back-separation",
      generatedObservation: (c) =>
        `Your ${c.zoneLabel} tally was ${c.makes} from ${c.attempts}. Drifting weight is the most common reason a repeatable stroke still scatters from one spot.`,
    },
  ],
  jump_consistency: [
    {
      potentialIssue: "Jump height changing from rep to rep",
      correction:
        "Shoot to the same height every time, including when you're tired - a shot that changes under fatigue is the one that misses late in a game.",
      drillSlug: "pick-and-pop-trail-three",
      generatedObservation: (c) =>
        `${c.makes}/${c.attempts} (${c.pct}%) from ${c.zoneLabel}. Where results swing inside a single spot, an inconsistent jump is usually underneath it.`,
    },
    {
      potentialIssue: "Legs fading while the arm compensates",
      correction:
        "When your legs go, stop and reset rather than pushing the ball with your arm - reps taken with a tired base teach the wrong motion.",
      drillSlug: "pick-and-pop-trail-three",
      generatedObservation: (c) =>
        `You finished ${c.pct}% from ${c.zoneLabel} (${c.makes}/${c.attempts}). Arm-only compensation once the legs tire is worth watching for at that volume.`,
    },
  ],
  follow_through_arc: [
    {
      potentialIssue: "Follow-through cut short before the ball lands",
      correction:
        "Hold the follow-through with the wrist snapped down until the ball reaches the rim - don't drop the hand early to watch the shot.",
      drillSlug: "high-arc-form-shooting",
      generatedObservation: (c) =>
        `Your ${c.zoneLabel} attempts came to ${c.makes}/${c.attempts} (${c.pct}%). Front-rim misses from that distance most often mean a flat arc and a follow-through that finished early.`,
    },
    {
      potentialIssue: "Arc too flat for the distance",
      correction:
        "Shoot over an imaginary defender a foot taller - a higher, softer arc gives the ball more of the rim to fall through.",
      drillSlug: "high-arc-form-shooting",
      generatedObservation: (c) =>
        `At ${c.pct}% from ${c.zoneLabel}, arc is worth a look: a line-drive shot has to be nearly perfect to go in, where a high one can catch the rim and still drop.`,
    },
  ],
  landing_position: [
    {
      potentialIssue: "Landing away from the spot you took off from",
      correction:
        "Land in your own footprint. Drifting forward, back or sideways means the jump carried energy in a direction the shot couldn't use.",
      drillSlug: "landing-balance-hold",
      generatedObservation: (c) =>
        `${c.makes} of ${c.attempts} from ${c.zoneLabel} (${c.pct}%). Where a stroke looks sound but the results scatter, landing drift is one of the few causes that explains both.`,
    },
    {
      potentialIssue: "Fading away when nothing is forcing it",
      correction:
        "Shoot straight up when you're open - save the fade for when a defender actually takes the straight shot away.",
      drillSlug: "landing-balance-hold",
      generatedObservation: (c) =>
        `From ${c.zoneLabel} you shot ${c.pct}% on ${c.attempts} attempts. An unforced fade quietly adds distance to every one of those shots.`,
    },
  ],
  side_to_side: [
    {
      potentialIssue: "Mechanics differing between your left and right sides",
      correction:
        "Work the weaker side in matched pairs - one rep left, one right - so the stronger side sets the standard the weaker one has to copy.",
      drillSlug: "mirrored-wing-symmetry",
      generatedObservation: (c) =>
        `You logged ${c.attempts} attempts from ${c.zoneLabel} (${c.makes} made). Log a few more from the mirrored spot on the other side next session and this report can compare the two directly.`,
    },
    {
      potentialIssue:
        "Footwork changing depending on which side the shot comes from",
      correction:
        "Set your feet identically on both wings - the release point should not know which side of the floor it is on.",
      drillSlug: "mirrored-wing-symmetry",
      generatedObservation: (c) =>
        `Your ${c.zoneLabel} line reads ${c.makes}/${c.attempts}. Balanced volume across both sides of the floor is what lets a left-versus-right comparison mean anything.`,
    },
  ],
};

/** Every drill slug the parameter bank can recommend - used by the coverage test. */
export function mechanicsDrillSlugs(): string[] {
  return [
    ...new Set(
      Object.values(TEMPLATES).flatMap((variants) =>
        variants.map((v) => v.drillSlug),
      ),
    ),
  ];
}

function variantFor(
  parameter: ShotMechanicParameter,
  seed: string,
): ParameterTemplate {
  return pickDeterministic(TEMPLATES[parameter], `${seed}:${parameter}`)!;
}

/**
 * One parameter's issue/correction/drill, for callers that compose their own
 * observation - `@/lib/shot-feedback` does exactly that for per-shot feedback.
 *
 * Exported so there is a single template bank behind both surfaces: a shot's
 * correction in the replay dialog can then never contradict the Mechanics tab
 * a few pixels away, and `mechanicsDrillSlugs()` keeps covering every drill
 * either one can recommend.
 */
export function templateForParameter(
  parameter: ShotMechanicParameter,
  seed: string,
): Readonly<
  Pick<ParameterTemplate, "potentialIssue" | "correction" | "drillSlug">
> {
  return variantFor(parameter, seed);
}

export interface MechanicsInput {
  sessionId: ObjectId;
  shots: MechanicsShot[];
}

function zoneContextFor(shots: MechanicsShot[], zone: ShotZone): ZoneContext {
  const breakdown = computeZoneBreakdown(shots);
  const stats = breakdown[zone] ?? { attempts: 0, makes: 0 };
  return {
    zoneLabel: ZONE_LABELS[zone],
    makes: stats.makes,
    attempts: stats.attempts,
    pct: fgPercent(stats.makes, stats.attempts),
  };
}

/**
 * The full nine-parameter analysis, always in BRD 7.6's listed order so the
 * report reads the way the requirement is written.
 *
 * Returns findings without `drillId` - resolving slugs to ObjectIds is the
 * service's job, because this module is isomorphic and has no database.
 */
export function generateFindings(
  input: MechanicsInput,
  focusZone: ShotZone,
): Omit<MechanicalFinding, "drillId">[] {
  const { sessionId, shots } = input;
  const seed = sessionId.toString();
  const signals = computeSessionSignals(shots);
  const ctx = zoneContextFor(shots, focusZone);

  return SHOT_MECHANIC_PARAMETERS.map((parameter) => {
    const template = variantFor(parameter, seed);
    const measured = measuredObservationFor(parameter, signals);
    const reference = referenceStandardFor(parameter, signals.dominantShotType);

    return {
      parameter,
      observation: measured ?? template.generatedObservation(ctx),
      potentialIssue: template.potentialIssue,
      correction: template.correction,
      drillSlug: template.drillSlug,
      basis: measured ? ("measured" as const) : ("simulated" as const),
      referenceStandard: reference.standard,
      referenceShotType: reference.shotType,
    };
  });
}

/**
 * An observation built purely from the player's own logged shots, or null
 * when the data cannot support one.
 *
 * Only three of the nine parameters can ever reach this - the rest describe
 * things no tap-logged shot can see, and saying otherwise would be exactly
 * the fabrication this project's honesty rule exists to prevent.
 */
function measuredObservationFor(
  parameter: ShotMechanicParameter,
  signals: SessionSignals,
): string | null {
  if (parameter === "side_to_side") {
    const { side } = signals;
    if (!side.weakerSide) return null;
    const weakIsLeft = side.weakerSide === "left";
    const weak = weakIsLeft
      ? {
          label: "left",
          pct: side.leftPct,
          makes: side.leftMakes,
          attempts: side.leftAttempts,
        }
      : {
          label: "right",
          pct: side.rightPct,
          makes: side.rightMakes,
          attempts: side.rightAttempts,
        };
    const strong = weakIsLeft
      ? {
          label: "right",
          pct: side.rightPct,
          makes: side.rightMakes,
          attempts: side.rightAttempts,
        }
      : {
          label: "left",
          pct: side.leftPct,
          makes: side.leftMakes,
          attempts: side.leftAttempts,
        };

    return `On your ${weak.label}-side attempts you shot ${weak.makes}/${weak.attempts} (${weak.pct}%), against ${strong.makes}/${strong.attempts} (${strong.pct}%) on your ${strong.label} - a ${side.gapPoints}-point gap across ${side.leftAttempts + side.rightAttempts} logged attempts. That comes straight from the shots you tapped in, not from your video.`;
  }

  if (parameter === "jump_consistency") {
    const { drift } = signals;
    if (!drift.sampleAdequate || drift.dropPoints < MIN_DRIFT_POINTS)
      return null;
    return `You shot ${drift.firstHalfPct}% over the first half of this session and ${drift.secondHalfPct}% over the second - a ${drift.dropPoints}-point fall across ${signals.attempts} attempts, measured from the order you logged them in.`;
  }

  if (parameter === "lower_body_balance") {
    const { range } = signals;
    if (!range.sampleAdequate || range.gapPoints < MIN_RANGE_GAP_POINTS)
      return null;
    return `Inside the arc you shot ${range.insideMakes}/${range.insideAttempts} (${range.insidePct}%), and from three ${range.threeMakes}/${range.threeAttempts} (${range.threePct}%) - a ${range.gapPoints}-point drop as the distance grows, taken from your own logged shots.`;
  }

  return null;
}

// Per-shot feedback deliberately does NOT live here. `@/lib/shot-feedback`
// owns it - it has its own zone-family template bank keyed off the shot's own
// id, and two competing per-shot generators would drift apart. This module
// stays session-level: the nine parameters and the signals behind them.
