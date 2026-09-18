import "server-only";
import { ObjectId } from "mongodb";
import {
  deleteGeneratedFeedItem,
  listGeneratedFeedItems,
  replaceGeneratedFeedItem,
  upsertGeneratedFeedItem,
  type GeneratedFeedItemInput,
} from "@/server/repositories/feedRepository";
import { findWorkoutForUserOnDay } from "@/server/repositories/workoutRepository";
import { listDrills } from "@/server/repositories/drillRepository";
import {
  listPlayersByArchetype,
  listPlayersWithAuthoredEditorial,
} from "@/server/repositories/nbaPlayerRepository";
import { generateWorkout } from "@/server/services/workoutGenerationService";
import {
  getTopSkillCategories,
  SKILL_RATING_TO_CATEGORY,
} from "@/server/services/nbaPlayerService";
import { resolvePlayerEditorial } from "@/server/services/playerEditorialService";
import {
  getFeedCopyProvider,
  type FeedCopyRequest,
} from "@/server/services/feedCopyProvider";
import { loadFeedSignals, type FeedSignals } from "@/server/services/feedSignalsService";
import { feedItemKind } from "@/lib/feed-options";
import { pickDeterministic } from "@/lib/deterministic";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { goalProgressPercent, goalTemplateFor } from "@/lib/goal-types";
import { fgPercent } from "@/lib/shot-zones";
import { PLAYER_ARCHETYPES, type PlayerArchetypeKey } from "@/lib/player-archetypes";
import { dayStampToDate } from "@/lib/day-stamp";
import {
  achievementCopy,
  confidenceCopy,
  dailyWorkoutCopy,
  goalCopy,
  nextStepCopy,
  playerStudyCopy,
  progressCopy,
  tryTodayCopy,
  weaknessCopy,
  type FeedCardCopy,
} from "@/lib/feed-copy-templates";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import type {
  DrillDoc,
  FeedItemDoc,
  FeedItemKind,
  FeedItemType,
  NbaPlayerDoc,
  NbaPlayerSkillRatings,
  SkillCategory,
  WorkoutDoc,
} from "@/types/db";

/**
 * Builds one player's feed cards for one day.
 *
 * Everything here is lazy and idempotent: the first Home view of the day
 * writes the cards, and every subsequent view finds them already written.
 * There is no scheduler in this codebase to hang a nightly job off, and
 * adding one for this would be disproportionate - so "generate a new
 * recommended workout each day" (BRD 7.2) is implemented as generate-on-read
 * with the database enforcing at-most-once, via the unique partial indexes on
 * feedItems {userId, generatedForDate, kind} and workouts {userId, dayStamp}.
 *
 * Cards come in two flavours. Daily ones (today's workout, try-this-today,
 * confidence, player-to-study) are written once and stand until tomorrow.
 * Reactive ones carry a `signalsFingerprint` and are rebuilt as soon as the
 * data they quote changes, which is how the feed satisfies "recompute as new
 * shot, game, or workout data comes in" without a queue.
 */

/** Kinds that must track new activity within the day, not just at midnight. */
const REACTIVE_KINDS: ReadonlySet<FeedItemKind> = new Set([
  "weakness_callout",
  "progress_update",
  "goal_nudge",
  "next_step",
  // A milestone is only worth showing while it is fresh, and it must disappear
  // once it ages out - which the reactive sweep at the end of generateDailyFeed
  // does for free.
  "achievement_unlocked",
]);

/** The badge each generated kind displays as. */
const KIND_TO_TYPE: Record<Exclude<FeedItemKind, "library">, FeedItemType> = {
  daily_workout: "ai_recommendation",
  weakness_callout: "ai_recommendation",
  progress_update: "ai_recommendation",
  goal_nudge: "ai_recommendation",
  next_step: "tip",
  player_to_study: "player_study",
  try_today: "try_today",
  confidence_boost: "confidence_tip",
  achievement_unlocked: "ai_recommendation",
};

