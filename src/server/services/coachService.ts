import "server-only";
import type { ObjectId } from "mongodb";
import {
  countConversationsForUser as countConversationsRepo,
  createConversation as createConversationRepo,
  findConversationByContextRef,
  findConversationByIdForUser,
  listConversationsForUser as listConversationsRepo,
  touchConversationLastMessageAt,
  updateConversationPersonality as updateConversationPersonalityRepo,
} from "@/server/repositories/coachRepository";
import {
  createMessage,
  listMessagesForConversation as listMessagesForConversationRepo,
} from "@/server/repositories/coachMessageRepository";
import { findFeedItemById } from "@/server/repositories/feedRepository";
import { listActiveGoalsForUser } from "@/server/repositories/goalRepository";
import { getProfileByUserId } from "@/server/services/profileService";
import { getStatsForUser } from "@/server/services/progressService";
import { loadContextBlocks } from "@/server/services/coachContextService";
import { buildCoachSystemPrompt } from "@/server/services/coachPromptService";
import { getLatestPreGameCheckin } from "@/server/services/confidenceService";
import { findSessionByIdForUser } from "@/server/repositories/shotSessionRepository";
import { recoveryPlanOpeningLine } from "@/lib/confidence-recovery";
import { respondWithBestProvider } from "@/server/services/coachResponseProvider";
import { checkRateLimit } from "@/server/lib/rateLimiter";
import { logger } from "@/server/logger";
import { AppError, NotFoundError } from "@/server/errors";
import { coachVoice, leadWith } from "@/lib/coach-voice";
import { FEELING_LABELS } from "@/lib/confidence-routines";
import { fgPercent, ZONE_LABELS } from "@/lib/shot-zones";
import {
  GAME_CATEGORY_LABELS,
  type GameAnalysisCategory,
} from "@/lib/game-film-categories";
import {
  provenanceOpeningLine,
  resolveAnalysisProvenance,
} from "@/lib/game-film-provenance";
import type {
  CoachConversationDoc,
  CoachMessageDoc,
  CoachPersonality,
  ConfidenceCheckinDoc,
  FeedItemDoc,
  GameFootageAnalysisDoc,
  GoalDoc,
  NbaPlayerDoc,
  ShotSessionDoc,
  UserStatsDoc,
  WorkoutDoc,
} from "@/types/db";

const MAX_MESSAGES_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * "Ask Coach" from a feed card (BRD v1.1 §7: Feed Content -> Ask Coach).
 *
 * Resumes the existing conversation about this card if there is one. Tapping
 * Ask Coach three times used to create three separate conversations, each
 * opening completely empty (audit Bug Feed-3 / FEED-06) - so the player got a
 * cluttered Coach list and, on arrival, exactly the "generic greeting" the
 * BRD forbids.
 *
 * The opener is composed here from the card's own real content rather than
 * generated, for the same reasons `openingLineForShotSession` is: it is
 * factual, instant, and works with no API key configured.
 */
export async function startConversationFromFeedItem(
  userId: ObjectId,
  personality: CoachPersonality,
  feedItemId: ObjectId,
): Promise<ObjectId> {
  const feedItem = await findFeedItemById(feedItemId);
  if (!feedItem) {
    throw new NotFoundError("Feed item not found.");
  }

  const existing = await findConversationByContextRef(
    userId,
    "feed_item",
    feedItemId,
  );
  if (existing) {
    return existing._id;
  }

  const conversation = await createConversationRepo({
    userId,
    personality,
    title: feedItem.title,
    lastMessageAt: new Date(),
    contextRefs: [{ type: "feed_item", refId: feedItemId }],
    createdAt: new Date(),
  });

  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: openingLineForFeedItem(feedItem, personality),
    createdAt: new Date(),
  });

  return conversation._id;
}

/** Names the card the player tapped, so the chat never opens blank. */
function openingLineForFeedItem(
  item: FeedItemDoc,
  personality: CoachPersonality,
): string {
  const facts = item.provenance?.facts ?? [];
  const evidence =
    facts.length > 0
      ? ` That one's built from your own numbers - ${facts[0]}.`
      : "";
  return `You're asking about "${item.title}".${evidence} ${coachVoice(personality).openerClose}`;
}

