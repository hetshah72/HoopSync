import type { ShotMechanicParameter, ShotType } from "@/types/db";

/**
 * The reference side of BRD 7.6's "compare the player's clip against
 * reference (e.g. professional) footage for the same shot type".
 *
 * What this is: an authored coaching benchmark per parameter - what correct
 * form looks like - written so a player's own measured numbers can be set
 * beside it. What it is emphatically not: professional-league footage, or a
 * description of any named player's mechanics.
 *
 * Why no video: BRD 6.4 and 7.14 forbid building on league footage before the
 * pending licence is signed, and require "clearly labeled placeholders"
 * instead. `referenceClipUrl` is the swap point for when that licence exists,
 * exactly as `playerImageUrl` is for player imagery (BRD 7.4) - a licensed
 * clip drops in beside the same authored standard without redesigning the
 * feature.
 *
 * Pure and isomorphic: no database, no clock, no randomness, so the whole
 * reference library is unit-testable and usable from scripts/db/seed.ts.
 */
export interface ReferenceStandard {
  parameter: ShotMechanicParameter;
  /**
   * Which shot type this benchmark is written for. "general" is the fallback
   * used when the player didn't tag the shot - never a guess at which type it
   * actually was.
   */
  shotType: ShotType | "general";
  /** What good looks like, in coaching language. Describes form, never a person. */
  standard: string;
  /** Undefined until a league licence exists. See the file comment. */
  referenceClipUrl?: string;
}

/**
 * Written in the BRD's own register: concrete, mechanical, checkable. A
 * standard a player cannot check against their own body is not a standard.
 */
const STANDARDS: ReferenceStandard[] = [
  // --- wrist_loading ---
  {
    parameter: "wrist_loading",
    shotType: "general",
    standard:
      "The shooting wrist is cocked back to roughly 90 degrees and holding the ball's weight before the legs begin to extend - the load is finished before the rise starts, not during it.",
  },
  {
    parameter: "wrist_loading",
    shotType: "off_dribble",
    standard:
      "Coming off the bounce, the wrist loads during the gather, so that by the time the second foot lands the ball is already sitting back in a cocked wrist and nothing about the release has to be rushed.",
  },

  // --- elbow_alignment ---
  {
    parameter: "elbow_alignment",
    shotType: "general",
    standard:
      "The shooting elbow stays stacked under the ball through the whole release - set point, rise and extension - finishing pointed at the rim rather than drifting out away from the body.",
  },

  // --- release_timing ---
  {
    parameter: "release_timing",
    shotType: "general",
    standard:
      "The ball leaves the hand at or just before the top of the jump, so the shot is powered by the legs rather than by the arm pushing after the body has already started down.",
  },
  {
    parameter: "release_timing",
    shotType: "catch_and_shoot",
    standard:
      "On a catch, the feet are set and the hands are ready before the ball arrives, so the catch and the start of the shot are one motion - no pause to gather, no extra dip.",
  },
  {
    parameter: "release_timing",
    shotType: "off_dribble",
    standard:
      "Off the dribble the pull-up rises out of the last dribble in one rhythm: gather, plant, rise, release - with the release point identical to a standing catch-and-shoot.",
  },
  {
    parameter: "release_timing",
    shotType: "free_throw",
    standard:
      "A free throw has no defender and no clock, so the timing should be the same every single rep - the same routine, the same dip, the same tempo from the bounce to the release.",
  },

  // --- shooting_pocket ---
  {
    parameter: "shooting_pocket",
    shotType: "general",
    standard:
      "The ball arrives in a consistent pocket - roughly between chest and shoulder on the shooting side - before the upward motion begins, and it starts from that same place on every attempt.",
  },
  {
    parameter: "shooting_pocket",
    shotType: "catch_and_shoot",
    standard:
      "On the catch, the ball travels straight into the pocket rather than swinging wide or dropping below the waist first - the shorter that path, the less there is to go wrong under a closeout.",
  },
  {
    parameter: "shooting_pocket",
    shotType: "off_dribble",
    standard:
      "The gather brings the ball up into the same pocket a catch would - the dribble changes how the ball gets there, and nothing about where it ends up.",
  },

  // --- lower_body_balance ---
  {
    parameter: "lower_body_balance",
    shotType: "general",
    standard:
      "Feet land roughly shoulder-width and squared to the rim, weight balanced through the middle of the foot, so the jump goes straight up rather than drifting sideways or backwards.",
  },
  {
    parameter: "lower_body_balance",
    shotType: "free_throw",
    standard:
      "The base is set and completely still before the routine starts, with the guide foot placed the same way relative to the nail every time.",
  },

  // --- jump_consistency ---
  {
    parameter: "jump_consistency",
    shotType: "general",
    standard:
      "Jump height and tempo stay close to identical from the first attempt to the last - the shot should look the same tired as it does fresh, which is what makes it hold up late in a game.",
  },
  {
    parameter: "jump_consistency",
    shotType: "free_throw",
    standard:
      "Whether the free throw comes with a small rise or no jump at all, it is the same rise every rep - a routine that changes under fatigue is the thing that misses at the end of a close game.",
  },

  // --- follow_through_arc ---
  {
    parameter: "follow_through_arc",
    shotType: "general",
    standard:
      "Full extension with the wrist snapped down and the hand held until the ball reaches the rim, producing a high, soft arc rather than a flat line drive at the front iron.",
  },

  // --- landing_position ---
  {
    parameter: "landing_position",
    shotType: "general",
    standard:
      "The shooter lands on balance at or very near the spot they took off from - landing well forward, backward or to one side means the jump carried energy the shot should have used going up.",
  },
  {
    parameter: "landing_position",
    shotType: "free_throw",
    standard:
      "Landing in the same footprint every time, still behind the line, with no step or stumble to recover balance afterwards.",
  },

  // --- side_to_side ---
  {
    parameter: "side_to_side",
    shotType: "general",
    standard:
      "The same mechanics on both sides of the floor: the release point, the pocket and the footwork should not change depending on whether the shot came from the left or the right. A large, persistent gap between the two sides usually points at a mechanical difference rather than at one side simply being unlucky.",
  },
];

/**
 * The benchmark to set a finding against.
 *
 * Prefers a standard written for the shot type the player actually tagged,
 * and falls back to the general one. Never infers a shot type the player
 * didn't give us - an untagged shot gets the general standard, which is the
 * honest answer rather than a guess dressed up as specificity.
 */
export function referenceStandardFor(
  parameter: ShotMechanicParameter,
  shotType?: ShotType | null,
): ReferenceStandard {
  if (shotType) {
    const specific = STANDARDS.find(
      (entry) => entry.parameter === parameter && entry.shotType === shotType,
    );
    if (specific) return specific;
  }

  const general = STANDARDS.find(
    (entry) => entry.parameter === parameter && entry.shotType === "general",
  );
  // Every parameter has a "general" entry, and a unit test enforces that, so
  // this is unreachable - but throwing beats silently rendering an empty
  // comparison column.
  if (!general) {
    throw new Error(
      `No reference standard authored for parameter "${parameter}".`,
    );
  }
  return general;
}

/** Exposed for the coverage test that asserts all nine parameters are covered. */
export function allReferenceStandards(): readonly ReferenceStandard[] {
  return STANDARDS;
}