interface CardDraft {
  kind: Exclude<FeedItemKind, "library">;
  copy: FeedCardCopy;
  tags: string[];
  /** Measured figures this card cites. Empty for cards that cite none. */
  facts: string[];
  /** One line telling the copy rewriter what this card is for. */
  purpose: string;
  relatedDrillId?: ObjectId;
  relatedPlayerId?: ObjectId;
  relatedWorkoutId?: ObjectId;
  relatedSessionId?: ObjectId;
  relatedGoalId?: ObjectId;
}

// ---------------------------------------------------------------------------
// Today's workout
// ---------------------------------------------------------------------------

/** Why today's workout targets what it does, in the player's own terms. */
function workoutReason(signals: FeedSignals): string {
  switch (signals.targetReason) {
    case "weak_zone":
      return `Built around ${signals.weakestZone!.label}, your lowest-percentage spot.`;
    case "least_trained_focus":
      return `Aimed at ${SKILL_LABELS[signals.targetSkills[0]]}, the focus area you've trained least.`;
    case "focus_areas":
      return `Aimed at the focus areas you picked: ${signals.targetSkills
        .map((skill) => SKILL_LABELS[skill])
        .join(", ")}.`;
    default:
      return "A general session to get you started.";
  }
}

/**
 * Today's workout, created at most once per day.
 *
 * Find-then-create, with the unique index as the real guard: two concurrent
 * first-views both miss the read, both generate, and the loser's insert is
 * rejected - at which point it re-reads and uses the winner's workout rather
 * than leaving a stray pending workout behind.
 */