/** Share With Coach from a Shooting Report (BRD v1.1 §6/§8) - attaches the real session as context. */
export async function startConversationFromShotSession(
  userId: ObjectId,
  personality: CoachPersonality,
  session: ShotSessionDoc,
): Promise<ObjectId> {
  // Resumes the existing conversation about this session rather than opening
  // another one, exactly as the feed path does (audit Bug Feed-3 / FEED-06).
  // Sharing the same report twice used to leave two identically-titled
  // conversations in the Coach list with no way to tell them apart.
  const existing = await findConversationByContextRef(
    userId,
    "shot_session",
    session._id,
  );
  if (existing) {
    return existing._id;
  }

  const zoneNote = session.weakestZone
    ? ` - ${ZONE_LABELS[session.weakestZone]} needs work`
    : "";
  const title = `Shooting session: ${session.totalMakes}/${session.totalAttempts} (${session.fgPercent}%)${zoneNote}`;

  const conversation = await createConversationRepo({
    userId,
    personality,
    title,
    lastMessageAt: new Date(),
    contextRefs: [{ type: "shot_session", refId: session._id }],
    createdAt: new Date(),
  });

  // BRD 7.8: "Every Share With Coach action results in Coach referencing the
  // specific session, not a generic greeting." Without this the chat opens
  // empty and stays silent until the player types, which reads as a generic
  // greeting even though the real session is attached to the prompt.
  //
  // Deliberately composed from the session's own stored numbers rather than
  // the LLM, so it is factual, instant, and works with no API key.
  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: openingLineForShotSession(session, personality),
    createdAt: new Date(),
  });

  return conversation._id;
}

/**
 * Factual, non-generated opener naming this session's real numbers.
 *
 * The personality shapes only the lead and the closing invitation (BRD 7.9:
 * the setting has to change what Coach says, and this is the first thing it
 * ever says). Every number below is identical whichever setting is active - a
 * blunt Coach and a warm Coach must never disagree about what happened.
 */
function openingLineForShotSession(
  session: ShotSessionDoc,
  personality: CoachPersonality,
): string {
  const voice = coachVoice(personality);
  const parts = [
    leadWith(
      voice.openerLead,
      `I've got your shooting session: ${session.totalMakes} of ${session.totalAttempts} (${session.fgPercent}%).`,
    ),
  ];

  if (session.bestZone) {
    const stats = session.zoneBreakdown[session.bestZone];
    parts.push(
      stats
        ? `Your best zone was ${ZONE_LABELS[session.bestZone]} at ${fgPercent(stats.makes, stats.attempts)}%.`
        : `Your best zone was ${ZONE_LABELS[session.bestZone]}.`,
    );
  }
  if (session.weakestZone) {
    const stats = session.zoneBreakdown[session.weakestZone];
    parts.push(
      stats
        ? `${ZONE_LABELS[session.weakestZone]} is where you struggled most, at ${fgPercent(stats.makes, stats.attempts)}%.`
        : `${ZONE_LABELS[session.weakestZone]} is where you struggled most.`,
    );
  }

  parts.push(voice.openerClose);
  return parts.join(" ");
}

/**
 * Share With Coach from a Game Film report (BRD 7.8, BRD v1.1 §4: Coach is
 * reached after Analyze, never the other way round).
 *
 * The opener is composed here rather than by the LLM, exactly as the shooting
 * one is - so it is instant, works with no API key, and cannot overstate what
 * the review is. It names the review as heuristic up front, because that is
 * the single most important thing for the player to understand before they
 * start discussing it.
 */
export async function startConversationFromGameFilm(
  userId: ObjectId,
  personality: CoachPersonality,
  analysis: GameFootageAnalysisDoc,
): Promise<ObjectId> {
  // Resumes rather than duplicating, for the same reason the shooting path does.
  const existing = await findConversationByContextRef(
    userId,
    "game_footage_analysis",
    analysis._id,
  );
  if (existing) {
    return existing._id;
  }

  const focus = analysis.weaknesses[0];
  const title = focus
    ? `Game film: ${GAME_CATEGORY_LABELS[focus.category as GameAnalysisCategory] ?? "review"}`
    : "Game film review";

  const conversation = await createConversationRepo({
    userId,
    personality,
    title,
    lastMessageAt: new Date(),
    contextRefs: [{ type: "game_footage_analysis", refId: analysis._id }],
    createdAt: new Date(),
  });

  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: openingLineForGameFilm(analysis, personality),
    createdAt: new Date(),
  });

  return conversation._id;
}

