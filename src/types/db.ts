import type { ObjectId } from "mongodb";
// Type-only, so this erases at compile time - no runtime cycle with
// player-archetypes.ts, which imports NbaPlayerSkillRatings back from here.
import type { PlayerArchetypeKey } from "@/lib/player-archetypes";

/**
 * MongoDB document shapes for every HoopSync collection.
 *
 * Convention: `_id` and foreign-key references are `ObjectId` at this layer.
 * API routes/services are responsible for mapping documents to
 * client-safe DTOs (ObjectId -> string) before returning them.
 */

export type Role = "player" | "admin";

export type CoachPersonality =
  | "encouraging"
  | "balanced"
  | "direct"
  | "elite_trainer";

export type EducationLevel = "middle_school" | "high_school" | "college";

export type CompetitiveLevel =
  | "middle_school"
  | "high_school"
  | "college"
  | "professional";

export type SkillCategory =
  | "shooting"
  | "ball_handling"
  | "finishing"
  | "defense"
  | "footwork"
  | "playmaking"
  | "athletic_development";

export type DrillDifficulty = "beginner" | "intermediate" | "advanced";

export type MediaAssetType = "video" | "image";

/**
 * The *rights basis* on which HoopSync may show a piece of content - BRD
 * 7.14's five MVP-eligible categories, one for one. This answers "are we
 * allowed to play this", and nothing else.
 */
export type MediaAssetSource =
  | "original"
  | "generated"
  | "licensed"
  | "public_domain"
  | "placeholder";

/**
 * Who produced the content, which is a genuinely different question to
 * `MediaAssetSource` and the reason BRD 7.14 lists eligible *sources*
 * separately from the MVP rights bases: `original` covers a HoopSync demo, a
 * coach's clip, and a player filming themselves, and those three carry
 * different consent and release obligations.
 *
 * It is not a label with no consequence - `mediaRightsService` keys the
 * auto-clearance rule off it. HoopSync's own content and a player's own
 * upload clear themselves; a coach, a licensor or an institution cannot,
 * because a coach uploading footage of a minor needs a human to say a release
 * exists.
 */
export type MediaAssetContributor =
  | "hoopsync"
  | "coach_trainer"
  | "user"
  | "licensor"
  | "institution";

export type ProcessingStatus = "processing" | "completed" | "failed";

// ---------------------------------------------------------------------------
// Auth (users collection is owned by @auth/mongodb-adapter; we extend it with
// app-specific fields via the adapter's session/jwt callbacks).
// accounts / sessions / verificationTokens collections are managed entirely
// by the adapter and are intentionally not modeled here.
// ---------------------------------------------------------------------------
export interface UserDoc {
  _id: ObjectId;
  name?: string;
  email: string;
  emailVerified?: Date | null;
  image?: string;
  role: Role;
  createdAt: Date;
  /**
   * scrypt hash for an email/password account, in the self-describing format
   * `src/lib/password.ts` documents. Absent - not empty - for a Google
   * account, which has no password at all; sign-in treats that absence as
   * "this account doesn't sign in with a password" rather than as a wrong
   * password.
   *
   * Never leaves the server: no DTO, session, or API response includes it.
   */
  passwordHash?: string;
}

