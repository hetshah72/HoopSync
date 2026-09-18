/**
 * Development/test seed data.
 *
 * Safe to re-run: every write is an upsert keyed by a natural key (slug,
 * dateAssigned, email, etc.), so re-running never creates duplicates.
 *
 * This script seeds HoopSync's own content (drills, feed items, daily
 * quotes) plus one deterministic "demo" player with a populated profile,
 * workouts, a shot session, goals, and a Coach conversation - enough to
 * exercise the full data model before every feature's UI exists.
 *
 * NBA player *roster* data (name/team/jersey/position for the full current
 * league) is intentionally NOT seeded here - it comes from the balldontlie
 * sync service (POST /api/nba-players/sync, admin-only), since BRD v1.1
 * requires that list to be real and centrally-updatable, not hardcoded.
 * This script DOES seed hand-authored editorial content (Learn/Skills/
 * Signature Moves) for a couple of real, well-known players, with
 * `syncStatus: "pending_sync"` and a placeholder team/jersey - the roster
 * sync reconciles these by name and adopts them once it runs, without
 * touching the authored content. See nbaPlayerService.syncRoster().
 *
 * Usage: npm run db:seed
 *   Optional: set SEED_DEMO_USER_EMAIL / SEED_DEMO_USER_PASSWORD in
 *   .env.local to change the credentials the demo account is created with.
 *   They default to a placeholder address and a known password, printed at
 *   the end of the run - sign in with them at /sign-in.
 */
import { ObjectId, type Collection, type Db } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import { toDayStamp } from "@/lib/day-stamp";
import { generateDrillVariants } from "@/lib/drill-library";
import { goalTemplateFor } from "@/lib/goal-types";
import { hashPassword } from "@/lib/password";
import {
  allowedHostsFromEnv,
  classifyMediaUrl,
  mediaUrlRejectionMessage,
} from "@/lib/media-url-policy";
import type {
  CoachConversationDoc,
  DrillDoc,
  FeedItemDoc,
  GoalDoc,
  MediaAssetDoc,
  NbaPlayerDoc,
  PlayerProfileDoc,
  ShotSessionDoc,
  UserDoc,
  UserStatsDoc,
  WorkoutDoc,
} from "@/types/db";
import {
  ZONE_LABELS,
  computeZoneBreakdown,
  findBestAndWeakestZones,
  fgPercent,
} from "@/lib/shot-zones";
import {
  drillSlugForBreakdown,
  generateMechanicalBreakdown,
} from "@/lib/shot-mechanical-templates";
import { generateFeedbackForSession, headlineFor } from "@/lib/shot-feedback";
import { generateFindings } from "@/lib/shot-mechanics";
import { connectForScript } from "./lib/connection";

const DEMO_USER_EMAIL =
  process.env.SEED_DEMO_USER_EMAIL || "demo.player@hoopsync.dev";

/**
 * The demo account is seeded with a known password so it can actually be
 * signed into - it is the only way to reach the pre-populated history this
 * script exists to create, and the e2e suite signs in with it.
 *
 * This is development/test sample data. Running `npm run db:seed` against a
 * real deployment would put an account with a published password in it; that
 * was always true of this script's data, and it is why it is documented as
 * dev/test only.
 */
const DEMO_USER_PASSWORD =
  process.env.SEED_DEMO_USER_PASSWORD || "demo-player-1";

// ---------------------------------------------------------------------------
// Drills
// ---------------------------------------------------------------------------
/**
 * Exported so tests can assert the library actually covers every drill slug
 * the archetype packs reference - an archetype signature move whose drill is
 * missing is silently dropped at read time (playerEditorialService), which
 * would quietly break BRD 7.4's "every profile has a signature move".
 */