function openingLineForGameFilm(
  analysis: GameFootageAnalysisDoc,
  personality: CoachPersonality,
): string {
  // The provenance sentence is deliberately *not* personality-shaped. It is the
  // honesty disclosure, it is shared with the report screen and the upload form
  // via `game-film-provenance`, and it has to read identically everywhere.
  const parts = [
    provenanceOpeningLine(resolveAnalysisProvenance(analysis)),
  ];

  const focus = analysis.weaknesses[0];
  if (focus) {
    const label =
      GAME_CATEGORY_LABELS[focus.category as GameAnalysisCategory] ??
      "one area";
    parts.push(`The main thing it flagged was ${label.toLowerCase()}.`);
  }
  if (analysis.recommendedWorkoutIds.length > 0) {
    parts.push(
      `I've also got ${analysis.recommendedWorkoutIds.length} workout(s) already built for it in Train.`,
    );
  }

  parts.push(coachVoice(personality).openerClose);
  return parts.join(" ");
}

/**
 * "Ask Coach" from a single shot inside the replay dialog (BRD 7.5). Reuses
 * the same shot_session context ref - the whole session is the useful
 * context - but opens on the one shot the player actually tapped.
 *
 * Deliberately does NOT resume by context ref, unlike its two siblings above.
 * The ref it stores is session-level while the conversation is about one shot,
 * so a lookup here would happily return the conversation about a *different*
 * shot - or the whole-session Share With Coach thread - and open it under the
 * wrong opener. The asymmetry is the point: two shots in one session are two
 * questions, whereas sharing one report twice is one.
 */
export async function startConversationFromShot(
  userId: ObjectId,
  personality: CoachPersonality,
  session: ShotSessionDoc,
  shotId: string,
): Promise<ObjectId> {
  const shot = session.shots.find((s) => s.id === shotId);
  if (!shot) {
    throw new NotFoundError("Shot not found in this session.");
  }

  const zoneLabel = ZONE_LABELS[shot.zone];
  const outcome = shot.made ? "make" : "miss";

  const conversation = await createConversationRepo({
    userId,
    personality,
    title: `${zoneLabel} ${outcome} - shot review`,
    lastMessageAt: new Date(),
    // Carrying the shot id, not just the session, is what keeps this
    // conversation about *this shot* past its opening line - every later
    // message reloads context from the ref (BRD 7.5 "Ask Coach about that
    // shot").
    contextRefs: [{ type: "shot_session", refId: session._id, shotId }],
    createdAt: new Date(),
  });

  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: leadWith(
      coachVoice(personality).openerLead,
      `You tapped a ${zoneLabel} ${outcome} from your ${session.totalMakes}/${session.totalAttempts} ` +
        `(${session.fgPercent}%) session. Ask me anything about it - what went wrong, how to fix it, ` +
        `or what to drill next.`,
    ),
    createdAt: new Date(),
  });

  return conversation._id;
}

/**
 * "Ask Coach" from an NBA player profile (BRD 7.9: "discuss player-study
 * content" - the one Coach functional requirement that had no implementation
 * at all).
 *
 * Resumes rather than duplicating: a player studied repeatedly is one ongoing
 * conversation, not a new thread per visit.
 *
 * The opener names only what is safe to name. Where the profile is backed by an
 * archetype pack rather than hand-authored content, the line says so plainly
 * and frames the subject as a role - it must never read as film study of a
 * named professional (CLAUDE.md: "archetype content describes a role, never the
 * individual"). The same distinction is restated at the model in the context
 * block; this one is for the player.
 */
