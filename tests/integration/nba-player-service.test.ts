import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { BalldontliePlayer } from "@/server/external/balldontlieClient";

vi.mock("@/server/external/balldontlieClient", () => ({
  fetchAllActivePlayers: vi.fn(),
  parseHeightToInches: (height: string | null) => {
    if (!height) return undefined;
    const match = /^(\d+)-(\d+)$/.exec(height);
    if (!match) return undefined;
    return Number(match[1]) * 12 + Number(match[2]);
  },
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

function mockPlayer(overrides: Partial<BalldontliePlayer> = {}): BalldontliePlayer {
  return {
    id: 999,
    first_name: "Test",
    last_name: "Player",
    position: "Guard",
    jersey_number: "0",
    height: "6-2",
    weight: "185",
    college: "Test University",
    country: "USA",
    draft_year: 2019,
    draft_round: 1,
    draft_number: 14,
    team: { id: 1, full_name: "Test Team", abbreviation: "TT" },
    ...overrides,
  };
}

describe("nbaPlayerService.syncRoster", () => {
  it("reconciles an editorial-seeded (pending_sync) player by name, preserving editorial content", async () => {
    const { fetchAllActivePlayers } = await import(
      "@/server/external/balldontlieClient"
    );
    const { nbaPlayersCollection } = await import("@/server/db/collections");

    const collection = await nbaPlayersCollection();
    await collection.insertOne({
      _id: new ObjectId(),
      externalId: "pending-sync:test-player",
      syncStatus: "pending_sync",
      name: "Test Player",
      team: "Pending roster sync",
      position: "Guard",
      editorial: {
        learn: { whatTheyDoWell: "x", howTheyPlay: "y", whatToWatchFor: "z" },
        skills: {
          shooting: 50,
          finishing: 50,
          ballHandling: 50,
          playmaking: 50,
          defense: 50,
          athleticism: 50,
        },
        strengths: ["real authored content"],
        weaknesses: [],
        bio: { careerInfo: "" },
        signatureMoves: [],
      },
      createdAt: new Date(),
    });

    vi.mocked(fetchAllActivePlayers).mockResolvedValue([
      mockPlayer({ jersey_number: "23" }),
    ]);

    const { syncRoster } = await import("@/server/services/nbaPlayerService");
    const result = await syncRoster();

    expect(result.matched).toBe(1);
    expect(result.created).toBe(0);

    const updated = await collection.findOne({ name: "Test Player" });
    expect(updated?.syncStatus).toBe("synced");
    expect(updated?.team).toBe("Test Team");
    expect(updated?.jerseyNumber).toBe("23");
    expect(updated?.heightInches).toBe(74);
    expect(updated?.editorial.strengths).toEqual(["real authored content"]);
  });

  it("creates a new player record when no editorial match exists", async () => {
    const { fetchAllActivePlayers } = await import(
      "@/server/external/balldontlieClient"
    );
    vi.mocked(fetchAllActivePlayers).mockResolvedValue([
      mockPlayer({ id: 555, first_name: "Brand", last_name: "New" }),
    ]);

    const { syncRoster } = await import("@/server/services/nbaPlayerService");
    const { nbaPlayersCollection } = await import("@/server/db/collections");

    const result = await syncRoster();
    expect(result.created).toBe(1);

    const collection = await nbaPlayersCollection();
    const created = await collection.findOne({ name: "Brand New" });
    expect(created?.syncStatus).toBe("synced");
    expect(created?.editorial.signatureMoves).toEqual([]);
  });
});

describe("nbaPlayerService.startWorkoutFromSignatureMove", () => {
  it("creates a real workout sourced from the player's signature move drill", async () => {
    const { drillsCollection, nbaPlayersCollection, workoutsCollection } =
      await import("@/server/db/collections");

    const drills = await drillsCollection();
    const drillResult = await drills.insertOne({
      slug: "study-drill",
      name: "Study Drill",
      description: "d",
      skillTags: ["shooting"],
      difficulty: "beginner",
      coachingCues: [],
      equipmentNeeded: [],
      createdAt: new Date(),
    } as never);

    const players = await nbaPlayersCollection();
    const playerResult = await players.insertOne({
      externalId: "pending-sync:study-player",
      syncStatus: "pending_sync",
      name: "Study Player",
      team: "Pending roster sync",
      position: "Guard",
      editorial: {
        learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
        skills: {
          shooting: 50,
          finishing: 50,
          ballHandling: 50,
          playmaking: 50,
          defense: 50,
          athleticism: 50,
        },
        strengths: [],
        weaknesses: [],
        bio: { careerInfo: "" },
        signatureMoves: [
          {
            id: "move-1",
            name: "Test Move",
            whatItIs: "x",
            whenUsed: "y",
            whatMakesItEffective: "z",
            keyMechanics: [],
            commonMistakes: [],
            drillId: drillResult.insertedId,
          },
        ],
      },
      createdAt: new Date(),
    } as never);

    const { startWorkoutFromSignatureMove } = await import(
      "@/server/services/nbaPlayerService"
    );
    const userId = new ObjectId();
    const workoutId = await startWorkoutFromSignatureMove(
      userId,
      playerResult.insertedId,
      "move-1",
    );

    const workouts = await workoutsCollection();
    const workout = await workouts.findOne({ _id: workoutId });
    expect(workout?.source.type).toBe("player");
    expect(workout?.source.refId?.equals(playerResult.insertedId)).toBe(true);
    expect(workout?.source.label).toContain("Study Player");
    expect(workout?.drills[0].drillId.equals(drillResult.insertedId)).toBe(true);
  });
});

describe("nbaPlayerService.listPlayers", () => {
  it("filters by a case-insensitive name search", async () => {
    const { listPlayers } = await import("@/server/services/nbaPlayerService");
    const { players } = await listPlayers({ search: "study player" });
    expect(players.some((p) => p.name === "Study Player")).toBe(true);
  });

  it("reports a total independent of the page size, so paging can be honest", async () => {
    const { listPlayers } = await import("@/server/services/nbaPlayerService");
    const { players, total } = await listPlayers({ limit: 1 });
    expect(players).toHaveLength(1);
    expect(total).toBeGreaterThan(1);
  });

  it("returns an empty page (not an error) when nothing matches", async () => {
    const { listPlayers } = await import("@/server/services/nbaPlayerService");
    const { players, total } = await listPlayers({ search: "zzzz-no-such-player" });
    expect(players).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("playerEditorialService: full-roster coverage (BRD 7.4)", () => {
  /**
   * The requirement this whole archetype system exists to satisfy: a player
   * synced straight from balldontlie, with zero hand-authored content, must
   * still have a usable profile with a startable signature-move drill.
   */
  async function seedArchetypeDrills() {
    const { drillsCollection } = await import("@/server/db/collections");
    const { archetypeDrillSlugs } = await import("@/lib/player-archetypes");
    const drills = await drillsCollection();

    for (const slug of archetypeDrillSlugs()) {
      await drills.updateOne(
        { slug },
        {
          $set: {
            slug,
            name: `Drill ${slug}`,
            description: "seeded for archetype coverage",
            skillTags: ["shooting"],
            difficulty: "beginner",
            coachingCues: ["cue"],
            equipmentNeeded: [],
          },
          $setOnInsert: { createdAt: new Date() },
        } as never,
        { upsert: true },
      );
    }
  }

  async function insertUnauthoredPlayer(overrides: Record<string, unknown> = {}) {
    const { nbaPlayersCollection } = await import("@/server/db/collections");
    const players = await nbaPlayersCollection();
    const result = await players.insertOne({
      externalId: `synced-${Math.random().toString(36).slice(2)}`,
      syncStatus: "synced",
      name: `Synced Player ${Math.random().toString(36).slice(2)}`,
      team: "Real Team",
      position: "C",
      heightInches: 84,
      archetypeKey: "interior_big",
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
      ...overrides,
    } as never);
    return result.insertedId;
  }

  it("gives a roster-synced player with no authored content a real signature move", async () => {
    await seedArchetypeDrills();
    const playerId = await insertUnauthoredPlayer();

    const { getPlayerProfile } = await import("@/server/services/nbaPlayerService");
    const profile = await getPlayerProfile(playerId);

    expect(profile).not.toBeNull();
    expect(profile!.editorial.provenance).toBe("archetype");
    expect(profile!.editorial.archetype?.key).toBe("interior_big");
    expect(profile!.editorial.signatureMoves.length).toBeGreaterThan(0);
    // Every move names a real drill from the library, not a dangling id.
    for (const move of profile!.editorial.signatureMoves) {
      expect(move.drill.name).toBeTruthy();
    }
    expect(profile!.editorial.learn.whatTheyDoWell).toBeTruthy();
  });

  it("starts a real workout from an archetype signature move", async () => {
    await seedArchetypeDrills();
    const playerId = await insertUnauthoredPlayer();

    const { getPlayerProfile, startWorkoutFromSignatureMove } = await import(
      "@/server/services/nbaPlayerService"
    );
    const { workoutsCollection } = await import("@/server/db/collections");

    const profile = await getPlayerProfile(playerId);
    const move = profile!.editorial.signatureMoves[0];

    const userId = new ObjectId();
    const workoutId = await startWorkoutFromSignatureMove(userId, playerId, move.id);

    const workouts = await workoutsCollection();
    const workout = await workouts.findOne({ _id: workoutId });
    expect(workout?.source.type).toBe("player");
    expect(workout?.source.refId?.equals(playerId)).toBe(true);
    expect(workout?.drills[0].drillId.equals(move.drillId)).toBe(true);
  });

  it("prefers hand-authored content over the archetype when both could apply", async () => {
    const { drillsCollection, nbaPlayersCollection } = await import(
      "@/server/db/collections"
    );
    const drills = await drillsCollection();
    const drillId = (
      await drills.insertOne({
        slug: `authored-${Math.random().toString(36).slice(2)}`,
        name: "Authored Drill",
        description: "d",
        skillTags: ["shooting"],
        difficulty: "beginner",
        coachingCues: ["cue"],
        equipmentNeeded: [],
        createdAt: new Date(),
      } as never)
    ).insertedId;

    const players = await nbaPlayersCollection();
    const playerId = (
      await players.insertOne({
        externalId: "authored-star",
        syncStatus: "synced",
        name: "Authored Star",
        team: "Real Team",
        position: "C",
        heightInches: 84,
        archetypeKey: "interior_big",
        editorial: {
          learn: {
            whatTheyDoWell: "Authored prose",
            howTheyPlay: "y",
            whatToWatchFor: "z",
          },
          skills: {
            shooting: 91,
            finishing: 50,
            ballHandling: 50,
            playmaking: 50,
            defense: 50,
            athleticism: 50,
          },
          strengths: ["authored strength"],
          weaknesses: [],
          bio: { careerInfo: "real career info" },
          signatureMoves: [
            {
              id: "authored-move",
              name: "Authored Move",
              whatItIs: "x",
              whenUsed: "y",
              whatMakesItEffective: "z",
              keyMechanics: ["m"],
              commonMistakes: ["c"],
              drillId,
            },
          ],
        },
        createdAt: new Date(),
      } as never)
    ).insertedId;

    const { getPlayerProfile } = await import("@/server/services/nbaPlayerService");
    const profile = await getPlayerProfile(playerId);

    expect(profile!.editorial.provenance).toBe("authored");
    expect(profile!.editorial.archetype).toBeUndefined();
    expect(profile!.editorial.learn.whatTheyDoWell).toBe("Authored prose");
    expect(profile!.editorial.signatureMoves).toHaveLength(1);
    expect(profile!.editorial.signatureMoves[0].id).toBe("authored-move");
  });

  it("keeps authored skills while filling in archetype signature moves", async () => {
    // Content authoring is incremental - skills can land before moves do.
    // Neither the authored work nor the signature-move guarantee may be lost.
    await seedArchetypeDrills();
    const playerId = await insertUnauthoredPlayer({
      name: "Partially Authored",
      editorial: {
        learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
        skills: {
          shooting: 12,
          finishing: 99,
          ballHandling: 12,
          playmaking: 12,
          defense: 12,
          athleticism: 12,
        },
        strengths: [],
        weaknesses: [],
        bio: { careerInfo: "" },
        signatureMoves: [],
      },
    });

    const { getPlayerProfile } = await import("@/server/services/nbaPlayerService");
    const profile = await getPlayerProfile(playerId);

    expect(profile!.editorial.sources.skills).toBe("authored");
    expect(profile!.editorial.skills.finishing).toBe(99);
    expect(profile!.editorial.sources.signatureMoves).toBe("archetype");
    expect(profile!.editorial.signatureMoves.length).toBeGreaterThan(0);
    // Mixed sourcing must still disclose as archetype-backed, never as a
    // fully hand-written scouting profile.
    expect(profile!.editorial.provenance).toBe("archetype");
  });
});

describe("nbaPlayerService.generateWorkoutFromPlayer", () => {
  it("targets the player's own highest-rated skills, not a fixed default", async () => {
    const { nbaPlayersCollection, drillsCollection } = await import(
      "@/server/db/collections"
    );

    const drills = await drillsCollection();
    await drills.insertOne({
      slug: "defense-drill-for-player-style",
      name: "Defense Drill",
      description: "d",
      skillTags: ["defense"],
      difficulty: "beginner",
      coachingCues: [],
      equipmentNeeded: [],
      createdAt: new Date(),
    } as never);

    const players = await nbaPlayersCollection();
    const playerResult = await players.insertOne({
      externalId: "pending-sync:defense-star",
      syncStatus: "pending_sync",
      name: "Defense Star",
      team: "Pending roster sync",
      position: "Forward",
      editorial: {
        learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
        skills: {
          shooting: 40,
          finishing: 40,
          ballHandling: 40,
          playmaking: 40,
          defense: 95,
          athleticism: 90,
        },
        strengths: [],
        weaknesses: [],
        bio: { careerInfo: "" },
        signatureMoves: [],
      },
      createdAt: new Date(),
    } as never);

    const { getTopSkillCategories, generateWorkoutFromPlayer } = await import(
      "@/server/services/nbaPlayerService"
    );

    const player = await players.findOne({ _id: playerResult.insertedId });
    const topSkills = getTopSkillCategories(player!.editorial.skills);
    expect(topSkills).toEqual(["defense", "athletic_development"]);

    const userId = new ObjectId();
    const workout = await generateWorkoutFromPlayer(userId, playerResult.insertedId);
    expect(workout.source.type).toBe("player");
    expect(workout.source.label).toContain("Defense Star");
    expect(workout.skillCategory).toBe("defense");
  });
});
