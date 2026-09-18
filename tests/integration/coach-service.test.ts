import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

vi.mock("@/server/external/openaiClient", () => ({
  isOpenAiConfigured: vi.fn(() => true),
  createChatCompletion: vi.fn(),
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The one shot used by the per-shot "Ask Coach" test; `shots` is otherwise empty. */
const SEEDED_SHOT = {
  id: "shot-1",
  zone: "paint",
  location: { xPct: 50, yPct: 80 },
  made: true,
  timestampInVideoSeconds: 12,
  feedbackText: "Good finish.",
};

async function seedShotSession(userId: ObjectId, withShot = false) {
  const { shotSessionsCollection } = await import("@/server/db/collections");
  const collection = await shotSessionsCollection();
  const _id = new ObjectId();
  await collection.insertOne({
    _id,
    userId,
    videoAssetId: new ObjectId(),
    recordedAt: new Date("2026-09-01"),
    status: "completed",
    shots: withShot ? [SEEDED_SHOT] : [],
    totalAttempts: 5,
    totalMakes: 4,
    fgPercent: 80,
    zoneBreakdown: { paint: { attempts: 5, makes: 4 } },
    bestZone: "paint",
    trendCallouts: [],
    createdAt: new Date(),
  } as never);
  return _id;
}

describe("coachService: conversations", () => {
  it("creates a context-free conversation with the given personality", async () => {
    const { createConversation } = await import("@/server/services/coachService");
    const userId = new ObjectId();

    const conversation = await createConversation(userId, "direct");
    expect(conversation.personality).toBe("direct");
    expect(conversation.contextRefs).toEqual([]);
  });

  it("changePersonality persists the new personality for the owner", async () => {
    const { createConversation, changePersonality, getConversationForUser } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "balanced");

    await changePersonality(userId, conversation._id, "elite_trainer");

    const reloaded = await getConversationForUser(userId, conversation._id);
    expect(reloaded?.personality).toBe("elite_trainer");
  });

  it("rejects changePersonality for a conversation belonging to another user", async () => {
    const { createConversation, changePersonality } = await import(
      "@/server/services/coachService"
    );
    const owner = new ObjectId();
    const otherUser = new ObjectId();
    const conversation = await createConversation(owner, "balanced");

    await expect(
      changePersonality(otherUser, conversation._id, "direct"),
    ).rejects.toThrow();
  });
});

describe("coachService.sendMessage", () => {
  it("persists the user message and the assistant's reply", async () => {
    const { createChatCompletion } = await import("@/server/external/openaiClient");
    vi.mocked(createChatCompletion).mockResolvedValueOnce("Keep your elbow in.");

    const { createConversation, sendMessage, listMessages } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "balanced");

    const result = await sendMessage(userId, conversation._id, "How's my form?");

    expect(result.userMessage.content).toBe("How's my form?");
    expect(result.userMessage.role).toBe("user");
    expect(result.assistantMessage?.content).toBe("Keep your elbow in.");
    expect(result.assistantMessage?.role).toBe("assistant");
    expect(result.assistantError).toBeUndefined();

    const history = await listMessages(userId, conversation._id);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });

  it("sends the real shot-session numbers to the LLM when the conversation has that context", async () => {
    const { createChatCompletion } = await import("@/server/external/openaiClient");
    vi.mocked(createChatCompletion).mockResolvedValueOnce("Nice work in the paint.");

    const { startConversationFromShotSession, sendMessage } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const sessionId = await seedShotSession(userId);
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const session = await findSessionByIdForUser(userId, sessionId);

    const conversationId = await startConversationFromShotSession(userId, "balanced", session!);
    await sendMessage(userId, conversationId, "How did I do?");

    const callArgs = vi.mocked(createChatCompletion).mock.calls[0][0];
    const systemMessage = callArgs.find((m) => m.role === "system");
    expect(systemMessage?.content).toContain("4/5");
    expect(systemMessage?.content).toContain("80%");
  });

  // BRD v1.0 §7.8: "Every Share With Coach action results in Coach referencing
  // the specific session, not a generic greeting." The prompt test above only
  // proves the LLM *could* - this proves what the player actually sees on
  // arrival, before they have typed anything and with no API key in play.
  it("opens with a message naming this session's real numbers, not a generic greeting", async () => {
    const { startConversationFromShotSession, listMessages } = await import(
      "@/server/services/coachService"
    );
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const userId = new ObjectId();
    const session = await findSessionByIdForUser(
      userId,
      await seedShotSession(userId),
    );

    const conversationId = await startConversationFromShotSession(
      userId,
      "balanced",
      session!,
    );

    const messages = await listMessages(userId, conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    // The real numbers, and the real best zone - not "How can I help?"
    expect(messages[0].content).toContain("4 of 5");
    expect(messages[0].content).toContain("80%");
    expect(messages[0].content).toMatch(/paint/i);

    const { createChatCompletion } = await import("@/server/external/openaiClient");
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  // BRD 7.9: "changing the personality setting must actually change Coach's
  // responses, not just relabel them". The opener is the first thing Coach ever
  // says, and it used to be byte-identical across all four settings.
  it("shapes the opener by personality while keeping every number identical", async () => {
    const { startConversationFromShotSession, listMessages } = await import(
      "@/server/services/coachService"
    );
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );

    const openers = await Promise.all(
      (["encouraging", "direct", "elite_trainer"] as const).map(async (personality) => {
        const userId = new ObjectId();
        const session = await findSessionByIdForUser(
          userId,
          await seedShotSession(userId),
        );
        const conversationId = await startConversationFromShotSession(
          userId,
          personality,
          session!,
        );
        return (await listMessages(userId, conversationId))[0].content;
      }),
    );

    expect(new Set(openers).size).toBe(openers.length);
    // ...and the facts never move with the tone.
    for (const opener of openers) {
      expect(opener).toContain("4 of 5");
      expect(opener).toContain("80%");
    }
  });

  it("resumes the same conversation when the same session is shared twice", async () => {
    const { startConversationFromShotSession, countConversationsForUser, listMessages } =
      await import("@/server/services/coachService");
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const userId = new ObjectId();
    const session = await findSessionByIdForUser(
      userId,
      await seedShotSession(userId),
    );

    const first = await startConversationFromShotSession(userId, "balanced", session!);
    const second = await startConversationFromShotSession(userId, "balanced", session!);

    expect(second.toString()).toBe(first.toString());
    expect(await countConversationsForUser(userId)).toBe(1);
    // Resuming must not staple a second opener onto the thread.
    expect(await listMessages(userId, first)).toHaveLength(1);
  });

  // The deliberate asymmetry: the per-shot ref is session-level, so resuming by
  // it would open the wrong conversation. Two shots are two questions.
  it("gives a per-shot Ask Coach its own conversation, not the shared session's", async () => {
    const { startConversationFromShotSession, startConversationFromShot, countConversationsForUser } =
      await import("@/server/services/coachService");
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const userId = new ObjectId();
    const session = await findSessionByIdForUser(
      userId,
      await seedShotSession(userId, true),
    );

    const shared = await startConversationFromShotSession(userId, "balanced", session!);
    const perShot = await startConversationFromShot(
      userId,
      "balanced",
      session!,
      SEEDED_SHOT.id,
    );

    expect(perShot.toString()).not.toBe(shared.toString());
    expect(await countConversationsForUser(userId)).toBe(2);
  });

  /**
   * The opener names the shot, but openers are written once. Everything after
   * it is rebuilt from `contextRefs` on each message, so if the ref doesn't
   * carry the shot id the conversation silently reverts to session-level
   * context from the second message onward - which is the failure BRD 7.5's
   * "Ask Coach about that shot" cares about.
   */
  it("carries the shot id on the conversation's context ref, not just in the opener", async () => {
    const { startConversationFromShot } = await import(
      "@/server/services/coachService"
    );
    const { findConversationByIdForUser } = await import(
      "@/server/repositories/coachRepository"
    );
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const userId = new ObjectId();
    const session = await findSessionByIdForUser(
      userId,
      await seedShotSession(userId, true),
    );

    const conversationId = await startConversationFromShot(
      userId,
      "balanced",
      session!,
      SEEDED_SHOT.id,
    );

    const conversation = await findConversationByIdForUser(userId, conversationId);
    const ref = conversation?.contextRefs[0];
    expect(ref?.type).toBe("shot_session");
    expect(ref?.refId.equals(session!._id)).toBe(true);
    expect(ref?.shotId).toBe(SEEDED_SHOT.id);
  });

  it("leaves the shared-session conversation shot-agnostic", async () => {
    const { startConversationFromShotSession } = await import(
      "@/server/services/coachService"
    );
    const { findConversationByIdForUser } = await import(
      "@/server/repositories/coachRepository"
    );
    const { findSessionByIdForUser } = await import(
      "@/server/repositories/shotSessionRepository"
    );
    const userId = new ObjectId();
    const session = await findSessionByIdForUser(
      userId,
      await seedShotSession(userId, true),
    );

    const conversationId = await startConversationFromShotSession(
      userId,
      "balanced",
      session!,
    );

    // Share With Coach is about the whole report; pinning it to one shot
    // would narrow every later answer to that shot.
    const conversation = await findConversationByIdForUser(userId, conversationId);
    expect(conversation?.contextRefs[0].shotId).toBeUndefined();
  });

  it("falls back to a composed reply - persisted, and labeled - when the LLM call fails", async () => {
    const { createChatCompletion } = await import("@/server/external/openaiClient");
    vi.mocked(createChatCompletion).mockRejectedValueOnce(new Error("boom"));

    const { createConversation, sendMessage, listMessages } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "balanced");

    const result = await sendMessage(userId, conversation._id, "Still there?");

    expect(result.userMessage.content).toBe("Still there?");
    // The old contract was `assistantMessage: null` + an error string held in
    // component state, which meant the player's message sat unanswered and the
    // explanation vanished on reload (audit Bug Coach-3).
    expect(result.assistantError).toBeUndefined();
    expect(result.assistantMessage).not.toBeNull();
    expect(result.assistantMessage?.source).toBe("fallback");

    // Both messages survive a reload, which is the whole point of persisting
    // the fallback rather than returning it as transient UI state.
    const history = await listMessages(userId, conversation._id);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[1].source).toBe("fallback");
  });

  it("never calls the model when no API key is configured, and still replies", async () => {
    const { isOpenAiConfigured, createChatCompletion } = await import(
      "@/server/external/openaiClient"
    );
    vi.mocked(isOpenAiConfigured).mockReturnValue(false);

    const { createConversation, sendMessage } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "direct");

    const result = await sendMessage(userId, conversation._id, "What next?");

    expect(createChatCompletion).not.toHaveBeenCalled();
    expect(result.assistantMessage?.source).toBe("fallback");
    // Says plainly that it isn't a generated answer - the honesty bar that
    // makes a composed reply acceptable in the first place.
    expect(result.assistantMessage?.content).toMatch(/isn't connected|offline/i);

    vi.mocked(isOpenAiConfigured).mockReturnValue(true);
  });

  it("marks a real model reply as such, not as a fallback", async () => {
    const { createChatCompletion } = await import("@/server/external/openaiClient");
    vi.mocked(createChatCompletion).mockResolvedValueOnce("Work the left corner.");

    const { createConversation, sendMessage } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "balanced");

    const result = await sendMessage(userId, conversation._id, "What next?");

    expect(result.assistantMessage?.content).toBe("Work the left corner.");
    expect(result.assistantMessage?.source).toBe("ai");
  });

  it("rejects sending a message to a conversation belonging to another user", async () => {
    const { createConversation, sendMessage } = await import("@/server/services/coachService");
    const owner = new ObjectId();
    const otherUser = new ObjectId();
    const conversation = await createConversation(owner, "balanced");

    await expect(sendMessage(otherUser, conversation._id, "hi")).rejects.toThrow();
  });

  it("rate-limits a user who sends too many messages too quickly", async () => {
    const { createChatCompletion } = await import("@/server/external/openaiClient");
    vi.mocked(createChatCompletion).mockResolvedValue("ok");

    const { createConversation, sendMessage } = await import("@/server/services/coachService");
    const userId = new ObjectId();
    const conversation = await createConversation(userId, "balanced");

    for (let i = 0; i < 20; i++) {
      await sendMessage(userId, conversation._id, `message ${i}`);
    }

    await expect(sendMessage(userId, conversation._id, "one too many")).rejects.toThrow();
  });
});