export async function startConversationFromNbaPlayer(
  userId: ObjectId,
  personality: CoachPersonality,
  player: NbaPlayerDoc,
  editorial: { provenance: "authored" | "archetype"; archetypeLabel?: string },
): Promise<ObjectId> {
  const existing = await findConversationByContextRef(
    userId,
    "nba_player",
    player._id,
  );
  if (existing) {
    return existing._id;
  }

  const conversation = await createConversationRepo({
    userId,
    personality,
    title: `Studying ${player.name}`,
    lastMessageAt: new Date(),
    contextRefs: [{ type: "nba_player", refId: player._id }],
    createdAt: new Date(),
  });

  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: openingLineForNbaPlayer(player, editorial, personality),
    createdAt: new Date(),
  });

  return conversation._id;
}

function openingLineForNbaPlayer(
  player: NbaPlayerDoc,
  editorial: { provenance: "authored" | "archetype"; archetypeLabel?: string },
  personality: CoachPersonality,
): string {
  const voice = coachVoice(personality);
  const parts: string[] = [];

  if (editorial.provenance === "archetype") {
    const role = editorial.archetypeLabel ?? "their role";
    parts.push(
      leadWith(
        voice.openerLead,
        `You're studying ${player.name}. Worth being straight with you: what we show on that profile is our coaching material for the ${role} role that ${player.name} fits, not film study of ${player.name} personally - so I can talk about how that type of player operates and how to train it, but I won't invent specifics about his career.`,
      ),
    );
  } else {
    parts.push(
      leadWith(voice.openerLead, `You're studying ${player.name}.`),
    );
  }

  parts.push(voice.openerClose);
  return parts.join(" ");
}

/**
 * "Ask Coach" from a workout (BRD 7.9: "discuss and adjust workouts").
 *
 * The `workout` context ref type and its formatter both already existed, but
 * nothing in the app ever created one - the type was dead and the requirement
 * unreachable. This is the entry point that makes it real.
 */
export async function startConversationFromWorkout(
  userId: ObjectId,
  personality: CoachPersonality,
  workout: WorkoutDoc,
): Promise<ObjectId> {
  const existing = await findConversationByContextRef(
    userId,
    "workout",
    workout._id,
  );
  if (existing) {
    return existing._id;
  }

  const conversation = await createConversationRepo({
    userId,
    personality,
    title: `Workout: ${workout.source.label}`,
    lastMessageAt: new Date(),
    contextRefs: [{ type: "workout", refId: workout._id }],
    createdAt: new Date(),
  });

  const voice = coachVoice(personality);
  const drillCount = workout.drills.length;
  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content: [
      leadWith(
        voice.openerLead,
        `I've got your "${workout.source.label}" workout - ${drillCount} drill(s), ${workout.difficulty}, currently ${workout.status}.`,
      ),
      "We can swap a drill, change the load, or talk through what any of them is for.",
      voice.openerClose,
    ].join(" "),
    createdAt: new Date(),
  });

  return conversation._id;
}

/**
 * "Talk to Coach" from a Confidence check-in (BRD 7.9 "provide
 * confidence/mental-game support (see 7.10)").
 *
 * The Confidence flow and Coach were built without any link between them, so a
 * player could say they were nervous, get a routine, open Coach, and be met by
 * something with no idea any of that had happened. This carries the thread
 * across.
 *
 * Nothing here is generated - the feeling is what the player selected and the
 * recovery plan is computed from their own records - so the opener states it
 * directly, and BRD 7.10's "avoid generic motivational quotes" is enforced in
 * the context block rather than by hoping.
 */