async function getOrCreateDailyWorkout(
  userId: ObjectId,
  signals: FeedSignals,
): Promise<WorkoutDoc | null> {
  const existing = await findWorkoutForUserOnDay(userId, signals.dayStamp);
  if (existing) return existing;

  const label =
    signals.targetReason === "weak_zone"
      ? `${signals.weakestZone!.label} focus - today's session`
      : `${SKILL_LABELS[signals.targetSkills[0]]} - today's session`;

  try {
    return await generateWorkout(userId, {
      targetSkills: signals.targetSkills,
      source: { type: "daily_feed", label },
      deprioritizeDrillIds: signals.recentDrillIds,
      varietyKey: `${userId.toString()}:${signals.dayStamp}`,
      dayStamp: signals.dayStamp,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return findWorkoutForUserOnDay(userId, signals.dayStamp);
    }
    // A player whose equipment rules out every drill genuinely has no
    // workout today. Logged rather than swallowed silently, so the reason is
    // discoverable instead of showing up as a mysteriously missing card.
    if (err instanceof NotFoundError) {
      logger.warn(
        { userId: userId.toString(), reason: err.message },
        "No daily workout could be generated for this player",
      );
      return null;
    }
    throw err;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// ---------------------------------------------------------------------------
// Player to learn from
// ---------------------------------------------------------------------------

/** Archetypes that emphasise a given skill most, strongest first. */
function archetypeKeysForSkill(
  skill: SkillCategory,
  count = 3,
): PlayerArchetypeKey[] {
  const ratingKey = (
    Object.entries(SKILL_RATING_TO_CATEGORY) as [
      keyof NbaPlayerSkillRatings,
      SkillCategory,
    ][]
  ).find(([, category]) => category === skill)?.[0];
  // `footwork` has no rating column, so some skills legitimately map to none.
  if (!ratingKey) return [];

  return Object.values(PLAYER_ARCHETYPES)
    .slice()
    .sort((a, b) => b.skills[ratingKey] - a.skills[ratingKey])
    .slice(0, count)
    .map((archetype) => archetype.key);
}

/**
 * Picks a player worth studying for the skill being trained.
 *
 * Hand-authored players are preferred because their Learn text is written
 * about that individual, so the card can say something specific and true.
 * Otherwise it falls back to a roster player whose archetype emphasises the
 * skill - content that describes a role, which the UI labels as such.
 */
async function pickPlayerToStudy(
  targetSkill: SkillCategory,
  rotationKey: string,
): Promise<NbaPlayerDoc | null> {
  const authored = await listPlayersWithAuthoredEditorial();

  const matching = authored.filter((player) =>
    getTopSkillCategories(player.editorial.skills, 3).includes(targetSkill),
  );
  const preferred = matching.length > 0 ? matching : authored;
  if (preferred.length > 0) {
    return pickDeterministic(preferred, rotationKey)!;
  }

  const byArchetype = await listPlayersByArchetype(
    archetypeKeysForSkill(targetSkill),
  );
  if (byArchetype.length === 0) return null;
  return pickDeterministic(byArchetype, rotationKey)!;
}

// ---------------------------------------------------------------------------
// Draft builders - each returns null when there is nothing honest to say
// ---------------------------------------------------------------------------

function draftWeakness(signals: FeedSignals, rotationKey: string): CardDraft | null {
  const weakest = signals.weakestZone;
  if (!weakest || !signals.latestSession) return null;

  const best = signals.bestZone;
  const copy = weaknessCopy(
    {
      zoneLabel: weakest.label,
      makes: weakest.makes,
      attempts: weakest.attempts,
      fgPercent: weakest.fgPercent,
      sessionCount: signals.sessionsInSample,
      bestZoneLabel: best?.label,
      bestZoneFgPercent: best?.fgPercent,
    },
    rotationKey,
  );

  const facts = [
    `${weakest.label}: ${weakest.makes}/${weakest.attempts} (${weakest.fgPercent}%) across your last ${signals.sessionsInSample} ${signals.sessionsInSample === 1 ? "session" : "sessions"}`,
  ];
  if (best) {
    facts.push(
      `${best.label}: ${best.makes}/${best.attempts} (${best.fgPercent}%) over the same stretch`,
    );
  }

  return {
    kind: "weakness_callout",
    copy,
    tags: ["shooting", "personalized"],
    facts,
    purpose:
      "Name the zone costing this player the most and make them want to train it.",
    relatedSessionId: signals.latestSession._id,
  };
}

function draftProgress(signals: FeedSignals, rotationKey: string): CardDraft | null {
  if (!signals.hasActivity || !signals.stats) return null;
  const stats = signals.stats;

  const attempts = stats.totalShotAttempts ?? 0;
  const makes = stats.totalShotMakes ?? 0;
  const lifetimeFgPercent = attempts > 0 ? fgPercent(makes, attempts) : undefined;

  const copy = progressCopy(
    {
      workoutsThisWeek: signals.workoutsThisWeek,
      workoutsLastWeek: signals.workoutsLastWeek,
      currentStreak: stats.currentStreak,
      totalWorkoutsCompleted: stats.totalWorkoutsCompleted,
      totalShotSessions: stats.totalShotSessions,
      lifetimeFgPercent,
    },
    rotationKey,
  );

  const facts = [
    `${signals.workoutsThisWeek} completed in the last 7 days, ${signals.workoutsLastWeek} the week before`,
    `Current streak: ${stats.currentStreak} ${stats.currentStreak === 1 ? "day" : "days"}`,
    `All time: ${stats.totalWorkoutsCompleted} ${stats.totalWorkoutsCompleted === 1 ? "workout" : "workouts"}, ${stats.totalShotSessions} shooting ${stats.totalShotSessions === 1 ? "session" : "sessions"}`,
  ];
  if (lifetimeFgPercent !== undefined) {
    facts.push(`${makes}/${attempts} (${lifetimeFgPercent}%) all time`);
  }

  return {
    kind: "progress_update",
    copy,
    tags: ["progress"],
    facts,
    purpose: "Summarise what actually changed for this player recently.",
  };
}

function draftGoal(signals: FeedSignals, rotationKey: string): CardDraft | null {
  if (signals.activeGoals.length === 0) return null;

  // Rotates between goals day to day rather than always showing the first.
  const goal = pickDeterministic(signals.activeGoals, rotationKey)!;
  const percent = goalProgressPercent(goal.currentValue, goal.targetValue);
  // The catalog is the display authority: goals seeded before the templates
  // settled carry raw metric keys ("sessions_per_week") that read as database
  // internals next to a number.
  const unit = goalTemplateFor(goal.type)?.unit ?? goal.unit;

  return {
    kind: "goal_nudge",
    copy: goalCopy(
      {
        goalTitle: goal.title,
        currentValue: goal.currentValue,
        targetValue: goal.targetValue,
        unit,
        progressPercent: percent,
      },
      rotationKey,
    ),
    tags: ["goals"],
    facts: [
      `Goal "${goal.title}": ${goal.currentValue} of ${goal.targetValue} ${unit} (${percent}%)`,
    ],
    purpose: "Remind this player where their goal stands and what closes it.",
    relatedGoalId: goal._id,
  };
}

function draftNextStep(signals: FeedSignals): CardDraft | null {
  const hasCompletedWorkout = (signals.stats?.totalWorkoutsCompleted ?? 0) > 0;
  const hasLoggedSession = (signals.stats?.totalShotSessions ?? 0) > 0;
  // Once they've done both there is no next step to point at, and the
  // progress card covers them instead.
  if (hasCompletedWorkout && hasLoggedSession) return null;

  return {
    kind: "next_step",
    copy: nextStepCopy({ hasCompletedWorkout, hasLoggedSession }),
    tags: ["getting_started"],
    // Deliberately no facts: a player at this stage has no measured data, so
    // this card must not make a claim about them at all.
    facts: [],
    purpose:
      "Tell a player with little history exactly what to do to make this feed specific. Make no claims about their performance.",
  };
}

function draftTryToday(
  signals: FeedSignals,
  drills: DrillDoc[],
  rotationKey: string,
): CardDraft | null {
  const targeted = drills.filter((drill) =>
    drill.skillTags.some((tag) => signals.targetSkills.includes(tag)),
  );
  const pool = targeted.length > 0 ? targeted : drills;
  if (pool.length === 0) return null;

  const drill = pickDeterministic(pool, rotationKey)!;

  return {
    kind: "try_today",
    copy: tryTodayCopy(
      {
        drillName: drill.name,
        drillDescription: drill.description,
        coachingCue: drill.coachingCues[0],
      },
      rotationKey,
    ),
    tags: drill.skillTags,
    facts: [],
    purpose: "Give one concrete thing to add to today's session.",
    relatedDrillId: drill._id,
  };
}

/** How long a milestone stays worth a slot on Home. */
const UNLOCK_FRESH_DAYS = 3;

/**
 * The milestone card (BRD 7.13) - the only place this feature appears outside
 * Progress, and the kind most likely to return null.
 *
 * Three gates, each of which exists to stop a false or stale claim:
 * - no genuinely-earned unlock (`earnedAt` is absent on backfilled rows, so a
 *   player who passed 25 workouts before this shipped is never told they just
 *   did);
 * - nothing unlocked recently, so an old milestone doesn't loiter on Home;
 * - `dayStamp` is the clock, not `new Date()`, so generation stays deterministic
 *   and testable like every other draft builder here.
 */
function draftAchievement(
  signals: FeedSignals,
  rotationKey: string,
): CardDraft | null {
  const latest = signals.achievements.latestUnlock;
  if (!latest?.earnedAt) return null;

  const daysSince = Math.floor(
    (dayStampToDate(signals.dayStamp).getTime() - latest.earnedAt.getTime()) /
      86_400_000,
  );
  if (daysSince > UNLOCK_FRESH_DAYS) return null;

  const { xp, unlockedCount, totalCount, next } = signals.achievements;

  return {
    kind: "achievement_unlocked",
    copy: achievementCopy(
      {
        label: latest.definition.label,
        description: latest.definition.description,
        unlockedCount,
        totalCount,
        xp,
        nextLabel: next?.definition.label,
        nextCurrent: next?.current,
        nextTarget: next?.target,
      },
      rotationKey,
    ),
    tags: ["progress", "milestone"],
    // Real, measured figures - the milestone was derived from the player's own
    // counters, so this card is entitled to cite them.
    facts: [
      `${latest.definition.label}: ${latest.current} of ${latest.target}`,
      `${unlockedCount} of ${totalCount} milestones earned`,
      `${xp.toLocaleString("en-US")} training XP`,
    ],
    purpose:
      "Acknowledge one real training milestone in a sentence, then point at the next piece of work. Keep it understated - never congratulatory filler.",
  };
}

function draftConfidence(rotationKey: string): CardDraft {
  return {
    kind: "confidence_boost",
    copy: confidenceCopy(rotationKey),
    tags: ["mental_game"],
    facts: [],
    purpose: "Offer one practical mental-game habit. No performance claims.",
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function profileSummary(signals: FeedSignals): string | null {
  const profile = signals.profile;
  if (!profile) return null;

  const parts: string[] = [];
  if (profile.position) parts.push(`plays ${profile.position}`);
  if (profile.competitiveLevel) {
    parts.push(`at ${profile.competitiveLevel.replace(/_/g, " ")} level`);
  }
  if (profile.focusAreas.length > 0) {
    parts.push(
      `focused on ${profile.focusAreas.map((s) => SKILL_LABELS[s]).join(", ")}`,
    );
  }
  if (profile.primaryGoal) parts.push(`goal: "${profile.primaryGoal}"`);
  return parts.length > 0 ? parts.join("; ") : null;
}

export async function generateDailyFeed(
  userId: ObjectId,
  dayStamp: string,
): Promise<{ signals: FeedSignals; cards: FeedItemDoc[] }> {
  const signals = await loadFeedSignals(userId, dayStamp);
  const rotationKey = `${userId.toString()}:${dayStamp}`;

  const existing = new Map(
    (await listGeneratedFeedItems(userId, dayStamp)).map((item) => [
      feedItemKind(item),
      item,
    ]),
  );

  /** A stored card is reusable unless the data it quotes has moved on. */
  const isFresh = (kind: FeedItemKind): boolean => {
    const card = existing.get(kind);
    if (!card) return false;
    if (!REACTIVE_KINDS.has(kind)) return true;
    return card.signalsFingerprint === signals.fingerprint;
  };

  const drafts: CardDraft[] = [];

  // Today's workout is only generated when its card is missing - if the card
  // is already stored it carries the workout id, so there is nothing to do.
  if (!isFresh("daily_workout")) {
    const workout = await getOrCreateDailyWorkout(userId, signals);
    if (workout) {
      drafts.push({
        kind: "daily_workout",
        copy: dailyWorkoutCopy(
          {
            drillCount: workout.drills.length,
            estimatedMinutes: workout.estimatedDurationMinutes,
            firstDrillName: workout.drills[0]?.name,
            reason: workoutReason(signals),
          },
          rotationKey,
        ),
        tags: signals.targetSkills,
        facts: [
          `${workout.drills.length} ${workout.drills.length === 1 ? "drill" : "drills"}, about ${workout.estimatedDurationMinutes} minutes: ${workout.drills.map((d) => d.name).join(", ")}`,
        ],
        purpose: "Get this player to start today's session.",
        relatedWorkoutId: workout._id,
      });
    }
  }

  if (!isFresh("weakness_callout")) {
    pushIfPresent(drafts, draftWeakness(signals, rotationKey));
  }
  if (!isFresh("next_step")) {
    pushIfPresent(drafts, draftNextStep(signals));
  }
  if (!isFresh("progress_update")) {
    pushIfPresent(drafts, draftProgress(signals, rotationKey));
  }
  if (!isFresh("goal_nudge")) {
    pushIfPresent(drafts, draftGoal(signals, rotationKey));
  }

  if (!isFresh("player_to_study")) {
    const player = await pickPlayerToStudy(signals.targetSkills[0], rotationKey);
    if (player) {
      const editorial = await resolvePlayerEditorial(player);
      drafts.push({
        kind: "player_to_study",
        copy: playerStudyCopy(
          {
            playerName: player.name,
            team: player.syncStatus === "synced" ? player.team : undefined,
            skillLabel: SKILL_LABELS[signals.targetSkills[0]],
            // Archetype text describes a role, not this individual, so it is
            // never passed off as a claim about them.
            whatTheyDoWell:
              editorial.provenance === "authored"
                ? editorial.learn.whatTheyDoWell
                : editorial.archetype?.summary,
          },
          rotationKey,
        ),
        tags: ["player_study", signals.targetSkills[0]],
        facts: [],
        purpose:
          "Point this player at someone worth studying for the skill they're training.",
        relatedPlayerId: player._id,
        relatedDrillId: editorial.signatureMoves[0]?.drillId,
      });
    }
  }

  if (!isFresh("try_today")) {
    pushIfPresent(drafts, draftTryToday(signals, await listDrills(), rotationKey));
  }
  if (!isFresh("confidence_boost")) {
    drafts.push(draftConfidence(rotationKey));
  }
  if (!isFresh("achievement_unlocked")) {
    pushIfPresent(drafts, draftAchievement(signals, rotationKey));
  }

  const written = await persistDrafts(userId, signals, drafts, existing);

  // Reactive cards whose builder now returns nothing no longer apply - the
  // clearest case being the "log your first session" prompt after they log
  // one. Left in place they would contradict the rest of the feed.
  const drafted = new Set<FeedItemKind>(drafts.map((draft) => draft.kind));
  for (const kind of REACTIVE_KINDS) {
    const card = existing.get(kind);
    if (card && !drafted.has(kind) && !isFresh(kind)) {
      await deleteGeneratedFeedItem(card._id);
      existing.delete(kind);
    }
  }

  const cards: FeedItemDoc[] = [];
  for (const kind of Object.keys(KIND_TO_TYPE) as (keyof typeof KIND_TO_TYPE)[]) {
    const card = written.get(kind) ?? existing.get(kind);
    if (card) cards.push(card);
  }

  return { signals, cards };
}

function pushIfPresent(drafts: CardDraft[], draft: CardDraft | null): void {
  if (draft) drafts.push(draft);
}

/**
 * Writes the drafts, running the copy rewriter once for the whole batch
 * rather than per card.
 */
async function persistDrafts(
  userId: ObjectId,
  signals: FeedSignals,
  drafts: CardDraft[],
  existing: Map<FeedItemKind, FeedItemDoc>,
): Promise<Map<FeedItemKind, FeedItemDoc>> {
  const written = new Map<FeedItemKind, FeedItemDoc>();
  if (drafts.length === 0) return written;

  const { provider, copySource } = getFeedCopyProvider();
  const requests: FeedCopyRequest[] = drafts.map((draft) => ({
    key: draft.kind,
    purpose: draft.purpose,
    facts: draft.facts,
    fallback: draft.copy,
  }));

  const copy = await provider.write(requests, {
    personality: signals.profile?.coachPersonality ?? "balanced",
    profileSummary: profileSummary(signals),
  });

  for (const draft of drafts) {
    const finalCopy = copy.get(draft.kind) ?? draft.copy;
    const input: GeneratedFeedItemInput = {
      userId,
      generatedForDate: signals.dayStamp,
      kind: draft.kind,
      type: KIND_TO_TYPE[draft.kind],
      title: finalCopy.title,
      body: finalCopy.body,
      tags: draft.tags,
      ...(draft.relatedDrillId ? { relatedDrillId: draft.relatedDrillId } : {}),
      ...(draft.relatedPlayerId ? { relatedPlayerId: draft.relatedPlayerId } : {}),
      ...(draft.relatedWorkoutId ? { relatedWorkoutId: draft.relatedWorkoutId } : {}),
      ...(draft.relatedSessionId ? { relatedSessionId: draft.relatedSessionId } : {}),
      ...(draft.relatedGoalId ? { relatedGoalId: draft.relatedGoalId } : {}),
      ...(REACTIVE_KINDS.has(draft.kind)
        ? { signalsFingerprint: signals.fingerprint }
        : {}),
      provenance: {
        copySource: copy.has(draft.kind) ? copySource : "template",
        facts: draft.facts,
      },
    };

    const previous = existing.get(draft.kind);
    // Replacing in place keeps the card's `_id`, so a like, a save, or a
    // Coach conversation that references it all stay pointing at something
    // that still exists.
    const card = previous
      ? ((await replaceGeneratedFeedItem(previous._id, input)) ??
        (await upsertGeneratedFeedItem(input)))
      : await upsertGeneratedFeedItem(input);

    written.set(draft.kind, card);
  }

  return written;
}