/**
 * The three BRD 7.9 functional requirements that had no implementation at all:
 * discussing player-study content, discussing/adjusting workouts, and
 * mental-game support carried over from the Confidence flow (7.10).
 */
describe("coachService: the BRD 7.9 entry points", () => {
  async function seedPlayer(name: string) {
    const { nbaPlayersCollection } = await import("@/server/db/collections");
    const collection = await nbaPlayersCollection();
    const _id = new ObjectId();
    await collection.insertOne({
      _id,
      name,
      team: "Test Team",
      position: "G",
      heightInches: 75,
      syncStatus: "synced",
      editorial: {
        learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
        skills: {
          shooting: 0,
          finishing: 0,
          ballHandling: 0,
          playmaking: 0,
          defense: 0,
          athleticism: 0,
        },
        strengths: [],
        weaknesses: [],
        bio: { careerInfo: "" },
        signatureMoves: [],
      },
      createdAt: new Date(),
    } as never);
    return _id;
  }

  async function seedWorkout(userId: ObjectId) {
    const { workoutsCollection } = await import("@/server/db/collections");
    const collection = await workoutsCollection();
    const _id = new ObjectId();
    await collection.insertOne({
      _id,
      userId,
      source: { type: "generated", label: "Left corner fix" },
      status: "pending",
      difficulty: "intermediate",
      estimatedDurationMinutes: 30,
      drills: [
        { drillId: new ObjectId(), order: 0, name: "Corner threes", completed: false },
      ],
      createdAt: new Date(),
    } as never);
    return _id;
  }

  // The feed opener is personality-shaped now, but "You're asking about" is
  // load-bearing copy: home-feed.spec.ts asserts on it as the proof that Ask
  // Coach never opens a silent empty chat (audit Bug Feed-3).
  it("keeps the feed opener's anchor phrase under every personality", async () => {
    const { feedItemsCollection } = await import("@/server/db/collections");
    const { startConversationFromFeedItem, listMessages } = await import(
      "@/server/services/coachService"
    );

    for (const personality of ["encouraging", "balanced", "direct", "elite_trainer"] as const) {
      const userId = new ObjectId();
      const _id = new ObjectId();
      await (await feedItemsCollection()).insertOne({
        _id,
        type: "tip",
        title: "Load your wrist early",
        body: "Get the ball into the pocket before your legs extend.",
        tags: ["shooting"],
        createdAt: new Date(),
      } as never);

      const conversationId = await startConversationFromFeedItem(
        userId,
        personality,
        _id,
      );
      const [opener] = await listMessages(userId, conversationId);
      expect(opener.content).toContain("You're asking about");
      expect(opener.content).toContain("Load your wrist early");
    }
  });

  it("opens a player-study conversation that frames archetype content as a role", async () => {
    const { startConversationFromNbaPlayer, listMessages } = await import(
      "@/server/services/coachService"
    );
    const { findPlayerById } = await import("@/server/repositories/nbaPlayerRepository");
    const userId = new ObjectId();
    const player = await findPlayerById(await seedPlayer("Test Guard"));

    const conversationId = await startConversationFromNbaPlayer(
      userId,
      "balanced",
      player!,
      { provenance: "archetype", archetypeLabel: "Shot Creator" },
    );

    const [opener] = await listMessages(userId, conversationId);
    expect(opener.content).toContain("Test Guard");
    // The honesty rule, stated to the player before they ask anything:
    // archetype content describes a role, never the individual.
    expect(opener.content).toMatch(/not film study of Test Guard/i);
    expect(opener.content).toMatch(/Shot Creator/);
  });

  it("does not disclaim a fully hand-authored player profile", async () => {
    const { startConversationFromNbaPlayer, listMessages } = await import(
      "@/server/services/coachService"
    );
    const { findPlayerById } = await import("@/server/repositories/nbaPlayerRepository");
    const userId = new ObjectId();
    const player = await findPlayerById(await seedPlayer("Authored Star"));

    const conversationId = await startConversationFromNbaPlayer(
      userId,
      "balanced",
      player!,
      { provenance: "authored" },
    );

    const [opener] = await listMessages(userId, conversationId);
    expect(opener.content).toContain("Authored Star");
    expect(opener.content).not.toMatch(/not film study/i);
  });

  it("opens a workout conversation naming the real drills, and resumes it", async () => {
    const { startConversationFromWorkout, listMessages, countConversationsForUser } =
      await import("@/server/services/coachService");
    const { findWorkoutByIdForUser } = await import(
      "@/server/repositories/workoutRepository"
    );
    const userId = new ObjectId();
    const workout = await findWorkoutByIdForUser(userId, await seedWorkout(userId));

    const first = await startConversationFromWorkout(userId, "balanced", workout!);
    const second = await startConversationFromWorkout(userId, "balanced", workout!);

    expect(second.toString()).toBe(first.toString());
    expect(await countConversationsForUser(userId)).toBe(1);

    const [opener] = await listMessages(userId, first);
    expect(opener.content).toContain("Left corner fix");
    expect(opener.content).toMatch(/1 drill/);
  });

  it("carries a pre-game check-in's feeling into Coach", async () => {
    const { recordPreGameCheckin } = await import("@/server/services/confidenceService");
    const { startConversationFromConfidenceCheckin, listMessages } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    const checkin = await recordPreGameCheckin(userId, "nervous");

    const conversationId = await startConversationFromConfidenceCheckin(
      userId,
      "balanced",
      checkin,
    );

    const [opener] = await listMessages(userId, conversationId);
    expect(opener.content).toMatch(/nervous/i);
  });

  /**
   * BRD 7.10's success criterion: "a post-poor-game flow references real data
   * from that game or session". The opener used to say the plan was "built
   * from your own numbers" without naming any of them, which asserts the
   * criterion rather than meeting it.
   */
  it("opens a recovery plan by citing the real session's numbers", async () => {
    const { isOpenAiConfigured } = await import("@/server/external/openaiClient");
    // The proof that matters: this is composed in code, so it reads the same
    // with no key configured - which is the state this app runs in today.
    vi.mocked(isOpenAiConfigured).mockReturnValue(false);

    const { createRecoveryCheckin } = await import(
      "@/server/services/confidenceService"
    );
    const { startConversationFromConfidenceCheckin, listMessages } = await import(
      "@/server/services/coachService"
    );
    const userId = new ObjectId();
    await seedShotSession(userId);

    const { checkin } = await createRecoveryCheckin(userId);
    const conversationId = await startConversationFromConfidenceCheckin(
      userId,
      "balanced",
      checkin,
    );

    const [opener] = await listMessages(userId, conversationId);
    // The session's own figures, not a paraphrase of them.
    expect(opener.content).toContain("4 of 5");
    expect(opener.content).toContain("80%");
    // And the plan's first step verbatim, so the two can never drift.
    expect(opener.content).toContain(checkin.recoveryPlan!.planSteps[0]);
  });

  it("gives Coach the check-in's real routine as context", async () => {
    const { recordPreGameCheckin } = await import("@/server/services/confidenceService");
    const { loadContextBlocks } = await import("@/server/services/coachContextService");
    const userId = new ObjectId();
    const checkin = await recordPreGameCheckin(userId, "overthinking");

    const [block] = await loadContextBlocks(userId, [
      { type: "confidence_checkin", refId: checkin._id },
    ]);

    expect(block).toMatch(/overthinking/i);
    // BRD 7.10 rules out generic motivational filler, so the instruction rides
    // along with the data rather than being left to chance.
    expect(block).toMatch(/generic motivational quotes/i);
  });

  it("will not load another player's check-in as context", async () => {
    const { recordPreGameCheckin } = await import("@/server/services/confidenceService");
    const { loadContextBlocks } = await import("@/server/services/coachContextService");
    const owner = new ObjectId();
    const otherUser = new ObjectId();
    const checkin = await recordPreGameCheckin(owner, "confident");

    const blocks = await loadContextBlocks(otherUser, [
      { type: "confidence_checkin", refId: checkin._id },
    ]);

    expect(blocks).toHaveLength(0);
  });
});