export async function startConversationFromConfidenceCheckin(
  userId: ObjectId,
  personality: CoachPersonality,
  checkin: ConfidenceCheckinDoc,
): Promise<ObjectId> {
  const existing = await findConversationByContextRef(
    userId,
    "confidence_checkin",
    checkin._id,
  );
  if (existing) {
    return existing._id;
  }

  const isPreGame = checkin.type === "pre_game";
  const feeling = checkin.feeling ? FEELING_LABELS[checkin.feeling] : undefined;

  const conversation = await createConversationRepo({
    userId,
    personality,
    title: isPreGame
      ? `Before the game${feeling ? `: ${feeling}` : ""}`
      : "After the game",
    lastMessageAt: new Date(),
    contextRefs: [{ type: "confidence_checkin", refId: checkin._id }],
    createdAt: new Date(),
  });

  const voice = coachVoice(personality);

  // BRD 7.10's success criterion is that the post-game flow "references real
  // data from that game or session". Saying the plan was "built from your own
  // numbers" without naming any of them doesn't meet that - so the post-game
  // opener is composed from the stored plan and the session it cited, in
  // code, which also means it reads the same with no API key configured.
  let content: string;
  if (!isPreGame && checkin.recoveryPlan) {
    const session = checkin.relatedSessionId
      ? await findSessionByIdForUser(userId, checkin.relatedSessionId)
      : null;

    content = leadWith(
      voice.openerLead,
      recoveryPlanOpeningLine(
        checkin.recoveryPlan,
        session
          ? {
              id: session._id.toString(),
              recordedAt: session.recordedAt,
              totalAttempts: session.totalAttempts,
              totalMakes: session.totalMakes,
              fgPercent: session.fgPercent,
              bestZone: session.bestZone,
              weakestZone: session.weakestZone,
              zoneBreakdown: session.zoneBreakdown,
            }
          : undefined,
        voice.openerClose,
      ),
    );
  } else {
    const opening = isPreGame
      ? feeling
        ? `You said you're feeling "${feeling}" going into this one, and you've got the routine for it.`
        : "You've just checked in before a game."
      : "I've got your post-game check-in.";
    content = [leadWith(voice.openerLead, opening), voice.openerClose].join(" ");
  }

  await createMessage({
    conversationId: conversation._id,
    userId,
    role: "assistant",
    content,
    createdAt: new Date(),
  });

  return conversation._id;
}

/** A fresh, context-free conversation started directly from the Coach tab. */
export async function createConversation(
  userId: ObjectId,
  personality: CoachPersonality,
): Promise<CoachConversationDoc> {
  return createConversationRepo({
    userId,
    personality,
    lastMessageAt: new Date(),
    contextRefs: [],
    createdAt: new Date(),
  });
}

export async function countConversationsForUser(userId: ObjectId): Promise<number> {
  return countConversationsRepo(userId);
}

export async function listConversationsForUser(
  userId: ObjectId,
): Promise<CoachConversationDoc[]> {
  return listConversationsRepo(userId);
}

export async function getConversationForUser(
  userId: ObjectId,
  conversationId: ObjectId,
): Promise<CoachConversationDoc | null> {
  return findConversationByIdForUser(userId, conversationId);
}

/**
 * How many of a conversation's context refs still resolve to a real document.
 *
 * The "Real session context attached" badge used to be driven by
 * `contextRefs.length`, which is a claim about what was attached rather than
 * about what Coach can actually see: `loadContextBlocks` silently drops refs
 * whose document has since been deleted, so a badge counting refs could assert
 * context that no longer reaches the prompt. Same honesty bar the project
 * applies to simulated analysis - don't state more than is true.
 */
export async function countResolvedContext(
  userId: ObjectId,
  conversation: CoachConversationDoc,
): Promise<number> {
  if (conversation.contextRefs.length === 0) return 0;
  const blocks = await loadContextBlocks(userId, conversation.contextRefs);
  return blocks.length;
}

export async function listMessages(
  userId: ObjectId,
  conversationId: ObjectId,
): Promise<CoachMessageDoc[]> {
  const conversation = await findConversationByIdForUser(userId, conversationId);
  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }
  return listMessagesForConversationRepo(conversationId, 50);
}

export async function changePersonality(
  userId: ObjectId,
  conversationId: ObjectId,
  personality: CoachPersonality,
): Promise<CoachConversationDoc> {
  const conversation = await findConversationByIdForUser(userId, conversationId);
  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }
  const updated = await updateConversationPersonalityRepo(
    userId,
    conversationId,
    personality,
  );
  if (!updated) {
    throw new NotFoundError("Conversation not found.");
  }
  return updated;
}

export interface SendMessageResult {
  userMessage: CoachMessageDoc;
  assistantMessage: CoachMessageDoc | null;
  assistantError?: string;
}

/**
 * Real, already-computed statements for the keyless fallback reply.
 *
 * Drawn only from documents `sendMessage` has already loaded, so this adds no
 * queries, and every entry is a stored number rather than anything derived for
 * the occasion.
 */
