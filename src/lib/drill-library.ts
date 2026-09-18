/**
 * The generated half of the drill catalogue (BRD 6.2's ~1,000-drill target).
 *
 * Pure and isomorphic so `scripts/db/seed.ts` and the app share one definition
 * - the same reason `src/lib/nba-roster.ts` exists.
 *
 * ## What these are, and what they are not
 *
 * The 24 hand-authored drills in `scripts/db/seed.ts` are the core. Everything
 * here is a **variant of one of them**, produced by crossing that drill with
 * the axes a coach actually varies: where you shoot from, whether the ball
 * arrives off a catch or off the dribble, whether anyone is closing out, which
 * hand finishes, how much load is on the movement.
 *
 * Every variant therefore carries `variantOf`, naming the base drill it came
 * from. That field is the honesty mechanism and it is not decorative: these
 * are real, distinguishable reps - "contested step-back from the left corner"
 * is genuinely different work from "unguarded catch-and-shoot at the top of
 * the key" - but they are *related* work, and a catalogue presenting 1,000
 * unrelated drills would overstate what is here. The same bar the archetype
 * packs and the simulated analysis are held to (CLAUDE.md).
 *
 * Shooting variants are keyed to the fixed 9-zone taxonomy in
 * `src/lib/shot-zones.ts`, which is what lets a weak-zone workout pull a drill
 * aimed at that exact zone rather than a generic shooting drill.
 */
import { SHOT_ZONES, THREE_POINT_ZONES, ZONE_LABELS } from "@/lib/shot-zones";
import type {
  DrillDifficulty,
  DrillDoc,
  ShotZone,
  SkillCategory,
} from "@/types/db";

export type DrillSeed = Omit<DrillDoc, "_id" | "createdAt">;

/**
 * How hard a variant is, from the constraints stacked on it.
 *
 * Deliberately *not* "hardest axis wins". That rule looks right and produces a
 * catalogue nobody can use: with four axes, one advanced value anywhere makes
 * the whole drill advanced, so the first build of this library came out as 548
 * advanced drills and 29 beginner ones. The players most likely to open this
 * app are middle-schoolers, and they would have found a 1,000-drill library
 * with essentially nothing in it they could start on.
 *
 * So difficulty is the *weight of what has been added* to the base rep:
 * beginner is the plain rep plus at most one constraint, advanced means either
 * a genuinely advanced move or three constraints at once. An advanced axis
 * still carries enough weight (3) that it can never come out beginner - a
 * Shammgod is an advanced move however gently you ask for it.
 */
const DIFFICULTY_WEIGHT: Record<DrillDifficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 3,
};

function blendDifficulty(...levels: DrillDifficulty[]): DrillDifficulty {
  const load = levels.reduce((sum, level) => sum + DIFFICULTY_WEIGHT[level], 0);
  if (load <= 1) return "beginner";
  if (load <= 3) return "intermediate";
  return "advanced";
}

function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const THREE_POINT: readonly string[] = THREE_POINT_ZONES;

/** One axis value: how it reads in a name, what it adds, and what it costs. */
interface Axis {
  key: string;
  label: string;
  cue?: string;
  difficulty?: DrillDifficulty;
  equipment?: string[];
}

function level(axis: Axis): DrillDifficulty {
  return axis.difficulty ?? "beginner";
}

function cuesFrom(base: string[], ...axes: Axis[]): string[] {
  return [...base, ...axes.flatMap((a) => (a.cue ? [a.cue] : []))];
}

// ---------------------------------------------------------------------------
// Shooting - 9 zones x 4 entries x 4 pressures x 2 tempos = 288
// ---------------------------------------------------------------------------

const SHOT_ENTRIES: Axis[] = [
  {
    key: "catch",
    label: "Catch-and-Shoot",
    cue: "Feet set before the ball arrives, not after",
  },
  {
    key: "one-dribble",
    label: "One-Dribble Pull-Up",
    cue: "One hard dribble, then a two-foot rise",
    difficulty: "intermediate",
  },
  {
    key: "step-back",
    label: "Step-Back",
    cue: "Push off the front foot to buy the space, land balanced",
    difficulty: "advanced",
  },
  {
    key: "relocation",
    label: "Relocation",
    cue: "Move to open space the moment you give the ball up",
    difficulty: "intermediate",
  },
];