export const DRILLS: Omit<DrillDoc, "_id" | "createdAt">[] = [
  {
    slug: "form-shooting-close-range",
    name: "Form Shooting - Close Range",
    description:
      "One-hand form shooting from 3-5 feet, focused entirely on release mechanics before adding distance.",
    skillTags: ["shooting"],
    difficulty: "beginner",
    coachingCues: [
      "Elbow under the ball, not flared out",
      "Full extension and hold your follow-through",
      "Ball into the pocket before you rise",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 15,
  },
  {
    slug: "one-dribble-pull-up",
    name: "One-Dribble Pull-Up",
    description:
      "Catch, one hard dribble, pull up into a balanced jump shot. Builds the in-rhythm pull-up used off a live catch.",
    skillTags: ["shooting", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "Attack the dribble low and hard",
      "Two-foot jump stop before you rise",
      "Same release point every rep",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 10,
  },
  {
    slug: "figure-8-dribbling",
    name: "Figure-8 Ball Handling",
    description:
      "Continuous figure-8 dribble through the legs to build low, controlled handle under pressure.",
    skillTags: ["ball_handling"],
    difficulty: "beginner",
    coachingCues: [
      "Keep your eyes up, not on the ball",
      "Stay in an athletic stance the whole set",
      "Push the pace as control improves",
    ],
    equipmentNeeded: ["ball"],
    defaultSets: 3,
    defaultDurationSeconds: 45,
  },
  {
    slug: "hesitation-into-drive",
    name: "Hesitation Into Drive",
    description:
      "Change-of-pace hesitation move into a full-speed drive to the rim, live-dribble finish.",
    skillTags: ["ball_handling", "finishing"],
    difficulty: "intermediate",
    coachingCues: [
      "Sell the hesitation with your shoulders and eyes",
      "Explode on the first step after the hesitation",
      "Protect the ball with your off-hand through contact",
    ],
    equipmentNeeded: ["ball", "hoop", "cones"],
    defaultSets: 4,
    defaultReps: 8,
  },
  {
    slug: "reverse-layup-finishing",
    name: "Reverse Layup Finishing",
    description:
      "Live-ball reverse layup work from both sides of the rim to add a finishing counter versus rim protection.",
    skillTags: ["finishing"],
    difficulty: "intermediate",
    coachingCues: [
      "Take off on the correct foot for each side",
      "Shield the ball with your body on the way up",
      "Soft touch off the glass",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 10,
  },
  {
    slug: "defensive-slide-shell",
    name: "Defensive Slide Shell Drill",
    description:
      "Lateral defensive slides through a cone shell to build a low stance and quick closeouts.",
    skillTags: ["defense", "footwork"],
    difficulty: "beginner",
    coachingCues: [
      "Stay low - chest over your knees",
      "Slide, don't cross your feet",
      "Sprint-close the last two steps to a shooter",
    ],
    equipmentNeeded: ["cones"],
    defaultSets: 4,
    defaultDurationSeconds: 30,
  },
  {
    slug: "closeout-and-contest",
    name: "Closeout and Contest",
    description:
      "Sprint from the paint to contest a spot-up shooter without fouling or flying by.",
    skillTags: ["defense"],
    difficulty: "intermediate",
    coachingCues: [
      "Choppy last two steps, hand up - don't jump at the shot fake",
      "Contest straight up, stay vertical",
      "Recover into a defensive stance immediately after",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 8,
  },
  {
    slug: "pick-and-roll-reads",
    name: "Pick-and-Roll Reads",
    description:
      "Live reps reading a ball screen - reject, split, or use it downhill depending on the defense.",
    skillTags: ["playmaking"],
    difficulty: "advanced",
    coachingCues: [
      "Set up your defender before using the screen",
      "Read the screener's defender, not just your own",
      "Keep the ball on a string through traffic",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 10,
  },
  {
    slug: "kick-out-passing-accuracy",
    name: "Kick-Out Passing Accuracy",
    description:
      "Drive-and-kick reps targeting a specific catch pocket for a spot-up shooter.",
    skillTags: ["playmaking"],
    difficulty: "beginner",
    coachingCues: [
      "Pass to the shooting pocket, not at the body",
      "One-hand or two-hand kick based on distance",
      "Sell the drive before you pass",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 12,
  },
  {
    slug: "lateral-bound-plyometrics",
    name: "Lateral Bound Plyometrics",
    description:
      "Bounding side-to-side for single-leg power and first-step explosiveness.",
    skillTags: ["athletic_development"],
    difficulty: "intermediate",
    coachingCues: [
      "Stick and hold each landing before the next bound",
      "Full hip extension on takeoff",
      "Quality over speed early in the progression",
    ],
    equipmentNeeded: [],
    defaultSets: 4,
    defaultReps: 6,
  },
  {
    slug: "jump-rope-conditioning",
    name: "Jump Rope Conditioning",
    description:
      "Continuous jump rope intervals for footwork rhythm and conditioning base.",
    skillTags: ["athletic_development", "footwork"],
    difficulty: "beginner",
    coachingCues: [
      "Stay on the balls of your feet",
      "Small, quiet jumps - not big hops",
      "Relax your shoulders",
    ],
    equipmentNeeded: [],
    defaultSets: 5,
    defaultDurationSeconds: 60,
  },
  {
    slug: "hesitation-pull-up-signature",
    name: "Hesitation Into Pull-Up",
    description:
      "Hesitation dribble that sells a drive, then snaps back into a balanced pull-up jumper.",
    skillTags: ["shooting", "ball_handling"],
    difficulty: "advanced",
    coachingCues: [
      "Sell the hesitation - hips and eyes toward the rim",
      "Snap back to a two-foot, squared-up jump stop",
      "Same shot pocket as your catch-and-shoot",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 8,
  },
  // --- Drills backing the archetype signature moves ---------------------
  // Every archetype pack in src/lib/player-archetypes.ts references a drill
  // by slug, and playerEditorialService drops any move whose drill is
  // missing. tests/unit/player-archetypes.test.ts asserts this list covers
  // every slug, so a new archetype move can't silently render a dead card.
  {
    slug: "snake-the-screen",
    name: "Snake The Screen",
    description:
      "Use a ball-screen, then dribble back across the big's body to pin them on your hip and get into the middle of the floor.",
    skillTags: ["ball_handling", "playmaking"],
    difficulty: "intermediate",
    coachingCues: [
      "Get shoulder-to-shoulder with the screen before you change direction",
      "Snake back on a low, wide crossover - not a loop",
      "Eyes level with the big's chest to read the drop",
    ],
    equipmentNeeded: ["ball"],
    defaultSets: 4,
    defaultReps: 6,
  },
  {
    slug: "relocation-catch-and-shoot",
    name: "Relocation Catch-And-Shoot",
    description:
      "Drift or sprint to a new spot along the arc, then hop into a set-feet catch-and-shoot. Trains the footwork that beats a closeout before it arrives.",
    skillTags: ["shooting", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "Move when the defender's head turns, not when the pass is thrown",
      "Hop into the catch so both feet land together",
      "Hands ready before the ball leaves the passer",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 8,
  },
  {
    slug: "step-back-separation",
    name: "Step-Back Into Separation",
    description:
      "Drive a defender onto their back foot, then push off it into a straight-back step-back jumper.",
    skillTags: ["shooting", "footwork"],
    difficulty: "advanced",
    coachingCues: [
      "Push off the inside foot hard enough to actually move back",
      "Land on a balanced two-foot base, shoulders square",
      "Keep the ball high on the gather",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 6,
  },
  {
    slug: "euro-step-finishing",
    name: "Euro-Step Finishing",
    description:
      "Two-step lateral change of direction after the gather, finishing around a help defender with the outside hand.",
    skillTags: ["finishing", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "Gather early so both steps are legal and unhurried",
      "First step at the defender, second step away",
      "Finish with the hand furthest from the shot-blocker",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 10,
  },
  {
    slug: "short-roll-decision",
    name: "Short-Roll Decision Reps",
    description:
      "Catch in the space between the arc and the rim with an advantage, then read the low help before shooting, driving, or passing.",
    skillTags: ["playmaking", "finishing"],
    difficulty: "intermediate",
    coachingCues: [
      "Catch on two feet facing the rim, not turned sideways",
      "Eyes to the low man immediately on the catch",
      "One dribble maximum before you decide",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 8,
  },
  {
    slug: "pick-and-pop-trail-three",
    name: "Pick-And-Pop Trail Three",
    description:
      "Set a real screen, step back behind the arc opening to the ball, and shoot a set-feet catch-and-shoot three.",
    skillTags: ["shooting", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "Make real contact on the screen before you pop",
      "Open up to the ball as you step back, not away from it",
      "Feet set and hands ready before the pass",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 8,
  },
  {
    slug: "rim-run-seal-finish",
    name: "Rim Run And Seal Finish",
    description:
      "Sprint the middle of the floor in transition, seal the trailing defender with a wide base and high target hand, and finish off two feet.",
    skillTags: ["finishing", "athletic_development"],
    difficulty: "beginner",
    coachingCues: [
      "Sprint the middle of the floor, not the sideline",
      "Seal with a wide base and the target hand high",
      "Finish off two feet through contact",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 6,
  },
  {
    slug: "drop-coverage-verticality",
    name: "Vertical Contest At The Rim",
    description:
      "Beat the driver to the spot, then contest straight up with hands high and no swipe - a changed shot instead of a foul.",
    skillTags: ["defense", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "Position first - beat them to the spot before you jump",
      "Hands straight up, elbows in, no swipe",
      "Jump vertically, not into the shooter",
    ],
    equipmentNeeded: [],
    defaultSets: 3,
    defaultReps: 10,
  },
  {
    slug: "pace-change-downhill-attack",
    name: "Pace-Change Downhill Attack",
    description:
      "Walk a defender backward at half speed, then explode into the gap on a straight line to get shoulder past hip.",
    skillTags: ["ball_handling", "athletic_development"],
    difficulty: "intermediate",
    coachingCues: [
      "Walk them back at half speed before you accelerate",
      "Attack the front foot, not the middle of the body",
      "Shoulder past hip before you gather",
    ],
    equipmentNeeded: ["ball"],
    defaultSets: 4,
    defaultReps: 6,
  },

  // Drills backing the shooting-mechanics parameters (BRD 7.6). The other six
  // parameters map onto shooting drills that already exist above; these three
  // had no sensible match, and a parameter whose drill is missing would be
  // dropped at render time - which is exactly the silent gap
  // tests/unit/shot-mechanics-drill-coverage.test.ts exists to catch.
  {
    slug: "high-arc-form-shooting",
    name: "High-Arc Form Shooting",
    description:
      "Close-range form shooting over a raised target line, training a higher release arc and a follow-through held until the ball lands.",
    skillTags: ["shooting"],
    difficulty: "beginner",
    coachingCues: [
      "Shoot over an imaginary defender a foot taller",
      "Hold the follow-through until the ball hits the rim",
      "Softer arc beats a flat line drive every time",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 15,
  },
  {
    slug: "landing-balance-hold",
    name: "Landing Balance Hold",
    description:
      "Shoot, then freeze the landing for a two-count before moving. Trains taking off and landing in the same footprint instead of drifting.",
    skillTags: ["shooting", "footwork"],
    difficulty: "beginner",
    coachingCues: [
      "Land in the same footprint you jumped from",
      "Freeze for two counts before you move",
      "Straight up when you're open - no unforced fade",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 3,
    defaultReps: 10,
  },
  {
    slug: "mirrored-wing-symmetry",
    name: "Mirrored Wing Symmetry",
    description:
      "Alternate one shot from the left wing and one from the right, matching footwork and release point rep for rep, so the stronger side sets the standard for the weaker one.",
    skillTags: ["shooting", "footwork"],
    difficulty: "intermediate",
    coachingCues: [
      "One rep left, one rep right - never two in a row",
      "Same feet, same pocket, same release on both sides",
      "If the sides feel different, slow down until they don't",
    ],
    equipmentNeeded: ["ball", "hoop"],
    defaultSets: 4,
    defaultReps: 10,
  },
];

/**
 * Every drill gets a demo clip so BRD 7.3's "video/instruction" element is
 * never an empty frame. This is one shared, repo-local CC0 clip - it is NOT
 * footage of the drill, and the Active Workout screen says so in as many words
 * rather than letting a player assume they're watching the real thing.
 *
 * Served straight out of `public/`, deliberately, rather than from a remote
 * URL: the previous remote placeholder 404'd and silently broke playback
 * everywhere it was referenced. A vendored file cannot rot and works offline.
 *
 * Replacing this with real per-drill footage is content work, not a code
 * change - set `videoUrl` per drill in DRILLS above and this default stops
 * applying.
 */
const PLACEHOLDER_DRILL_VIDEO_URL = "/drill-demos/placeholder-drill-demo.mp4";

/**
 * How long that placeholder clip actually runs.
 *
 * The seeded demo session spaces its shots inside this window so every
 * tap-to-replay lands on real footage. Seeding timestamps past the end of the
 * clip gives a chart whose markers all open a video seeked past its own
 * duration - a dead replay, which is the one thing BRD 7.5's success criteria
 * rule out. Swap in a longer original/licensed clip and raise this, and the
 * shots spread back out on the next `npm run db:seed`.
 */
const PLACEHOLDER_CLIP_DURATION_SECONDS = 5;

/**
 * Exported so tests can run the real seeding path against an in-memory Mongo,
 * rather than a copy of it that could drift.
 */
export async function seedDrills(
  db: Db,
  placeholderAssetId: ObjectId,
): Promise<Map<string, ObjectId>> {
  const collection = db.collection<DrillDoc>(COLLECTIONS.drills);
  const idsBySlug = new Map<string, ObjectId>();

  for (const drill of DRILLS) {
    const result = await collection.findOneAndUpdate(
      { slug: drill.slug },
      {
        // `videoAssetId`/`videoSource` are what make the demo clip traceable
        // (BRD 7.14) and what let the Active Workout screen disclose it
        // truthfully instead of hardcoding "placeholder". A per-drill
        // `videoUrl` in DRILLS still overrides the default, as before.
        $set: {
          videoUrl: PLACEHOLDER_DRILL_VIDEO_URL,
          videoAssetId: placeholderAssetId,
          videoSource: "placeholder" as const,
          ...drill,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (result) idsBySlug.set(drill.slug, result._id);
  }

  // The generated variants (BRD 6.2's ~1,000-drill target). Bulk-written
  // rather than looped: there are ~1,000 of them and one round trip each would
  // turn a fast seed into a slow one. They are deliberately *not* added to
  // `idsBySlug` - only the authored core is referenced by slug from editorial
  // content and the shot-mechanics mapping, and a variant must never become
  // the drill a signature move points at.
  const variants = generateDrillVariants();
  await collection.bulkWrite(
    variants.map((drill) => ({
      updateOne: {
        filter: { slug: drill.slug },
        update: {
          $set: {
            videoUrl: PLACEHOLDER_DRILL_VIDEO_URL,
            videoAssetId: placeholderAssetId,
            videoSource: "placeholder" as const,
            ...drill,
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  console.log(
    `  seeded ${DRILLS.length} authored drills + ${variants.length} variants (${DRILLS.length + variants.length} total)`,
  );
  return idsBySlug;
}

// ---------------------------------------------------------------------------
// Media assets (placeholder content, per BRD 6.4/7.14 - traceable source)
// ---------------------------------------------------------------------------
async function seedMediaAssets(db: Db): Promise<ObjectId> {
  const collection = db.collection<MediaAssetDoc>(COLLECTIONS.mediaAssets);
  // Served from this repo rather than fetched from the public internet.
  //
  // This previously pointed at MDN's interactive-examples domain, which has
  // since been retired - so every seeded session's replay 404'd, which is
  // precisely the dead-end BRD 7.5 forbids ("a real replay - not a
  // placeholder"). A local asset can't rot, needs no network, and is still a
  // clearly-labeled placeholder per BRD 6.4/7.14. Same file the drill
  // library uses (PLACEHOLDER_DRILL_VIDEO_URL).
  const url = PLACEHOLDER_DRILL_VIDEO_URL;

  assertSeedMediaUrl(url);

  const result = await collection.findOneAndUpdate(
    { url },
    {
      $set: {
        url,
        type: "video",
        source: "placeholder",
        contributor: "hoopsync",
        rightsHolder: "HoopSync",
        // A placeholder HoopSync vendored itself is cleared by definition -
        // which is what lets the demo run end-to-end with no league licence
        // (BRD 6.4/11.1) while the clearance gate still means something for
        // everything else.
        rightsClearedAt: new Date(),
        licenseNotes:
          "Development seed placeholder - not for production use. Replace with an original/licensed asset before shipping real content.",
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );

  // This asset is keyed on `url`, so re-pointing it at the vendored file does
  // NOT migrate the old row - it inserts a second one and orphans the first.
  // That matters because `findFirstPlaceholderVideoAsset` would then have two
  // rows to choose from, and a study clip could resolve to the retired remote
  // URL. Same explicit-supersede discipline the feed items block uses for
  // retired titles.
  const superseded = await collection.deleteMany({
    source: "placeholder",
    _id: { $ne: result!._id },
    url: { $ne: url },
  });
  if (superseded.deletedCount > 0) {
    console.log(`  superseded ${superseded.deletedCount} old placeholder asset(s)`);
  }

  await backfillUploadProvenance(collection);

  console.log("  seeded 1 media asset (placeholder)");
  return result!._id;
}

/**
 * Gives pre-existing uploads the rights record the schema now requires.
 *
 * Every row with an `uploadedBy` is a player's own footage or profile photo -
 * the player is the rights holder, and it is their own content, so it is
 * cleared by definition. Idempotent (guarded on the field being absent), so
 * re-running the seed never rewrites a row that already has one, and it never
 * touches an asset an admin ingested.
 */
async function backfillUploadProvenance(
  collection: Collection<MediaAssetDoc>,
): Promise<void> {
  const result = await collection.updateMany(
    { uploadedBy: { $exists: true }, rightsHolder: { $exists: false } },
    {
      $set: {
        rightsHolder: "The HoopSync player who recorded it",
        contributor: "user",
        rightsClearedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0) {
    console.log(`  backfilled provenance on ${result.modifiedCount} upload(s)`);
  }
}

/**
 * The seed writes `mediaAssets` directly rather than through
 * `createMediaAsset`, so it would otherwise bypass the host policy that every
 * other write path enforces. `scripts/db/**` can't import `@/server/**`,
 * which is exactly why the policy itself lives in `src/lib`.
 */
function assertSeedMediaUrl(url: string): void {
  const verdict = classifyMediaUrl(url, {
    extraHosts: allowedHostsFromEnv(process.env.MEDIA_ALLOWED_HOSTS),
  });
  if (!verdict.ok) {
    throw new Error(mediaUrlRejectionMessage(verdict));
  }
}

// ---------------------------------------------------------------------------
// NBA Player Mode - editorial content for a couple of real, well-known
// players (BRD 7.4). The full current roster (name/team/jersey/position for
// every active player) comes from the balldontlie sync
// (nbaPlayerService.syncRoster, POST /api/nba-players/sync), NOT from here.
//
// `externalId`/`syncStatus`/`team`/`position` are written with
// $setOnInsert only, so re-running this script never clobbers real synced
// values if a roster sync has already reconciled this player - only the
// hand-authored `editorial` content is refreshed on every run.
// ---------------------------------------------------------------------------
async function seedNbaPlayerEditorial(
  db: Db,
  drillIds: Map<string, ObjectId>,
  placeholderMediaId: ObjectId,
): Promise<Map<string, ObjectId>> {
  const collection = db.collection<NbaPlayerDoc>(COLLECTIONS.nbaPlayers);
  const idsByName = new Map<string, ObjectId>();

  const players: Array<
    Pick<
      NbaPlayerDoc,
      "externalId" | "syncStatus" | "name" | "team" | "position" | "editorial"
    >
  > = [
    {
      externalId: "pending-sync:paul-george",
      syncStatus: "pending_sync",
      name: "Paul George",
      team: "Pending roster sync",
      position: "Small Forward",
      editorial: {
        learn: {
          whatTheyDoWell:
            "Creates his own shot off the dribble using change-of-pace moves rather than pure speed, and defends multiple positions on the other end.",
          howTheyPlay:
            "Reads ball-screens and closeouts patiently, using hesitations and step-backs to create just enough separation for his jumper.",
          whatToWatchFor:
            "Watch his eyes and shoulders before the second dribble - he sells the drive before he ever snaps back into his shot.",
        },
        skills: {
          shooting: 85,
          finishing: 75,
          ballHandling: 80,
          playmaking: 65,
          defense: 88,
          athleticism: 85,
        },
        strengths: [
          "Hesitation-into-pull-up shot creation off one or two dribbles",
          "Length and instincts that translate into multi-position defense",
          "High-volume, high-difficulty shot-making late in the clock",
        ],
        weaknesses: [
          "Efficiency can swing hard from night to night",
          "Ball security can slip when pressured full-court",
        ],
        bio: {
          careerInfo:
            "A long-tenured NBA wing known as one of the league's more versatile two-way perimeter players, equally capable of creating his own shot and defending multiple positions.",
        },
        signatureMoves: [
          {
            id: "pg-hesitation-pullup",
            name: "Hesitation Into Pull-Up",
            whatItIs:
              "A change-of-pace hesitation dribble that freezes the defender's momentum, followed by a quick snap back into a balanced pull-up jumper.",
            whenUsed:
              "Used against a defender playing off-balance or over-committing to stop a drive, especially in space on the wing or top of the key.",
            whatMakesItEffective:
              "The hesitation sells the drive so convincingly that the defender's weight shifts backward, creating just enough separation for a clean look before they can recover.",
            keyMechanics: [
              "Sell the first dribble like a real drive - eyes and shoulders toward the rim",
              "Snap back to a squared, two-foot jump stop",
              "Keep the release point identical to a standard catch-and-shoot",
            ],
            commonMistakes: [
              "Rising too early, before the defender has actually committed",
              "Drifting sideways on the snap-back instead of staying square to the rim",
            ],
            drillId: drillIds.get("hesitation-pull-up-signature")!,
          },
        ],
        // BRD 7.4: "a short study clip with call-outs of what to watch for".
        // The footage is a labeled CC0 placeholder (BRD 6.4/7.14 - no league
        // footage before a license); the call-outs are real HoopSync
        // coaching notes and are what the player actually studies.
        studyClip: {
          mediaAssetId: placeholderMediaId,
          callouts: [
            {
              atSeconds: 2,
              label: "Sell the drive",
              text: "Eyes and shoulders go to the rim first. The defender has to believe the drive before the hesitation can work.",
            },
            {
              atSeconds: 7,
              label: "Freeze, then snap back",
              text: "Watch the defender's weight shift backward. That's the moment the separation is created - not the release.",
            },
            {
              atSeconds: 12,
              label: "Square on two feet",
              text: "The snap-back lands squared to the rim on a two-foot base, in the same shot pocket as a catch-and-shoot.",
            },
          ],
        },
      },
    },
    {
      externalId: "pending-sync:stephen-curry",
      syncStatus: "pending_sync",
      name: "Stephen Curry",
      team: "Pending roster sync",
      position: "Point Guard",
      editorial: {
        learn: {
          whatTheyDoWell:
            "Gets his shot off faster than almost anyone in the league because his feet are already set before the ball arrives.",
          howTheyPlay:
            "Constantly moves without the ball - curling off screens, relocating to the weak side - so he's already square to the rim on the catch.",
          whatToWatchFor:
            "Watch his footwork in the two steps before the catch, not just the release - that's where the advantage is actually created.",
        },
        skills: {
          shooting: 99,
          finishing: 65,
          ballHandling: 92,
          playmaking: 85,
          defense: 55,
          athleticism: 72,
        },
        strengths: [
          "Off-ball footwork and relocation that creates space before he ever catches the ball",
          "Quick, low release that's difficult to closeout on in time",
          "Shooting range that forces defenses to guard well beyond the three-point line",
        ],
        weaknesses: [
          "Smaller frame that can be a target for switches on defense",
          "Below-average rim protection, as expected for a player his size",
        ],
        bio: {
          careerInfo:
            "Widely credited with changing how the NBA values three-point shooting, known for an unusually quick release and deep shooting range.",
        },
        signatureMoves: [
          {
            id: "curry-one-dribble-pullup",
            name: "One-Dribble Pull-Up Rhythm Shot",
            whatItIs:
              "A single hard dribble off the catch that resets into a balanced, rhythm jump shot without breaking stride.",
            whenUsed:
              "Used when a defender closes out under control - not tight enough to blow by, but tight enough that a standing catch-and-shoot could get contested.",
            whatMakesItEffective:
              "The one dribble manipulates the defender's distance just enough to create a clean release window, without needing to fully blow past them.",
            keyMechanics: [
              "Attack the dribble low and on a straight line, not a loop",
              "Two-foot jump stop before rising into the shot",
              "Identical release point to a standing catch-and-shoot",
            ],
            commonMistakes: [
              "Taking the dribble too far, turning a quick reset into a full drive attempt",
              "Rising off one foot instead of a balanced two-foot base",
            ],
            drillId: drillIds.get("one-dribble-pull-up")!,
          },
        ],
        studyClip: {
          mediaAssetId: placeholderMediaId,
          callouts: [
            {
              atSeconds: 2,
              label: "Feet before the ball",
              text: "The feet are already set before the pass arrives. That's why the release looks so fast - the work happened two steps earlier.",
            },
            {
              atSeconds: 7,
              label: "Relocate on the drive",
              text: "The moment the defender's head turns to the ball, the spot changes. The closeout is beaten before it starts.",
            },
            {
              atSeconds: 12,
              label: "One dribble, same release",
              text: "Off the catch or off one hard dribble, the release point doesn't move. Repeatability is the whole skill.",
            },
          ],
        },
      },
    },
  ];

  for (const player of players) {
    const result = await collection.findOneAndUpdate(
      { name: player.name },
      {
        $set: { editorial: player.editorial },
        $setOnInsert: {
          externalId: player.externalId,
          syncStatus: player.syncStatus,
          team: player.team,
          position: player.position,
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (result) idsByName.set(player.name, result._id);
  }

  console.log(
    `  seeded ${players.length} NBA player editorial profiles (pending roster sync)`,
  );
  return idsByName;
}

// ---------------------------------------------------------------------------
// Feed items
// ---------------------------------------------------------------------------
async function seedFeedItems(
  db: Db,
  drillIds: Map<string, ObjectId>,
  placeholderMediaId: ObjectId,
  playerIds: Map<string, ObjectId>,
) {
  const collection = db.collection<FeedItemDoc>(COLLECTIONS.feedItems);

  // `kind: "library"` marks these as the authored, global, same-for-everyone
  // tier. Per-user cards generated by feedGenerationService live in this same
  // collection and are told apart by carrying a `userId`.
  const items: Omit<FeedItemDoc, "_id" | "createdAt">[] = [
    {
      kind: "library",
      type: "tip",
      title: "Load your shooting wrist before you rise",
      body: "A common leak in young shooters: the wrist isn't loaded until you're already in the air. Get the ball into your shooting pocket with the wrist cocked back before your legs start extending - it shortens your release and keeps your shot on line.",
      tags: ["shooting", "mechanics"],
    },
    {
      kind: "library",
      type: "lesson",
      title: "Reading a closeout in 3 options",
      body: "When a defender closes out too hard: (1) drive past them if their momentum is forward, (2) shot-fake and shoot if they fly by, (3) hesitate and attack if they're under control. Practicing all three off the same catch builds real decision-making, not just a move.",
      tags: ["playmaking", "decision_making"],
    },
    {
      kind: "library",
      type: "drill_demo",
      title: "Hesitation Into Drive - demo",
      body: "See the footwork and timing on a hesitation move that actually freezes a defender, then drives all the way to the rim.",
      mediaAssetId: placeholderMediaId,
      relatedDrillId: drillIds.get("hesitation-into-drive"),
      tags: ["ball_handling", "finishing"],
    },
    {
      kind: "library",
      type: "player_breakdown",
      title: "Why Paul George's hesitation pull-up is so hard to guard",
      body: "PG sells his drive with his shoulders and eyes before he's even touched the ball a second time - by the time he snaps back, the defender's weight is already going the wrong direction.",
      relatedPlayerId: playerIds.get("Paul George"),
      tags: ["player_study", "shooting"],
    },
    {
      // NOTE: this card is shared seed content shown to every account,
      // including brand-new ones with zero sessions. It must therefore never
      // state findings about "your" data - the previous version claimed
      // "your right-wing percentage trails your left wing", which was
      // fabricated analytics presented as measured.
      //
      // Genuinely personalized recommendations now exist as generated cards
      // (feedGenerationService), which carry a `userId` and only ever cite
      // figures computed from that player's own records. This card stays as
      // the library-tier prompt for a player who has no such data yet.
      kind: "library",
      type: "ai_recommendation",
      title: "Find your weakest zone before you train it",
      body: "Log a shooting session in Analyze and tap each attempt as you go. The zone breakdown will show you which spot is actually costing you the most - training the zone you assume is weakest is guesswork, training the one the chart shows is not.",
      tags: ["shooting", "personalized"],
    },
    {
      kind: "library",
      type: "confidence_tip",
      title: "Nervous before tip-off? Try box breathing",
      body: "Four seconds in, four seconds hold, four seconds out, four seconds hold. Repeat for a minute in the locker room - it's a fast way to bring your heart rate down without needing quiet or privacy.",
      tags: ["mental_game"],
    },
    {
      kind: "library",
      type: "try_today",
      title: "50 one-dribble pull-ups before you leave the gym",
      body: "Not for makes - for the same release point every single time. Track how many looked identical to your first rep.",
      relatedDrillId: drillIds.get("one-dribble-pull-up"),
      tags: ["shooting"],
    },
    {
      kind: "library",
      type: "player_study",
      title: "Study: Stephen Curry's footwork off screens",
      body: "Watch how Curry's feet are already square to the rim before the ball even arrives off a screen - that's what makes his catch-and-shoot release so fast.",
      relatedPlayerId: playerIds.get("Stephen Curry"),
      tags: ["player_study", "shooting"],
    },
  ];

  for (const item of items) {
    await collection.updateOne(
      { title: item.title },
      { $set: item, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
  // Feed items are upserted by title, so a retitled card would otherwise
  // leave its previous version behind forever. These are titles this seeder
  // used to publish and has deliberately replaced - remove them so a
  // re-seed actually supersedes them instead of accumulating both.
  const supersededTitles = ["Your right-wing shot selection needs work"];
  const removed = await collection.deleteMany({
    title: { $in: supersededTitles },
  });
  if (removed.deletedCount > 0) {
    console.log(`  removed ${removed.deletedCount} superseded feed item(s)`);
  }

  console.log(`  seeded ${items.length} feed items`);
}

// ---------------------------------------------------------------------------
// Daily quotes (assigned across the next 14 days from today)
// ---------------------------------------------------------------------------
const QUOTES: { text: string; author: string }[] = [
  {
    text: "You miss 100% of the shots you don't take.",
    author: "Wayne Gretzky",
  },
  {
    text: "Hard work beats talent when talent doesn't work hard.",
    author: "Tim Notke",
  },
  {
    text: "I've failed over and over again in my life, and that is why I succeed.",
    author: "Michael Jordan",
  },
  {
    text: "Great players are willing to give up their own personal achievement for the achievement of the group.",
    author: "Kareem Abdul-Jabbar",
  },
  {
    text: "The way a team plays as a whole determines its success.",
    author: "Babe Ruth",
  },
  {
    text: "It's not whether you get knocked down, it's whether you get up.",
    author: "Vince Lombardi",
  },
  {
    text: "Consistency is what transforms average into excellence.",
    author: "Unknown",
  },
  { text: "Confidence comes from being prepared.", author: "John Wooden" },
  {
    text: "Do not let what you cannot do interfere with what you can do.",
    author: "John Wooden",
  },
  {
    text: "The most important thing is to try and inspire people so that they can be great in whatever they want to do.",
    author: "Kobe Bryant",
  },
  {
    text: "You can't get much done in life if you only work on the days when you feel good.",
    author: "Jerry West",
  },
  {
    text: "Skill is only developed through hours and hours of hard work.",
    author: "Kobe Bryant",
  },
  {
    text: "Every strike brings me closer to the next home run.",
    author: "Babe Ruth",
  },
  {
    text: "Champions keep playing until they get it right.",
    author: "Billie Jean King",
  },
];

async function seedDailyQuotes(db: Db) {
  const collection = db.collection(COLLECTIONS.dailyQuotes);
  const today = new Date();

  for (let i = 0; i < QUOTES.length; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateAssigned = toDayStamp(date);

    await collection.updateOne(
      { dateAssigned },
      { $set: { ...QUOTES[i], dateAssigned } },
      { upsert: true },
    );
  }
  console.log(
    `  seeded ${QUOTES.length} daily quotes starting ${toDayStamp(today)}`,
  );
}

// ---------------------------------------------------------------------------
// Demo user + profile + activity
// ---------------------------------------------------------------------------
async function seedDemoUser(db: Db): Promise<ObjectId> {
  const collection = db.collection<UserDoc>(COLLECTIONS.users);
  // Re-hashed on every run rather than `$setOnInsert`, so that re-seeding
  // restores the documented password even if it was changed since.
  const passwordHash = await hashPassword(DEMO_USER_PASSWORD);
  const result = await collection.findOneAndUpdate(
    { email: DEMO_USER_EMAIL },
    {
      $set: { name: "Demo Player", role: "player", passwordHash },
      $setOnInsert: { email: DEMO_USER_EMAIL, createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );
  console.log(`  seeded demo user: ${DEMO_USER_EMAIL}`);
  return result!._id;
}

/**
 * An admin account for the content pipeline (BRD 7.14).
 *
 * The admin dashboard itself does not need a player profile - `src/app/admin`
 * sits outside the `(app)` group precisely so an administrator is not made to
 * invent a height and a position to reach it. A profile is seeded anyway so
 * this one account can also browse the app as a player, which is what makes it
 * useful for checking that published content actually appears on Home.
 *
 * The role itself is NOT stored here - it is resolved per request from the
 * ADMIN_EMAILS allow-list (auth.config.ts). Seeding `role: "admin"` on the
 * document would be misleading: without the env var this account is an
 * ordinary player, and with it any listed address is an admin whether or not
 * this script ever ran.
 */
async function seedAdminUser(db: Db): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.log("  skipped admin account (set SEED_ADMIN_EMAIL to seed one)");
    return;
  }

  const users = db.collection<UserDoc>(COLLECTIONS.users);
  const passwordHash = await hashPassword(DEMO_USER_PASSWORD);
  const result = await users.findOneAndUpdate(
    { email },
    {
      $set: { name: "HoopSync Admin", role: "player", passwordHash },
      $setOnInsert: { email, createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );

  const profiles = db.collection<PlayerProfileDoc>(COLLECTIONS.playerProfiles);
  await profiles.updateOne(
    { userId: result!._id },
    {
      $setOnInsert: {
        userId: result!._id,
        displayName: "HoopSync Admin",
        focusAreas: ["shooting"],
        equipment: ["ball", "hoop"],
        coachPersonality: "balanced",
        consent: {
          parentalConsentRequired: false,
          parentalConsentGiven: false,
        },
        onboardingCompletedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  console.log(`  seeded admin account: ${email}`);
  console.log(
    `    add it to ADMIN_EMAILS in .env.local, then open /admin/content`,
  );
}

async function seedDemoProfile(db: Db, userId: ObjectId) {
  const collection = db.collection<PlayerProfileDoc>(
    COLLECTIONS.playerProfiles,
  );
  const profile: Omit<PlayerProfileDoc, "_id"> = {
    userId,
    age: 16,
    heightInches: 74,
    weightLbs: 165,
    educationLevel: "high_school",
    expectedGraduationYear: new Date().getFullYear() + 2,
    position: "Shooting Guard",
    competitiveLevel: "high_school",
    onTeam: true,
    teamName: "Lincoln High Varsity",
    teamLevel: "Varsity",
    roleOnTeam: "Rotation player",
    primaryGoal: "Become a more consistent scorer off the catch",
    focusAreas: ["shooting", "ball_handling"],
    gamesPerWeek: 2,
    practiceFrequencyPerWeek: 4,
    equipment: ["hoop", "ball", "cones"],
    coachPersonality: "balanced",
    consent: {
      dateOfBirth: new Date(new Date().getFullYear() - 16, 5, 15),
      parentalConsentRequired: false,
      parentalConsentGiven: false,
    },
    onboardingCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await collection.updateOne({ userId }, { $set: profile }, { upsert: true });
  console.log("  seeded demo player profile");
}

async function seedDemoWorkouts(
  db: Db,
  userId: ObjectId,
  drillIds: Map<string, ObjectId>,
) {
  const collection = db.collection<WorkoutDoc>(COLLECTIONS.workouts);

  const completedWorkout: Omit<WorkoutDoc, "_id"> = {
    userId,
    source: { type: "skill", label: "Shooting focus" },
    skillCategory: "shooting",
    difficulty: "intermediate",
    estimatedDurationMinutes: 30,
    status: "completed",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    completedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 + 1000 * 60 * 30),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    drills: [
      {
        drillId: drillIds.get("form-shooting-close-range")!,
        order: 1,
        name: "Form Shooting - Close Range",
        coachingCues: ["Elbow under the ball", "Full extension and hold"],
        sets: 3,
        reps: 15,
        completed: true,
      },
      {
        drillId: drillIds.get("one-dribble-pull-up")!,
        order: 2,
        name: "One-Dribble Pull-Up",
        coachingCues: ["Two-foot jump stop", "Same release point"],
        sets: 4,
        reps: 10,
        completed: true,
      },
    ],
  };

  const pendingWorkout: Omit<WorkoutDoc, "_id"> = {
    userId,
    source: { type: "player", label: "Inspired by Paul George" },
    skillCategory: "ball_handling",
    difficulty: "advanced",
    estimatedDurationMinutes: 35,
    status: "pending",
    createdAt: new Date(),
    drills: [
      {
        drillId: drillIds.get("hesitation-pull-up-signature")!,
        order: 1,
        name: "Hesitation Into Pull-Up",
        coachingCues: ["Sell the hesitation", "Snap back to a jump stop"],
        sets: 4,
        reps: 8,
        completed: false,
      },
      {
        drillId: drillIds.get("hesitation-into-drive")!,
        order: 2,
        name: "Hesitation Into Drive",
        coachingCues: ["Explode on the first step"],
        sets: 4,
        reps: 8,
        completed: false,
      },
    ],
  };

  for (const workout of [completedWorkout, pendingWorkout]) {
    await collection.updateOne(
      { userId, "source.label": workout.source.label },
      { $set: workout },
      { upsert: true },
    );
  }
  console.log("  seeded 2 demo workouts (1 completed, 1 pending)");
}

async function seedDemoShotSession(
  db: Db,
  userId: ObjectId,
  mediaAssetId: ObjectId,
  drillIds: Map<string, ObjectId>,
) {
  const collection = db.collection<ShotSessionDoc>(COLLECTIONS.shotSessions);

  // Canonical 9-zone taxonomy (BRD v1.1 §6) - a fixed demo fixture, not
  // produced by the real manual tap-to-log flow (see the header comment for
  // why NBA players are handled the same way: this is dev/test data for the
  // one seeded demo account, not a substitute for the real flow).
  const zones: ShotSessionDoc["shots"][number]["zone"][] = [
    "left_corner_3",
    "left_wing_3",
    "top_of_key_3",
    "right_wing_3",
    "right_corner_3",
  ];
  const shots: ShotSessionDoc["shots"] = [];

  // 40 shots over 5 zones = 8 attempts each. The count matters: Home's
  // weakness call-out deliberately refuses to name a zone as a weakness on
  // fewer than 5 attempts (feedSignalsService), so a 20-shot fixture left
  // the demo account unable to demonstrate the very card BRD 7.2 calls for.
  // 40 attempts in one session is also simply more realistic for a shooting
  // workout than 20.
  for (let i = 0; i < 40; i++) {
    const zone = zones[i % zones.length];
    // Left Wing 3 and Right Wing 3 are deliberately skewed apart (75%/25%,
    // vs. 50% everywhere else) so the best/weakest zones derived below are
    // genuinely distinct - not a coincidence of a formula that happened to
    // tie every zone at 50% (which is what silently made the old hardcoded
    // "left wing best / right wing weakest" narrative arbitrary).
    const made =
      zone === "right_wing_3"
        ? i % 4 === 0
        : zone === "left_wing_3"
          ? i % 4 !== 0
          : i % 2 === 0;
    // Spread evenly across the placeholder clip so every marker's replay
    // seeks somewhere real. Rounded to tenths purely so the stored fixture
    // stays readable.
    const timestampInVideoSeconds =
      Math.round((i / 40) * PLACEHOLDER_CLIP_DURATION_SECONDS * 10) / 10;
    shots.push({
      id: `demo-shot-${i + 1}`,
      zone,
      location: { xPct: (i * 37) % 100, yPct: 20 + ((i * 13) % 60) },
      made,
      timestampInVideoSeconds,
      replayStartSeconds: Math.max(0, timestampInVideoSeconds - 3),
      replayEndSeconds: timestampInVideoSeconds + 2,
      feedbackText: headlineFor(zone, made),
    });
  }

  // Exactly what finalizeSession does: back-fill the four-part feedback once
  // every shot is known, so the demo session's replay dialogs show the same
  // structure a real session's would.
  const seededFeedback = generateFeedbackForSession(shots);
  for (const shot of shots) {
    const feedback = seededFeedback.get(shot.id);
    if (feedback) {
      shot.feedback = feedback;
      shot.feedbackText = feedback.headline;
    }
  }

  // Everything below is derived from the shots themselves, using the exact
  // same real functions the app uses when finalizing a real session
  // (shotSessionService.finalizeSession) - so this fixture can't drift out
  // of sync with its own numbers again, regardless of future formula edits.
  const totalAttempts = shots.length;
  const totalMakes = shots.filter((s) => s.made).length;
  const zoneBreakdown = computeZoneBreakdown(shots);
  const { bestZone, weakestZone } = findBestAndWeakestZones(zoneBreakdown);

  const trendCallouts: string[] = [];
  if (bestZone) {
    const stats = zoneBreakdown[bestZone]!;
    trendCallouts.push(
      `${ZONE_LABELS[bestZone]}: ${fgPercent(stats.makes, stats.attempts)}% - a real strength, keep feeding possessions here.`,
    );
  }
  if (weakestZone && weakestZone !== bestZone) {
    const stats = zoneBreakdown[weakestZone]!;
    trendCallouts.push(
      `${ZONE_LABELS[weakestZone]}: ${fgPercent(stats.makes, stats.attempts)}% - the clearest area to focus your next few sessions.`,
    );
  }

  // Reuse the existing document's _id (if any) so the mechanical-breakdown
  // template selection - deterministically hashed from the session id - is
  // stable across repeated `db:seed` runs instead of reshuffling every time.
  const existing = await collection.findOne(
    { userId },
    { projection: { _id: 1 } },
  );
  const sessionId = existing?._id ?? new ObjectId();

  let mechanicalBreakdown: ShotSessionDoc["mechanicalBreakdown"];
  if (bestZone && weakestZone) {
    const weakestStats = zoneBreakdown[weakestZone]!;
    const bestStats = zoneBreakdown[bestZone]!;
    const generated = generateMechanicalBreakdown({
      sessionId,
      weakest: {
        zone: weakestZone,
        attempts: weakestStats.attempts,
        makes: weakestStats.makes,
        fgPercent: fgPercent(weakestStats.makes, weakestStats.attempts),
      },
      best: {
        zone: bestZone,
        attempts: bestStats.attempts,
        makes: bestStats.makes,
        fgPercent: fgPercent(bestStats.makes, bestStats.attempts),
      },
    });
    mechanicalBreakdown = {
      targetZone: weakestZone,
      ...generated,
      drillId: drillIds.get(drillSlugForBreakdown(weakestZone, sessionId)),
      isSimulated: true,
      // The nine-parameter analysis (BRD 7.6), from the same generator
      // finalizeSession uses - so the demo session's Mechanics tab shows real
      // content rather than the pre-7.6 empty state.
      findings: generateFindings({ sessionId, shots }, weakestZone).map(
        (finding) => ({
          ...finding,
          drillId: drillIds.get(finding.drillSlug),
        }),
      ),
    };
  }

  const session: Omit<ShotSessionDoc, "_id"> = {
    userId,
    videoAssetId: mediaAssetId,
    recordedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    status: "completed",
    shots,
    totalAttempts,
    totalMakes,
    fgPercent: fgPercent(totalMakes, totalAttempts),
    zoneBreakdown,
    bestZone,
    weakestZone,
    trendCallouts,
    mechanicalBreakdown,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
  };

  // Keyed on userId alone (not recordedAt, which is computed relative to
  // Date.now() on every run and would never match a prior run's value) -
  // exactly one demo shot session is seeded per demo user. `_id` is only
  // ever set via $setOnInsert (never $set) so re-running this against an
  // existing document can't hit Mongo's immutable-_id restriction.
  await collection.updateOne(
    { userId },
    { $set: session, $setOnInsert: { _id: sessionId } },
    { upsert: true },
  );
  console.log(
    `  seeded 1 demo shot session (${totalMakes}/${totalAttempts} FG)`,
  );

  return {
    id: sessionId,
    totalMakes,
    totalAttempts,
    fgPercent: fgPercent(totalMakes, totalAttempts),
    weakestZone,
  };
}

async function seedDemoGoals(db: Db, userId: ObjectId) {
  const collection = db.collection<GoalDoc>(COLLECTIONS.goals);

  // Units come from the catalog rather than being retyped, so a seeded goal
  // can never render as a raw metric key ("33 / 38 sessions_per_week") next
  // to a number the player is meant to read.
  const goals: Omit<GoalDoc, "_id" | "createdAt" | "updatedAt">[] = [
    {
      userId,
      type: "three_point_pct",
      title: "Raise 3PT% to 38%",
      targetValue: 38,
      currentValue: 0,
      unit: goalTemplateFor("three_point_pct")!.unit,
      status: "active",
      autoTrackedMetricKey: "shotSessions.threePointPct",
    },
    {
      userId,
      type: "training_frequency",
      title: "Train 4x per week",
      targetValue: 4,
      currentValue: 0,
      unit: goalTemplateFor("training_frequency")!.unit,
      status: "active",
      autoTrackedMetricKey: "workouts.completedPerWeek",
    },
  ];

  for (const { currentValue, status, ...goal } of goals) {
    await collection.updateOne(
      { userId, type: goal.type },
      {
        $set: goal,
        // `currentValue`/`status` are the tracker's to own: they are derived
        // from real workouts and sessions on the next recalculation. Seeding
        // them only on insert keeps a re-run from resetting progress the demo
        // account has genuinely accumulated - and keeps the seed from
        // shipping a hand-written number that reads as real activity.
        $setOnInsert: { createdAt: new Date(), currentValue, status },
        $currentDate: { updatedAt: true },
      },
      { upsert: true },
    );
  }
  console.log(`  seeded ${goals.length} demo goals`);
}

async function seedDemoCoachConversation(
  db: Db,
  userId: ObjectId,
  session: {
    id: ObjectId;
    totalMakes: number;
    totalAttempts: number;
    fgPercent: number;
    weakestZone?: ShotSessionDoc["weakestZone"];
  },
) {
  const conversations = db.collection<CoachConversationDoc>(
    COLLECTIONS.coachConversations,
  );
  const messages = db.collection(COLLECTIONS.coachMessages);

  // References the seeded shot session for real (contextRefs is no longer
  // empty) and the assistant message below cites that same session's actual
  // computed numbers, not a hand-picked figure that can drift out of sync.
  const conversation = await conversations.findOneAndUpdate(
    { userId, title: "Welcome conversation" },
    {
      $set: {
        userId,
        personality: "balanced",
        title: "Welcome conversation",
        lastMessageAt: new Date(),
        contextRefs: [{ type: "shot_session", refId: session.id }],
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );

  const conversationId = conversation!._id;
  const existingMessages = await messages.countDocuments({ conversationId });
  if (existingMessages === 0) {
    const weakestLabel = session.weakestZone
      ? ZONE_LABELS[session.weakestZone]
      : "one zone";
    await messages.insertMany([
      {
        conversationId,
        userId,
        role: "assistant",
        content: `Hey! I'm your Coach. I can see your last shooting session - ${session.totalMakes}/${session.totalAttempts} (${session.fgPercent}%), with ${weakestLabel} lagging behind the rest. Want to start there today?`,
        createdAt: new Date(Date.now() - 1000 * 60 * 5),
      },
      {
        conversationId,
        userId,
        role: "user",
        content: `Yeah let's fix ${weakestLabel.toLowerCase()}.`,
        createdAt: new Date(Date.now() - 1000 * 60 * 4),
      },
    ]);
    console.log("  seeded demo coach conversation (2 messages)");
  } else {
    console.log("  demo coach conversation already has messages, skipped");
  }
}

async function seedDemoUserStats(db: Db, userId: ObjectId) {
  const collection = db.collection<UserStatsDoc>(COLLECTIONS.userStats);
  // $setOnInsert only (matches every sibling seeder in this file) - a
  // brand-new demo account gets baseline stats, but re-running db:seed
  // against an account that has since accrued real streak/workout/session
  // activity no longer silently resets it back to these hardcoded values.
  await collection.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        currentStreak: 3,
        longestStreak: 6,
        totalWorkoutsCompleted: 1,
        totalShotSessions: 1,
        lastActivityDate: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  console.log("  seeded demo user stats (only if not already present)");
}

async function main() {
  console.log(
    `Connecting to MongoDB (db: ${process.env.MONGODB_DB_NAME || "hoopsync"})...`,
  );
  const { client, db } = await connectForScript();

  try {
    console.log("Seeding shared content:");
    // Media first: drills carry a provenance link to the placeholder clip
    // they play (BRD 7.14), so the asset has to exist before they reference it.
    const mediaAssetId = await seedMediaAssets(db);
    const drillIds = await seedDrills(db, mediaAssetId);
    const playerIds = await seedNbaPlayerEditorial(db, drillIds, mediaAssetId);
    await seedFeedItems(db, drillIds, mediaAssetId, playerIds);
    await seedDailyQuotes(db);

    console.log("Seeding demo player activity:");
    const userId = await seedDemoUser(db);
    await seedDemoProfile(db, userId);
    await seedDemoWorkouts(db, userId, drillIds);
    const demoSession = await seedDemoShotSession(
      db,
      userId,
      mediaAssetId,
      drillIds,
    );
    await seedDemoGoals(db, userId);
    await seedDemoCoachConversation(db, userId, demoSession);
    await seedDemoUserStats(db, userId);
    await seedAdminUser(db);

    console.log("\nSeed complete.");
    console.log(
      `Sign in at /sign-in with "${DEMO_USER_EMAIL}" / "${DEMO_USER_PASSWORD}" to view this account's data.`,
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  });
}