function fallbackFactsFor(stats: UserStatsDoc | null, goals: GoalDoc[]): string[] {
  const facts: string[] = [];

  if (stats && stats.totalWorkoutsCompleted > 0) {
    facts.push(`${stats.totalWorkoutsCompleted} workout(s) completed`);
  }
  if (stats && stats.currentStreak > 0) {
    facts.push(
      `current streak ${stats.currentStreak} day(s) - your longest is ${stats.longestStreak}`,
    );
  }
  for (const goal of goals) {
    facts.push(`Goal "${goal.title}": ${goal.currentValue}/${goal.targetValue} ${goal.unit}`);
  }

  return facts;
}

/** The most useful concrete thing to do next, from real records only. */
function fallbackNextStepFor(goals: GoalDoc[]): string | undefined {
  const open = goals.find((g) => g.currentValue < g.targetValue);
  if (open) {
    const remaining = open.targetValue - open.currentValue;
    return `you're ${remaining} ${open.unit} from "${open.title}" - Train has a session ready for it.`;
  }
  return "open Train and run today's session; Analyze can log a shooting session if you'd rather work on your shot.";
}

/**
 * Persists the player's message unconditionally, then replies.
 *
 * Two things are load-bearing here. The player's message is written before any
 * reply is attempted, so a failure can never lose what they typed. And the
 * reply itself goes through `respondWithBestProvider`, which degrades to a
 * composed reply rather than failing - so the assistant's answer is a real,
 * persisted message that survives a reload, whether or not a model is
 * configured. `source` records which path produced it.
 *
 * `assistantError` is now reserved for a genuine failure to persist anything
 * at all (a database error), not for a missing API key.
 */
export async function sendMessage(
  userId: ObjectId,
  conversationId: ObjectId,
  content: string,
): Promise<SendMessageResult> {
  const conversation = await findConversationByIdForUser(userId, conversationId);
  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }

  checkRateLimit(`coach-message:${userId.toString()}`, MAX_MESSAGES_PER_WINDOW, RATE_LIMIT_WINDOW_MS);

  const userMessage = await createMessage({
    conversationId,
    userId,
    role: "user",
    content,
    createdAt: new Date(),
  });
  await touchConversationLastMessageAt(userId, conversationId);

  let assistantMessage: CoachMessageDoc | null = null;
  let assistantError: string | undefined;

  try {
    const [profile, stats, goals, history, contextBlocks, preGameCheckin] =
      await Promise.all([
        getProfileByUserId(userId),
        getStatsForUser(userId),
        listActiveGoalsForUser(userId),
        listMessagesForConversationRepo(conversationId, 20),
        loadContextBlocks(userId, conversation.contextRefs),
        // An indexed findOne alongside five reads already in flight, so
        // effectively free - and it stops Coach being the only part of the
        // app that doesn't know the player said they were nervous today
        // (BRD 7.9 "provide confidence/mental-game support (see 7.10)").
        getLatestPreGameCheckin(userId),
      ]);

    const systemPrompt = buildCoachSystemPrompt({
      personality: conversation.personality,
      profile,
      stats,
      goals,
      contextBlocks,
      recentFeeling: preGameCheckin?.feeling
        ? { feeling: preGameCheckin.feeling, at: preGameCheckin.createdAt }
        : null,
    });

    const reply = await respondWithBestProvider({
      personality: conversation.personality,
      systemPrompt,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      fallbackFacts: fallbackFactsFor(stats, goals),
      fallbackNextStep: fallbackNextStepFor(goals),
      conversationId: conversationId.toString(),
    });

    assistantMessage = await createMessage({
      conversationId,
      userId,
      role: "assistant",
      content: reply.content,
      source: reply.source,
      createdAt: new Date(),
    });
    await touchConversationLastMessageAt(userId, conversationId);
  } catch (err) {
    // Reaching here means the fallback itself failed, which is a real bug
    // rather than a missing credential - the provider swallows model failures.
    // Logged because an unlogged catch here is what made a bad key, an outage
    // and an exhausted quota indistinguishable for the whole of P0.
    logger.error(
      { conversationId: conversationId.toString(), err },
      "Coach could not produce or persist a reply",
    );
    assistantError =
      err instanceof AppError ? err.message : "Coach couldn't respond right now - try again.";
  }

  return { userMessage, assistantMessage, assistantError };
}