const SHOT_PRESSURES: Axis[] = [
  { key: "open", label: "Unguarded" },
  {
    key: "closeout",
    label: "vs Closeout",
    cue: "Read the closeout - shoot it if the hand is low",
    difficulty: "intermediate",
  },
  {
    key: "contested",
    label: "Contested",
    cue: "Same release height with a hand in your face",
    difficulty: "advanced",
  },
  {
    key: "fatigued",
    label: "Under Fatigue",
    cue: "Legs go first - drive through the floor on every rep",
    difficulty: "advanced",
  },
];

const SHOT_TEMPOS: Axis[] = [
  { key: "controlled", label: "Controlled" },
  {
    key: "game-speed",
    label: "Game Speed",
    cue: "Shot clock in your head - catch and go",
    difficulty: "intermediate",
  },
];

/** Which authored drill each shooting entry descends from. */
const SHOT_ENTRY_BASE: Record<string, string> = {
  catch: "relocation-catch-and-shoot",
  "one-dribble": "one-dribble-pull-up",
  "step-back": "step-back-separation",
  relocation: "relocation-catch-and-shoot",
};

function shootingVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const zone of SHOT_ZONES) {
    for (const entry of SHOT_ENTRIES) {
      for (const pressure of SHOT_PRESSURES) {
        for (const tempo of SHOT_TEMPOS) {
          const zoneLabel = ZONE_LABELS[zone];
          out.push({
            slug: slugify("shoot", zone, entry.key, pressure.key, tempo.key),
            name: `${zoneLabel} ${entry.label} - ${pressure.label}, ${tempo.label}`,
            description:
              `${entry.label} reps from ${zoneLabel}, ${pressure.label.toLowerCase()}, at ${tempo.label.toLowerCase()} tempo. ` +
              `Builds a repeatable shot from the one spot your chart is pointing at.`,
            skillTags:
              entry.key === "one-dribble" || entry.key === "step-back"
                ? (["shooting", "footwork"] as SkillCategory[])
                : (["shooting"] as SkillCategory[]),
            difficulty: blendDifficulty(
              level(entry),
              level(pressure),
              level(tempo),
              // Distance is its own constraint: the four mid-range and paint
              // spots are where a beginner should be shooting from, and all
              // five three-point spots carry a step up on their own.
              THREE_POINT.includes(zone) ? "intermediate" : "beginner",
            ),
            coachingCues: cuesFrom(
              ["Same release point every rep"],
              entry,
              pressure,
              tempo,
            ),
            equipmentNeeded: ["ball", "hoop"],
            defaultSets: 3,
            defaultReps: tempo.key === "game-speed" ? 8 : 10,
            variantOf: SHOT_ENTRY_BASE[entry.key],
            targetZone: zone as ShotZone,
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Ball handling - 7 patterns x 3 hands x 4 constraints x 2 paces = 168
// ---------------------------------------------------------------------------

const HANDLE_PATTERNS: Axis[] = [
  { key: "crossover", label: "Crossover" },
  { key: "between-legs", label: "Between-the-Legs", difficulty: "intermediate" },
  { key: "behind-back", label: "Behind-the-Back", difficulty: "intermediate" },
  { key: "in-and-out", label: "In-and-Out", difficulty: "intermediate" },
  { key: "hesitation", label: "Hesitation", difficulty: "intermediate" },
  { key: "double-cross", label: "Double Crossover", difficulty: "advanced" },
  { key: "shammgod", label: "Shammgod", difficulty: "advanced" },
];

const HANDLE_HANDS: Axis[] = [
  { key: "strong", label: "Strong Hand" },
  {
    key: "weak",
    label: "Weak Hand",
    cue: "Weak hand only - if it feels ugly, it's the right rep",
    difficulty: "intermediate",
  },
  { key: "alternating", label: "Alternating", difficulty: "intermediate" },
];

const HANDLE_CONSTRAINTS: Axis[] = [
  { key: "stationary", label: "Stationary" },
  { key: "on-the-move", label: "On the Move", difficulty: "intermediate" },
  {
    key: "cones",
    label: "Through Cones",
    cue: "Change direction at the cone, not before it",
    difficulty: "intermediate",
    equipment: ["cones"],
  },
  {
    key: "eyes-up",
    label: "Eyes Up",
    cue: "Eyes on the rim the whole rep - feel the ball, don't watch it",
    difficulty: "advanced",
  },
];

const PACES: Axis[] = [
  { key: "controlled", label: "Controlled" },
  {
    key: "game-speed",
    label: "Game Speed",
    cue: "Full speed - keep the handle low when the pace climbs",
    difficulty: "intermediate",
  },
];

function ballHandlingVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const pattern of HANDLE_PATTERNS) {
    for (const hand of HANDLE_HANDS) {
      for (const constraint of HANDLE_CONSTRAINTS) {
        for (const pace of PACES) {
          out.push({
            slug: slugify(
              "handle",
              pattern.key,
              hand.key,
              constraint.key,
              pace.key,
            ),
            name: `${pattern.label} - ${hand.label}, ${constraint.label}, ${pace.label}`,
            description:
              `${pattern.label} dribble series, ${hand.label.toLowerCase()}, ${constraint.label.toLowerCase()}, at ${pace.label.toLowerCase()} pace. ` +
              `Builds a handle that holds up when the defender picks you up early.`,
            skillTags: ["ball_handling"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(pattern),
              level(hand),
              level(constraint),
              level(pace),
            ),
            coachingCues: cuesFrom(
              ["Pound the dribble - a soft dribble is a stolen dribble"],
              hand,
              constraint,
              pace,
            ),
            equipmentNeeded: ["ball", ...(constraint.equipment ?? [])],
            defaultSets: 3,
            defaultDurationSeconds: 45,
            variantOf: "figure-8-dribbling",
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Finishing - 3 sides x 5 finishes x 4 entries x 3 contact levels = 180
// ---------------------------------------------------------------------------

const FINISH_SIDES: Axis[] = [
  { key: "right", label: "Right Side" },
  {
    key: "left",
    label: "Left Side",
    cue: "Left hand finish - no cheating back to the strong hand",
  },
  { key: "middle", label: "Middle" },
];

const FINISH_TYPES: Axis[] = [
  { key: "layup", label: "Layup" },
  { key: "reverse", label: "Reverse", difficulty: "intermediate" },
  { key: "floater", label: "Floater", difficulty: "intermediate" },
  { key: "euro", label: "Euro-Step", difficulty: "advanced" },
  { key: "power", label: "Power Finish", difficulty: "intermediate" },
];

const FINISH_ENTRIES: Axis[] = [
  { key: "one-dribble", label: "Off One Dribble" },
  { key: "two-dribble", label: "Off Two Dribbles" },
  { key: "catch", label: "Off the Catch", difficulty: "intermediate" },
  { key: "cut", label: "Off a Cut", difficulty: "intermediate" },
];

const CONTACT_LEVELS: Axis[] = [
  { key: "clean", label: "Clean" },
  {
    key: "pad",
    label: "Through Contact",
    cue: "Absorb the bump and finish anyway",
    difficulty: "intermediate",
  },
  {
    key: "live",
    label: "Live Defender",
    cue: "Live defence - take what the help gives you",
    difficulty: "advanced",
  },
];

const FINISH_TYPE_BASE: Record<string, string> = {
  layup: "rim-run-seal-finish",
  reverse: "reverse-layup-finishing",
  floater: "euro-step-finishing",
  euro: "euro-step-finishing",
  power: "rim-run-seal-finish",
};

function finishingVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const side of FINISH_SIDES) {
    for (const type of FINISH_TYPES) {
      for (const entry of FINISH_ENTRIES) {
        for (const contact of CONTACT_LEVELS) {
          out.push({
            slug: slugify("finish", side.key, type.key, entry.key, contact.key),
            name: `${side.label} ${type.label} - ${entry.label}, ${contact.label}`,
            description:
              `${type.label} finishes from the ${side.label.toLowerCase()}, ${entry.label.toLowerCase()}, ${contact.label.toLowerCase()}. ` +
              `Builds the finish you actually get at the rim rather than the one you get in an empty gym.`,
            skillTags: ["finishing"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(type),
              level(entry),
              level(contact),
            ),
            coachingCues: cuesFrom(
              ["Eyes to the target on the rim, not the ball"],
              side,
              contact,
            ),
            equipmentNeeded: ["ball", "hoop"],
            defaultSets: 3,
            defaultReps: 8,
            variantOf: FINISH_TYPE_BASE[type.key],
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Defense - 6 actions x 2 contexts x 3 matchups x 2 intensities = 72
// ---------------------------------------------------------------------------

const DEFENSIVE_ACTIONS: Axis[] = [
  { key: "closeout", label: "Closeout" },
  { key: "slide", label: "Lateral Slide" },
  { key: "hedge", label: "Hedge and Recover", difficulty: "advanced" },
  { key: "drop", label: "Drop Coverage", difficulty: "intermediate" },
  { key: "box-out", label: "Box-Out" },
  { key: "deny", label: "Deny the Wing", difficulty: "intermediate" },
];

const DEFENSIVE_CONTEXTS: Axis[] = [
  { key: "on-ball", label: "On-Ball" },
  {
    key: "off-ball",
    label: "Off-Ball",
    cue: "See your man and the ball - never turn your head",
  },
];

const DEFENSIVE_MATCHUPS: Axis[] = [
  // Left at beginner deliberately, and not just to widen the matrix: guarding
  // a wing is the default rep, and without it every defensive drill inherited
  // an intermediate floor - which meant a 13-year-old signing up got a defence
  // catalogue with nothing in it they could start on.
  { key: "wing", label: "vs Wing" },
  { key: "guard", label: "vs Guard", difficulty: "intermediate" },
  { key: "big", label: "vs Big", difficulty: "intermediate" },
];

const INTENSITIES: Axis[] = [
  { key: "controlled", label: "Controlled" },
  {
    key: "live",
    label: "Live",
    cue: "Live rep - no reset until the possession ends",
    difficulty: "advanced",
  },
];

const DEFENSIVE_BASE: Record<string, string> = {
  closeout: "closeout-and-contest",
  slide: "defensive-slide-shell",
  hedge: "snake-the-screen",
  drop: "drop-coverage-verticality",
  "box-out": "defensive-slide-shell",
  deny: "defensive-slide-shell",
};

function defenseVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const action of DEFENSIVE_ACTIONS) {
    for (const context of DEFENSIVE_CONTEXTS) {
      for (const matchup of DEFENSIVE_MATCHUPS) {
        for (const intensity of INTENSITIES) {
          out.push({
            slug: slugify(
              "defend",
              action.key,
              context.key,
              matchup.key,
              intensity.key,
            ),
            name: `${action.label} - ${context.label} ${matchup.label}, ${intensity.label}`,
            description:
              `${action.label} reps ${context.label.toLowerCase()} ${matchup.label.toLowerCase()}, at ${intensity.label.toLowerCase()} intensity. ` +
              `Defence is a habit before it is an effort - this builds the habit.`,
            skillTags: ["defense", "footwork"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(action),
              level(matchup),
              level(intensity),
            ),
            coachingCues: cuesFrom(
              ["Chest over knees, hands active"],
              context,
              intensity,
            ),
            equipmentNeeded:
              action.key === "box-out" ? ["ball", "hoop"] : ["ball"],
            defaultSets: 3,
            defaultDurationSeconds: 40,
            variantOf: DEFENSIVE_BASE[action.key],
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Footwork - 6 moves x 2 entries x 3 directions x 2 tempos = 72
// ---------------------------------------------------------------------------

const FOOTWORK_MOVES: Axis[] = [
  { key: "jump-stop", label: "Jump Stop" },
  { key: "one-two", label: "1-2 Step" },
  { key: "reverse-pivot", label: "Reverse Pivot", difficulty: "intermediate" },
  { key: "front-pivot", label: "Front Pivot" },
  { key: "drop-step", label: "Drop Step", difficulty: "intermediate" },
  { key: "jab", label: "Jab Series", difficulty: "intermediate" },
];

const FOOTWORK_ENTRIES: Axis[] = [
  { key: "catch", label: "Off the Catch" },
  { key: "dribble", label: "Off the Dribble", difficulty: "intermediate" },
];

const FOOTWORK_DIRECTIONS: Axis[] = [
  { key: "baseline", label: "Baseline" },
  { key: "middle", label: "Middle" },
  { key: "step-through", label: "Step-Through", difficulty: "advanced" },
];

function footworkVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const move of FOOTWORK_MOVES) {
    for (const entry of FOOTWORK_ENTRIES) {
      for (const direction of FOOTWORK_DIRECTIONS) {
        for (const tempo of PACES) {
          out.push({
            slug: slugify(
              "footwork",
              move.key,
              entry.key,
              direction.key,
              tempo.key,
            ),
            name: `${move.label} - ${entry.label}, ${direction.label}, ${tempo.label}`,
            description:
              `${move.label} footwork ${entry.label.toLowerCase()}, working ${direction.label.toLowerCase()}, at ${tempo.label.toLowerCase()} tempo. ` +
              `Legal, repeatable footwork is what turns a good first step into a shot.`,
            skillTags: ["footwork"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(move),
              level(entry),
              level(direction),
              level(tempo),
            ),
            coachingCues: cuesFrom(
              ["Establish the pivot foot before anything else moves"],
              tempo,
            ),
            equipmentNeeded: ["ball", "hoop"],
            defaultSets: 3,
            defaultReps: 10,
            variantOf: "landing-balance-hold",
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Playmaking - 6 passes x 3 reads x 3 contexts x 2 tempos = 108
// ---------------------------------------------------------------------------

const PASS_TYPES: Axis[] = [
  { key: "chest", label: "Chest Pass" },
  { key: "bounce", label: "Bounce Pass" },
  { key: "pocket", label: "Pocket Pass", difficulty: "advanced" },
  { key: "skip", label: "Skip Pass", difficulty: "intermediate" },
  { key: "wrap", label: "Wrap-Around", difficulty: "advanced" },
  { key: "lob", label: "Lob", difficulty: "advanced" },
];

const COVERAGE_READS: Axis[] = [
  { key: "drop", label: "vs Drop", cue: "If the big sits, take the pull-up" },
  {
    key: "hedge",
    label: "vs Hedge",
    cue: "Split or reject - don't pick up your dribble",
  },
  {
    key: "switch",
    label: "vs Switch",
    cue: "Attack the mismatch immediately, before help sets",
  },
];

const PLAY_CONTEXTS: Axis[] = [
  { key: "pick-and-roll", label: "Pick-and-Roll", difficulty: "intermediate" },
  // Beginner on purpose: a controlled drive-and-kick with a chest pass is the
  // first passing read anyone learns, and it is what keeps playmaking from
  // being an intermediate-and-up skill with no entry point.
  { key: "drive-and-kick", label: "Drive-and-Kick" },
  { key: "transition", label: "Transition", difficulty: "advanced" },
];

function playmakingVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const pass of PASS_TYPES) {
    for (const read of COVERAGE_READS) {
      for (const context of PLAY_CONTEXTS) {
        for (const tempo of PACES) {
          out.push({
            slug: slugify("pass", pass.key, read.key, context.key, tempo.key),
            name: `${pass.label} ${read.label} - ${context.label}, ${tempo.label}`,
            description:
              `${pass.label} out of ${context.label.toLowerCase()} ${read.label.toLowerCase()}, at ${tempo.label.toLowerCase()} tempo. ` +
              `The pass is the easy part - this drills the read that comes before it.`,
            skillTags: ["playmaking"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(pass),
              level(context),
              level(tempo),
            ),
            coachingCues: cuesFrom(
              ["Eyes up before the ball leaves your hands"],
              read,
              tempo,
            ),
            equipmentNeeded: ["ball", "hoop"],
            defaultSets: 3,
            defaultReps: 10,
            variantOf:
              context.key === "pick-and-roll"
                ? "pick-and-roll-reads"
                : "kick-out-passing-accuracy",
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Athletic development - 6 patterns x 3 planes x 3 loads x 2 efforts = 108
// ---------------------------------------------------------------------------

const ATHLETIC_PATTERNS: Axis[] = [
  { key: "bound", label: "Bound", difficulty: "intermediate" },
  { key: "hop", label: "Pogo Hop" },
  { key: "skater", label: "Skater Jump", difficulty: "intermediate" },
  { key: "depth-drop", label: "Depth Drop", difficulty: "advanced" },
  { key: "sprint", label: "Acceleration Sprint" },
  { key: "decel", label: "Deceleration Stop", difficulty: "intermediate" },
];

const PLANES: Axis[] = [
  { key: "linear", label: "Linear" },
  { key: "lateral", label: "Lateral", difficulty: "intermediate" },
  { key: "rotational", label: "Rotational", difficulty: "advanced" },
];

const LOADS: Axis[] = [
  { key: "bodyweight", label: "Bodyweight" },
  {
    key: "band",
    label: "Banded",
    difficulty: "intermediate",
    equipment: ["resistance_bands"],
  },
  {
    key: "vest",
    label: "Weighted",
    difficulty: "advanced",
    equipment: ["weighted_vest"],
  },
];

/**
 * Plyometric intent. Not a cosmetic axis: a controlled rep trains landing
 * mechanics and a maximal rep trains force production, and they are coached as
 * different sessions with different rest.
 */
const EFFORTS: Axis[] = [
  {
    key: "controlled",
    label: "Controlled",
    cue: "Stick the landing for a full second before the next rep",
  },
  {
    key: "explosive",
    label: "Maximal",
    cue: "Full effort, full rest - quality over count",
    difficulty: "intermediate",
  },
];

function athleticVariants(): DrillSeed[] {
  const out: DrillSeed[] = [];

  for (const pattern of ATHLETIC_PATTERNS) {
    for (const plane of PLANES) {
      for (const load of LOADS) {
        for (const effort of EFFORTS) {
          out.push({
            slug: slugify(
              "athletic",
              pattern.key,
              plane.key,
              load.key,
              effort.key,
            ),
            name: `${plane.label} ${pattern.label} - ${load.label}, ${effort.label}`,
            description:
              `${plane.label} ${pattern.label.toLowerCase()}s, ${load.label.toLowerCase()}, at ${effort.label.toLowerCase()} effort. ` +
              `Landing mechanics first, height second - this is the work that keeps ankles and knees healthy.`,
            skillTags: ["athletic_development"] as SkillCategory[],
            difficulty: blendDifficulty(
              level(pattern),
              level(plane),
              level(load),
              level(effort),
            ),
            coachingCues: cuesFrom(
              [
                "Land quiet - noise is force you failed to absorb",
                "Knees track over the toes, never inside them",
              ],
              effort,
            ),
            equipmentNeeded: [...(load.equipment ?? [])],
            defaultSets: 3,
            defaultReps: effort.key === "explosive" ? 5 : 8,
            variantOf: "lateral-bound-plyometrics",
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

/**
 * Every generated variant, deterministically ordered.
 *
 * Deterministic because the seed script upserts by slug: the same call always
 * produces the same catalogue, so re-seeding is a no-op rather than a churn of
 * inserts and deletes.
 */
export function generateDrillVariants(): DrillSeed[] {
  return [
    ...shootingVariants(),
    ...ballHandlingVariants(),
    ...finishingVariants(),
    ...defenseVariants(),
    ...footworkVariants(),
    ...playmakingVariants(),
    ...athleticVariants(),
  ];
}