// ---------------------------------------------------------------------------
// Player profile (BRD 7.1 Onboarding) - domain profile, separate from auth
// identity.
// ---------------------------------------------------------------------------
export interface PlayerProfileDoc {
  _id: ObjectId;
  userId: ObjectId;
  /**
   * What the player wants to be called (BRD 7.1 captures "name" under
   * Account). Google supplies a name via the Auth.js adapter and password
   * sign-up collects one on the form, and onboarding asks for it if a
   * session somehow arrives without one. Kept here rather than on the
   * adapter-owned `users` document.
   */
  displayName?: string;
  /**
   * The player's uploaded profile photo (BRD 7.1 Account).
   *
   * Kept here rather than on the adapter-owned `users.image` because
   * sessions are JWTs (auth.config.ts): `session.user.image` is frozen at
   * whatever was true when the token was minted, so an avatar written there
   * wouldn't appear until the player signed out and back in. Absent means no
   * upload - callers fall back to the identity provider's image, then to the
   * player's initial.
   */
  avatarUrl?: string;
  /**
   * The provenance row behind `avatarUrl` (BRD 7.14 "traceable, legitimate
   * source"). `avatarUrl` stays the render cache so nothing that reads it
   * breaks; this is what makes the image auditable.
   */
  avatarAssetId?: ObjectId;
  /**
   * Age in whole years *at the time onboarding was submitted*. Denormalised
   * for cheap reads and never recomputed, so prefer
   * `profileService.resolveAge()`, which derives the current age from
   * `consent.dateOfBirth`.
   */
  age?: number;
  heightInches?: number;
  weightLbs?: number;
  educationLevel?: EducationLevel;
  expectedGraduationYear?: number;
  position?: string;
  competitiveLevel?: CompetitiveLevel;
  onTeam?: boolean;
  teamName?: string;
  teamLevel?: string;
  roleOnTeam?: string;
  primaryGoal?: string;
  focusAreas: SkillCategory[];
  gamesPerWeek?: number;
  practiceFrequencyPerWeek?: number;
  equipment: string[];
  coachPersonality: CoachPersonality;
  consent: {
    dateOfBirth?: Date;
    parentalConsentRequired: boolean;
    parentalConsentGiven: boolean;
  };
  /**
   * Notification settings (BRD 7.15). Absent on every profile written before
   * notifications existed, and absence means "everything on" - see
   * `NotificationPreferences`.
   */
  notificationPreferences?: NotificationPreferences;
  /**
   * Watermark for "new content alerts": content created at or before this
   * instant has already been counted.
   *
   * Deliberately *not* inside `notificationPreferences` - that object is
   * settings the player edits, this is machine state the service maintains,
   * and merging the two would let a preferences save clobber the watermark.
   * Set on the first evaluation (and nothing is announced then, so nobody is
   * told the entire seeded library is new).
   */
  notificationsContentSeenAt?: Date;
  onboardingCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// NBA Player Mode (BRD 7.4) - synced fields (from balldontlie) + editorial
// content authored/seeded by HoopSync, kept on one document for read
// simplicity.
// ---------------------------------------------------------------------------
export interface SignatureMove {
  id: string;
  name: string;
  whatItIs: string;
  whenUsed: string;
  whatMakesItEffective: string;
  keyMechanics: string[];
  commonMistakes: string[];
  drillId: ObjectId;
}

export interface NbaPlayerSkillRatings {
  shooting: number;
  finishing: number;
  ballHandling: number;
  playmaking: number;
  defense: number;
  athleticism: number;
}

/**
 * A guided call-out over a study clip (BRD 7.4: "a short study clip with
 * call-outs of what to watch for"). `atSeconds` is a real offset into the
 * associated media asset - tapping a call-out seeks the video there.
 */
export interface StudyClipCallout {
  atSeconds: number;
  label: string;
  text: string;
}

/**
 * "synced" - team/position/jerseyNumber/height/playerImageUrl were written
 * by the balldontlie roster sync and are real/current as of lastSyncedAt.
 * "pending_sync" - this document was created by editorial content seeding
 * (a real player, hand-authored analysis) before the roster sync has run;
 * those same fields are placeholders until a sync reconciles them by name.
 * This is a data-level distinction, not just a documentation note, per BRD
 * v1.1's requirement to clearly separate real/current metadata from
 * authored/demo content.
 */
export type NbaPlayerSyncStatus = "synced" | "pending_sync";

export interface NbaPlayerDoc {
  _id: ObjectId;
  externalId: string; // balldontlie player id, or "pending-sync:<slug>" until reconciled
  syncStatus: NbaPlayerSyncStatus;
  name: string;
  team: string;
  position: string;
  jerseyNumber?: string;
  heightInches?: number;
  playerImageUrl?: string;
  /**
   * The provenance row behind `playerImageUrl`. Nothing writes either field
   * today (`buildSyncedFields` never produces an image URL), which is exactly
   * why the pairing goes in now: BRD 7.4 forbids building on scraped imagery,
   * so the day a licensed provider is contracted it must be structurally
   * impossible to populate the URL without recording where it came from.
   */
  playerImageAssetId?: ObjectId;
  /**
   * Which authored archetype pack backs this player's Learn/Skills/Signature
   * Move content when no hand-authored `editorial` exists (BRD 7.4: every
   * profile must carry at least one signature move + drill, across the whole
   * roster). Derived from position/height on every sync, never hand-set.
   * See src/lib/player-archetypes.ts.
   */
  archetypeKey?: PlayerArchetypeKey;
  // Bio-tab facts balldontlie returns alongside the roster basics (BRD 7.4
  // Bio: "career information, other relevant metadata").
  weightPounds?: number;
  college?: string;
  country?: string;
  draftYear?: number;
  draftRound?: number;
  draftNumber?: number;
  lastSyncedAt?: Date;
  editorial: {
    learn: {
      whatTheyDoWell: string;
      howTheyPlay: string;
      whatToWatchFor: string;
    };
    skills: NbaPlayerSkillRatings;
    strengths: string[];
    weaknesses: string[];
    bio: {
      careerInfo: string;
    };
    signatureMoves: SignatureMove[];
    studyClip?: {
      mediaAssetId: ObjectId;
      callouts: StudyClipCallout[];
    };
  };
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Drill library (master content, referenced - not duplicated - by workouts)
// ---------------------------------------------------------------------------
export interface DrillDoc {
  _id: ObjectId;
  slug: string;
  name: string;
  description: string;
  skillTags: SkillCategory[];
  difficulty: DrillDifficulty;
  videoUrl?: string;
  /**
   * The provenance row behind `videoUrl`. Every seeded drill currently points
   * at the shared placeholder clip with no asset row behind it at all, which
   * is the gap that made "every piece of content has a traceable source"
   * unverifiable (BRD 7.14).
   */
  videoAssetId?: ObjectId;
  /**
   * The asset's rights basis, denormalised beside `videoUrl`.
   *
   * Kept here so `drillToSnapshot` stays a pure, synchronous copy - resolving
   * the asset there would make every workout-creation path async for a single
   * enum. Written wherever `videoAssetId` is, so the two cannot disagree.
   */
  videoSource?: MediaAssetSource;
  coachingCues: string[];
  equipmentNeeded: string[];
  defaultSets?: number;
  defaultReps?: number;
  defaultDurationSeconds?: number;
  /**
   * The authored drill this one is a variant of (`DrillDoc.slug`), absent on
   * the authored drills themselves.
   *
   * BRD 6.2 targets a ~1,000-drill library, which is reached by crossing the
   * hand-authored core with the axes a coach actually varies - spot, entry,
   * pressure, hand, load (see `src/lib/drill-library.ts`). Those are real,
   * distinguishable reps, but they are *related* reps, and a catalogue that
   * presented all of them as unrelated drills would overstate what is here.
   * This field is what keeps that claim honest and is why the count is
   * defensible rather than padding.
   */
  variantOf?: string;
  /**
   * For shooting drills, the zone from the fixed 9-zone taxonomy this drill
   * trains (`src/lib/shot-zones.ts`).
   *
   * This is what lets a weak-zone recommendation pull a drill aimed at the
   * exact spot the player's own shot chart flagged, rather than a generic
   * shooting drill that happens to be tagged "shooting".
   */
  targetZone?: ShotZone;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Train / Workouts (BRD 7.3)
// ---------------------------------------------------------------------------
export type WorkoutStatus = "pending" | "in_progress" | "completed";
export type WorkoutSourceType =
  | "skill"
  | "player"
  | "game_analysis"
  | "shot_session"
  /** Home's "today's recommended workout" (BRD 7.2), generated once per day. */
  | "daily_feed"
  /**
   * The starting plan generated from onboarding answers (BRD 7.1: "use the
   * responses to generate an initial personalized recommendation / starting
   * plan"). Exactly one per player, created when onboarding completes.
   */
  | "onboarding";

export interface WorkoutDrillSnapshot {
  drillId: ObjectId;
  order: number;
  name: string;
  /**
   * The written instruction for the drill, snapshotted from `DrillDoc`.
   * BRD 7.3 requires the Active Workout screen to show "video/instruction";
   * this is the instruction half, and it is snapshotted (not looked up) for
   * the same reason the rest of this shape is - a completed workout's
   * historical content must not drift when the drill library is edited.
   */
  description?: string;
  videoUrl?: string;
  /**
   * The drill's media asset id, carried so `content:audit` can trace a
   * completed workout's footage back to a provenance row.
   */
  videoAssetId?: ObjectId;
  /**
   * The asset's rights basis, snapshotted alongside the URL.
   *
   * This is the field that keeps the Active Workout screen honest. `DrillMedia`
   * used to hardcode "Placeholder demo clip - not footage of this drill", so
   * the moment real licensed footage was attached the app would have asserted
   * the opposite of the truth. Snapshotting the source (rather than resolving
   * `videoAssetId` at render) costs no extra read and preserves the rule the
   * rest of this shape exists for: a completed workout's historical content
   * must not drift when the drill library is edited.
   */
  videoSource?: MediaAssetSource;
  coachingCues: string[];
  /**
   * Carried from the drill so completion can credit the right skills without
   * re-reading the drill library, and so a workout's real skill coverage
   * survives later edits to that library (see skillMetrics on UserStatsDoc).
   */
  skillTags?: SkillCategory[];
  difficulty?: DrillDifficulty;
  sets?: number;
  reps?: number;
  durationSeconds?: number;
  completed: boolean;
  /**
   * Deliberately distinct from `!completed`: a skipped drill was actively
   * passed over, an untouched one simply wasn't reached. BRD 7.3 requires a
   * "next/skip" control, and completion must not flatten that distinction -
   * Progress and skill metrics both depend on the honest record.
   */
  skipped?: boolean;
  /** Real time spent on this drill, accumulated across visits. */
  elapsedSeconds?: number;
}

export interface WorkoutDoc {
  _id: ObjectId;
  userId: ObjectId;
  source: {
    type: WorkoutSourceType;
    refId?: ObjectId;
    label: string;
  };
  skillCategory?: SkillCategory;
  difficulty: DrillDifficulty;
  estimatedDurationMinutes: number;
  /** Real summed drill time, written on completion. Distinct from the estimate. */
  actualDurationSeconds?: number;
  /**
   * Player-facing disclosure when the workout under-delivers against what was
   * asked for - a requested skill with no usable drills yet, or a drill above
   * the player's level. Present only when there is something to disclose, so
   * a thin drill library surfaces as honest copy instead of a silent gap.
   */
  coverageNote?: string;
  drills: WorkoutDrillSnapshot[];
  status: WorkoutStatus;
  startedAt?: Date;
  completedAt?: Date;
  /**
   * Set only on `daily_feed` workouts: the local calendar day this workout
   * was generated for (`YYYY-MM-DD`). A unique partial index on
   * {userId, dayStamp} makes "one recommended workout per player per day" an
   * invariant the database enforces rather than something every render path
   * has to remember not to violate - Home generates lazily on first view, so
   * without it a refresh would create another workout every time.
   */
  dayStamp?: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Shot Tracker (BRD 7.5 / 7.6)
// ---------------------------------------------------------------------------
/**
 * Fixed 9-zone taxonomy per BRD v1.1 §6 (from the founder's Shooting Report
 * reference screenshots) - replaces the old free-form zone string.
 */
export const SHOT_ZONES = [
  "top_of_key_3",
  "right_wing_3",
  "right_mid",
  "right_corner_3",
  "left_wing_3",
  "left_mid",
  "free_throw_mid",
  "paint",
  "left_corner_3",
] as const;
export type ShotZone = (typeof SHOT_ZONES)[number];

/**
 * How the shot was taken, as tagged by the player at log time.
 *
 * BRD 7.6 requires comparing against a reference standard "for the same shot
 * type", and the 9-zone taxonomy only says *where* a shot came from, never
 * *how* - so without this there is nothing for "the same shot type" to key
 * off. Optional on every shot: a player who just taps Make/Miss still gets a
 * full report, and the analysis falls back to the general standard rather
 * than guessing at something they didn't tell us.
 */
export const SHOT_TYPES = ["catch_and_shoot", "off_dribble", "free_throw"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

/**
 * The nine form parameters BRD 7.6 requires be captured and displayed.
 *
 * A typed tuple rather than loose strings so a template bank that silently
 * covers only some of them fails to typecheck - the previous implementation
 * covered four of the nine and nothing caught it.
 */
export const SHOT_MECHANIC_PARAMETERS = [
  "wrist_loading",
  "elbow_alignment",
  "release_timing",
  "shooting_pocket",
  "lower_body_balance",
  "jump_consistency",
  "follow_through_arc",
  "landing_position",
  "side_to_side",
] as const;
export type ShotMechanicParameter = (typeof SHOT_MECHANIC_PARAMETERS)[number];

/**
 * What a finding's *observation* rests on - the field the honesty bar
 * (BRD v1.1 §5) turns on.
 *
 * "measured"  - the observation restates the player's own logged shots and
 *               nothing more. Left-vs-right is the real case: the 9-zone
 *               taxonomy carries mirrored left_*\/right_* zones, so that split
 *               is genuinely computed from tap-logged data, not generated.
 * "simulated" - the observation is generated. No video frame was analysed and
 *               nothing in the data evidences the mechanical claim.
 *
 * `potentialIssue` and `correction` are *always* generated coaching inference
 * whatever this says, and the UI states that separately. This field only ever
 * describes where the observation came from.
 */
export type FindingBasis = "measured" | "simulated";

/**
 * One parameter's feedback in the exact shape BRD 7.6 mandates - observation
 * -> likely issue -> correction -> drill. Every part is required, so a finding
 * that drops one cannot be constructed in the first place.
 */
export interface MechanicalFinding {
  parameter: ShotMechanicParameter;
  observation: string;
  potentialIssue: string;
  correction: string;
  /** Referenced by slug because the generator is isomorphic (`src/lib`) and
   * cannot hold ObjectIds - the same arrangement archetype signature moves
   * use. The service resolves it through `findDrillsBySlugs`. */
  drillSlug: string;
  drillId?: ObjectId;
  basis: FindingBasis;
  /** The authored coaching benchmark this was set against. Describes correct
   * form, never a named player - the rule archetype packs already follow. */
  referenceStandard: string;
  referenceShotType: ShotType | "general";
}

/**
 * Per-shot technical feedback (BRD 7.5 "Individual Shot Replay").
 *
 * Structured rather than a single string because BRD 7.6's success criteria
 * require every feedback message to follow observation -> issue -> correction
 * -> drill. `observation` mixes measured facts (this shot's zone tally, the
 * player's own best zone) with the generated read on *why*; `potentialIssue`
 * and `correction` are entirely generated, which is what `isSimulated` marks.
 */
export interface ShotFeedback {
  /** "Miss - Right Wing 3" - the one-line identity of the shot. */
  headline: string;
  observation: string;
  potentialIssue: string;
  correction: string;
  /** The drill that fixes *this* shot, so "Add Drill" matches what the
   * feedback just told the player (BRD 7.5). */
  drillSlug: string;
  isSimulated: true;
}

export interface ShotRecord {
  id: string;
  zone: ShotZone;
  location: { xPct: number; yPct: number };
  made: boolean;
  /** Player-tagged at log time, so it is real input exactly like `made`.
   * Absent when the player didn't bother - never inferred from the zone. */
  shotType?: ShotType;
  timestampInVideoSeconds: number;
  /** Optional short clip window around the tap so replay can play a beat of
   * context instead of a bare seek-and-freeze. */
  replayStartSeconds?: number;
  replayEndSeconds?: number;
  /** Headline-only while the session is still being logged; the full
   * structured `feedback` is generated at finalize, where the whole session
   * is known. Kept as the render fallback for sessions logged before
   * `feedback` existed. */
  feedbackText: string;
  feedback?: ShotFeedback;
}

/**
 * The generated ("why did you miss") narrative layer - always simulated for
 * MVP (BRD v1.1 §5). `isSimulated` is a type-level, always-true marker so
 * the UI can never accidentally present this as measured analysis.
 */
export interface MechanicalBreakdown {
  targetZone: ShotZone;
  observation: string;
  makesVsMisses: string;
  potentialIssue: string;
  correction: string;
  drillId?: ObjectId;
  isSimulated: true;
  /**
   * The full nine-parameter form analysis BRD 7.6 requires (the five fields
   * above remain the weakest-zone summary BRD v1.1 §6.6 mandates, and stay
   * exactly where the Shooting Report's fixed section order expects them).
   *
   * Optional because sessions finalized before 7.6 landed have none - the
   * Mechanics tab says so rather than back-filling analysis for a video
   * nobody re-examined.
   */
  findings?: MechanicalFinding[];
}

export interface ShotSessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  videoAssetId: ObjectId;
  recordedAt: Date;
  /** "processing" = shots are still being logged; "completed" = finalized
   * with full zone/mechanical analysis and a recommended workout. */
  status: ProcessingStatus;
  shots: ShotRecord[];
  totalAttempts: number;
  totalMakes: number;
  fgPercent: number;
  zoneBreakdown: Partial<Record<ShotZone, { attempts: number; makes: number }>>;
  bestZone?: ShotZone;
  weakestZone?: ShotZone;
  trendCallouts: string[];
  mechanicalBreakdown?: MechanicalBreakdown;
  recommendedWorkoutId?: ObjectId;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Game Footage Analysis (BRD 7.7)
// ---------------------------------------------------------------------------
export interface GameEvent {
  type:
    | "shot"
    | "turnover"
    | "assist"
    | "drive"
    | "defensive_stop"
    | "off_ball_movement";
  timestampInVideoSeconds: number;
  description: string;
}

/**
 * One generated observation about a game (BRD 7.7). `category` is what ties it
 * to a trainable skill, which is what makes BRD v1.1 §7's "Game Weakness ->
 * Recommended Workout" edge real rather than narrative.
 */
export interface GameFootageObservation {
  category: string;
  text: string;
  /** Present on weaknesses: the concrete fix. */
  recommendation?: string;
}

/**
 * Where a game film report's findings actually came from.
 *
 * This is the single most important field on the document. `vision_model`
 * findings were derived from frames sampled out of the player's own upload, so
 * they may legitimately describe what happened in the video. `heuristic`
 * findings were derived from the player's profile alone and must never be
 * phrased, rendered, or handed to Coach as though anything had been watched.
 *
 * Read it through `resolveAnalysisProvenance()` in `@/lib/game-film-provenance`
 * rather than directly - documents written before real analysis existed carry
 * no value here and must degrade to `heuristic`.
 */
export type AnalysisProvenance = "vision_model" | "heuristic";

/**
 * Who the player asked us to look at. A game clip has ten players in it, so
 * without this a vision model has no way to know which one is the user - the
 * difference between a report about them and a report about "a player".
 */
export interface GameFilmSubject {
  jerseyColor?: string;
  jerseyNumber?: string;
}

export interface GameFootageAnalysisDoc {
  _id: ObjectId;
  userId: ObjectId;
  videoAssetId: ObjectId;
  uploadedAt: Date;
  status: ProcessingStatus;
  events: GameEvent[];
  strengths: GameFootageObservation[];
  weaknesses: GameFootageObservation[];
  recommendedWorkoutIds: ObjectId[];
  /**
   * States which real inputs shaped the report - the player's profile fields
   * on the heuristic path, the sampled frames on the vision path. BRD v1.1 §5
   * requires Game Film analysis to be "informed by the player's real profile
   * data, and clearly labeled"; this is the first half, `provenance` the
   * second.
   */
  basis?: string;
  /** See `AnalysisProvenance`. Absent on pre-vision documents. */
  provenance?: AnalysisProvenance;
  /** `vision_model` only: how many frames were actually sampled and sent. */
  framesAnalyzed?: number;
  /** What the player told us to look for, echoed back in the report. */
  subject?: GameFilmSubject;
  /**
   * Legacy marker from when every game report was generated. Superseded by
   * `provenance` and never written for new analyses; retained only so existing
   * documents still type-check.
   */
  isSimulated?: true;
  /** Set when analysis fails, so the report can say what went wrong. */
  failureReason?: string;
}

// ---------------------------------------------------------------------------
// AI Coach (BRD 7.8 / 7.9)
// ---------------------------------------------------------------------------
export interface CoachContextRef {
  type:
    | "shot_session"
    | "game_footage_analysis"
    | "workout"
    | "feed_item"
    /** An NBA player the player is studying (BRD 7.9 "discuss player-study
     * content"). Subject to the authored-vs-archetype honesty rule - see
     * `formatNbaPlayerContext`. */
    | "nba_player"
    /** A pre-game check-in or recovery plan (BRD 7.9 -> 7.10), so Coach can
     * pick up the mental-game thread the Confidence flow started. */
    | "confidence_checkin";
  refId: ObjectId;
  /** Set when the player asked about one specific shot rather than the whole
   * session ("Ask Coach about that shot", BRD 7.5), so every message in that
   * conversation carries the shot's own context - not just session totals. */
  shotId?: string;
}

export interface CoachConversationDoc {
  _id: ObjectId;
  userId: ObjectId;
  personality: CoachPersonality;
  title?: string;
  lastMessageAt: Date;
  contextRefs: CoachContextRef[];
  createdAt: Date;
}

export type CoachMessageRole = "user" | "assistant" | "system";

/**
 * Where an assistant message's text came from.
 *
 * Absent on every message composed by HoopSync itself - the Share With Coach
 * and Ask Coach opening lines - and on user messages. `"ai"` is a real model
 * reply; `"fallback"` is the composed keyless reply
 * (`@/lib/coach-fallback`), which the UI labels so a composed reply is never
 * mistaken for a generated one. Same rule as Game Film's `provenance`: record
 * which path ran rather than letting a reader assume.
 */
export type CoachReplySource = "ai" | "fallback";

export interface CoachMessageDoc {
  _id: ObjectId;
  conversationId: ObjectId;
  userId: ObjectId;
  role: CoachMessageRole;
  content: string;
  source?: CoachReplySource;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Confidence / Mental Game (BRD 7.10)
// ---------------------------------------------------------------------------
/**
 * The four answers BRD 7.10 names for "How are you feeling?".
 *
 * Declared as a const tuple with the union derived from it, the same way
 * `SHOT_ZONES` is above: one definition serves `z.enum()`, the exhaustive
 * `Record<ConfidenceFeeling, …>` lookup tables, and runtime iteration over
 * the chips. Declaring the union by hand and the array separately is what
 * forced the casts this replaces.
 */
export const CONFIDENCE_FEELINGS = [
  "confident",
  "nervous",
  "overthinking",
  "not_ready",
] as const;

export type ConfidenceFeeling = (typeof CONFIDENCE_FEELINGS)[number];

export interface ConfidenceCheckinDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: "pre_game" | "post_game";
  feeling?: ConfidenceFeeling;
  routine?: string;
  recoveryPlan?: {
    positives: string[];
    areasToImprove: string[];
    /** Ordered next actions. Stored as steps, not pre-numbered prose, so the
     * card can render a real list and Coach can quote step one exactly. */
    planSteps: string[];
    /** Whether the plan could cite the player's own numbers. Stored rather
     * than re-derived on read, so one rule lives in one place. */
    isDataBacked: boolean;
  };
  relatedSessionId?: ObjectId;
  /** The workout the cited session already recommended (BRD 7.10 "recommend
   * reviewing the last session"), so the plan's "run that workout" step
   * links somewhere real instead of dangling. */
  relatedWorkoutId?: ObjectId;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Goals (BRD 7.12)
// ---------------------------------------------------------------------------
export type GoalStatus = "active" | "completed" | "abandoned";

export interface GoalDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: GoalStatus;
  autoTrackedMetricKey?: string;
  /**
   * What the tracked metric already read when this goal was created, for goal
   * types whose template says `countsFrom: "creation"`. Progress is then
   * `resolvedMetric - baselineValue`, so "complete 20 workouts before
   * tryouts" means 20 *more*, not 20 lifetime.
   *
   * Absent on lifetime goals, and on any goal written before this field
   * existed - both of which read as a baseline of 0, i.e. exactly the
   * lifetime behaviour those documents were created under.
   */
  baselineValue?: number;
  targetDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Progress (BRD 7.11) - denormalized counters
// ---------------------------------------------------------------------------
export interface UserStatsDoc {
  _id: ObjectId;
  userId: ObjectId;
  currentStreak: number;
  longestStreak: number;
  totalWorkoutsCompleted: number;
  totalShotSessions: number;
  /**
   * Lifetime shooting totals, accumulated when a shot session is finalized
   * (BRD 7.11 "shooting statistics" / v1.1 §7 "Shot Session -> Shooting
   * Stats"). Optional because stats documents written before this existed
   * won't carry them - read them as `?? 0`.
   */
  totalShotAttempts?: number;
  totalShotMakes?: number;
  /**
   * Per-skill training volume (BRD 7.3 "the relevant skill metrics" / 7.11
   * "Skill development"), keyed by SkillCategory. Maintained incrementally on
   * workout completion and rebuildable from the `workouts` collection - see
   * `@/lib/skill-metrics`. Counts real completed drills only; there is
   * deliberately no synthesized skill *rating* here.
   */
  skillMetrics?: Partial<
    Record<
      SkillCategory,
      {
        workoutsCompleted: number;
        drillsCompleted: number;
        secondsTrained: number;
        lastTrainedAt?: Date;
      }
    >
  >;
  lastActivityDate?: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Achievements / XP (BRD 7.13)
// ---------------------------------------------------------------------------
/**
 * The date an achievement's criterion was first seen met - and nothing else.
 *
 * Read this carefully, because it is the opposite of how an achievement table
 * usually works: **a row is not what makes an achievement unlocked.** Unlock
 * state and XP are both *derived*, every time, from the real counters on
 * `UserStatsDoc` and the player's own records (see `@/lib/achievements` and
 * `@/lib/training-xp`). A missing row means "we never stamped a date", never
 * "locked".
 *
 * That split is deliberate. It is the same derived-not-incremented rule
 * goalService follows, and it buys three things: a stored counter can never
 * drift away from the records, a player who trained before this feature shipped
 * gets credit for that work immediately, and there is no second write path to
 * forget. The one fact that genuinely cannot be derived is *when* - so that is
 * the only thing here.
 */
export interface AchievementDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** An `AchievementKey` from `@/lib/achievements`. Kept as a plain string so
   *  the DB layer never depends on the catalog, and a key retired from the
   *  catalog leaves a readable row rather than an unparseable one. */
  key: string;
  /** When the criterion was first observed met - not necessarily when the work
   *  was done. For a backfilled row those differ, which is why the UI shows a
   *  date only when `backfilled` is absent. */
  firstObservedAt: Date;
  /**
   * Stamped by the first-ever evaluation for this account, i.e. earned before
   * this feature existed (or before the account's first activity under it).
   *
   * Excluded from the feed card and the unlock toast: announcing "you just hit
   * 25 workouts" to someone who passed 25 last month would be a false claim
   * about when, even though the badge itself is true.
   */
  backfilled?: boolean;
}

// ---------------------------------------------------------------------------
// Home Feed (BRD 7.2 / 7.14)
// ---------------------------------------------------------------------------
export type FeedItemType =
  | "tip"
  | "lesson"
  | "drill_demo"
  | "player_breakdown"
  | "ai_recommendation"
  | "confidence_tip"
  | "try_today"
  | "player_study";

/**
 * Where a card came from, which is a different question to what `type` it
 * displays as. `library` items are the authored, global, same-for-everyone
 * content; every other kind is generated per user, per day, from that
 * player's own records.
 *
 * Kept as a separate axis from `FeedItemType` because the two genuinely
 * differ: a `player_to_study` card and an authored `player_breakdown` card
 * both render as a "Player Study" type, but only one of them was built from
 * this player's data and only one of them has to be regenerated tomorrow.
 */
export const FEED_ITEM_KINDS = [
  "library",
  "daily_workout",
  "weakness_callout",
  "progress_update",
  "goal_nudge",
  "player_to_study",
  "try_today",
  "confidence_boost",
  "next_step",
  "achievement_unlocked",
] as const;
export type FeedItemKind = (typeof FEED_ITEM_KINDS)[number];

/**
 * How a card's *copy* was produced, and the real numbers it is allowed to
 * cite.
 *
 * BRD v1.1 §5 and the project's labeling rule draw the line at measured
 * versus generated. A weakness call-out's numbers are always measured - they
 * come from shots the player tap-logged themselves - but the sentence around
 * them may be written by a language model. `facts` carries those measured
 * numbers verbatim so the UI can display them as their own attributable line
 * ("Based on: ...") and so the copy can be regenerated without the figures
 * ever drifting away from the records they came from.
 *
 * The audit's highest-severity finding (P0_FINAL_QA §2.3, Bug Feed-1) was a
 * card that stated a fabricated weakness with no label. A card with
 * `copySource: "ai"` must be visibly labeled in the UI; a card with no real
 * `facts` must never make a claim about the player's own data at all.
 */
export interface FeedItemProvenance {
  copySource: "template" | "ai";
  /** Measured, player-owned figures this card is built from. May be empty. */
  facts: string[];
}

export interface FeedItemDoc {
  _id: ObjectId;
  type: FeedItemType;
  /** Absent on documents seeded before generated cards existed - read it
   * through `feedItemKind()` in src/lib/feed-options.ts, which defaults to
   * "library". */
  kind?: FeedItemKind;
  title: string;
  body: string;
  mediaAssetId?: ObjectId;
  tags: string[];
  relatedPlayerId?: ObjectId;
  relatedDrillId?: ObjectId;
  relatedWorkoutId?: ObjectId;
  relatedSessionId?: ObjectId;
  relatedGoalId?: ObjectId;
  /**
   * Set only on generated cards. Library items have no `userId`, which is
   * exactly what distinguishes the two in every query - and what lets
   * `findFeedItemById` stay one unscoped lookup, so Ask Coach and the Coach
   * context loader work on generated cards with no new plumbing.
   */
  userId?: ObjectId;
  /** `YYYY-MM-DD` (local) this card was generated for. */
  generatedForDate?: string;
  /**
   * A hash of the activity signals this card was built from, present only on
   * the kinds that must react to new data within the day.
   *
   * BRD 7.2 requires recommendations to be recomputed "as new shot, game, or
   * workout data comes in" - not merely once a day. Rather than adding a
   * notification hook to every service that writes activity (and a job
   * runner to process it, neither of which exists), a card records what the
   * data looked like when it was written. The next read recomputes the
   * fingerprint and rebuilds the card if it no longer matches, so finishing
   * a session at noon changes Home immediately, and nothing recomputes when
   * nothing has happened.
   */
  signalsFingerprint?: string;
  provenance?: FeedItemProvenance;
  createdAt: Date;
}

export type FeedInteractionAction = "like" | "save" | "share";

export interface FeedInteractionDoc {
  _id: ObjectId;
  userId: ObjectId;
  feedItemId: ObjectId;
  action: FeedInteractionAction;
  createdAt: Date;
}

export interface DailyQuoteDoc {
  _id: ObjectId;
  text: string;
  author: string;
  dateAssigned: string; // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Content provenance (BRD 7.14 / 11.1 - "traceable, legitimate source")
// ---------------------------------------------------------------------------
export interface MediaAssetDoc {
  _id: ObjectId;
  url: string;
  type: MediaAssetType;
  source: MediaAssetSource;
  /**
   * Absent on rows written before the contributor axis existed. Read it
   * through `mediaContributor()` in src/lib/media-provenance.ts, which
   * defaults to "hoopsync" - the same optional-field-with-a-defaulting-reader
   * pattern as `feedItemKind()`.
   */
  contributor?: MediaAssetContributor;
  /**
   * Who owns the content. Required, because BRD 7.14's "traceable, legitimate
   * source" is not satisfiable without naming the owner: for an upload it is
   * the person who recorded it, for licensed footage it is the licensor.
   */
  rightsHolder: string;
  /**
   * The credit line shown to players, when one is owed.
   *
   * Deliberately separate from `licenseNotes`: that field is internal ops
   * prose ("stored in GCS") and has never been rendered anywhere. Two
   * audiences, two fields - conflating them is how a storage detail ends up
   * on screen as if it were an attribution.
   */
  attribution?: string;
  /** Where a licensed or public-domain asset was obtained, so it can be traced back. */
  sourceUrl?: string;
  /**
   * Clip length, when known. BRD 7.14 asks for content that is "short-form
   * and engaging"; without a duration that requirement has nothing to bite
   * on, so ingestion records it and the reel surfaces it.
   */
  durationSeconds?: number;
  /**
   * Presence IS "rights are cleared" (BRD 7.14: "Production content must have
   * cleared rights before use"). Deliberately not paired with a boolean - a
   * flag plus a timestamp is two sources of truth that can disagree.
   *
   * Enforced at publish/attach time, never at render: BRD 6.4 and 11.1
   * require the demo to work without a league licence, so clearly-labeled
   * placeholders must keep playing.
   */
  rightsClearedAt?: Date;
  rightsClearedBy?: ObjectId;
  licenseNotes?: string;
  uploadedBy?: ObjectId;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Notifications (BRD 7.15)
// ---------------------------------------------------------------------------

/**
 * The six types are exactly BRD 7.15's six functional requirements, in its
 * order. Stored as a plain string in Mongo and constrained here, matching how
 * `position` and the other open-ended enums are handled.
 */
export const NOTIFICATION_TYPES = [
  "workout_reminder",
  "streak_reminder",
  "goal_update",
  "coach_recommendation",
  "new_content",
  "progress_milestone",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: NotificationType;
  /**
   * This notification's stable identity, and the thing that makes emission
   * at-most-once: a unique index on {userId, dedupeKey} is what stops two
   * concurrent Home renders both inserting the same nudge, exactly as the
   * unique partial index on feedItems does for generated cards.
   *
   * The key's shape encodes how often a type may recur - `...:{dayStamp}` for
   * the once-a-day reminders, `...:{entityId}` or `...:{metric}:{threshold}`
   * for the ones that may only ever fire once. See `dedupeKeyFor` in
   * src/lib/notification-types.ts.
   */
  dedupeKey: string;
  title: string;
  body: string;
  /**
   * Where tapping this notification goes. Always a real, navigable route -
   * BRD v1.1 §8 forbids dead buttons, and a notification that leads nowhere
   * is the most annoying kind.
   */
  href: string;
  /**
   * The measured figures this notification's copy cites, verbatim. Empty for
   * notifications that cite none.
   *
   * Same contract as `FeedItemProvenance.facts`: it exists so a claim can be
   * traced back to the player's own records, because the worst bug the P0
   * audit found was generated copy inventing a statistic.
   */
  facts: string[];
  /** Absent while unread. */
  readAt?: Date;
  createdAt: Date;
}

/**
 * Per-player notification settings (BRD 7.15 has no opt-out requirement of its
 * own, but shipping un-silenceable nudges to minors is not defensible).
 *
 * Everything is optional and absence means "on", so a profile written before
 * notifications existed behaves as fully enabled without a migration.
 */
export interface NotificationPreferences {
  /** Per-type switches. A type that isn't listed is enabled. */
  types?: Partial<Record<NotificationType, boolean>>;
  /**
   * A local-clock window during which time-triggered notifications are not
   * raised. `startHour === endHour` means "no quiet hours". Wraps midnight
   * when `startHour > endHour` (22 -> 7 is the useful case).
   */
  quietHours?: { startHour: number; endHour: number };
  /**
   * IANA zone (e.g. "America/New_York"), captured from the browser when the
   * player saves preferences. Without it quiet hours would mean the *server's*
   * night, which is the wrong night for most players.
   */
  timeZone?: string;
}
