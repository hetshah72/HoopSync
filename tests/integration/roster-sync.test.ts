import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { initializeDatabase } from "../../scripts/db/init";
import { DRILLS } from "../../scripts/db/seed";
import { buildRosterSyncOperations, type BalldontliePlayer } from "@/lib/nba-roster";
import type { NbaPlayerDoc } from "@/types/db";

/**
 * End-to-end check of the roster sync write path against the *real* collection
 * validators and indexes from `npm run db:init`, plus the real seeded drill
 * library - the two things the unit tests deliberately stub out.
 *
 * The guarantee under test is BRD 7.4's hardest one: after a sync of the full
 * league, *every* player profile resolves with at least one signature move
 * backed by a real drill, whether or not anyone has hand-authored content for
 * them.
 */
let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB_NAME = "hoopsync_roster_sync";

  client = new MongoClient(uri);
  await client.connect();
  db = client.db("hoopsync_roster_sync");

  await initializeDatabase(db);
  await db
    .collection("drills")
    .insertMany(DRILLS.map((drill) => ({ ...drill, createdAt: new Date() })) as never[]);
  await db.collection("mediaAssets").insertOne({
    url: "https://example.test/placeholder.mp4",
    type: "video",
    source: "placeholder",
    contributor: "hoopsync",
    rightsHolder: "HoopSync",
    licenseNotes: "test placeholder",
    createdAt: new Date(),
  } as never);
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

function apiPlayer(overrides: Partial<BalldontliePlayer> = {}): BalldontliePlayer {
  return {
    id: 1,
    first_name: "Test",
    last_name: "Player",
    position: "G",
    jersey_number: "30",
    height: "6-2",
    weight: "185",
    college: "Davidson",
    country: "USA",
    draft_year: 2009,
    draft_round: 1,
    draft_number: 7,
    team: { id: 10, full_name: "Golden State Warriors", abbreviation: "GSW" },
    ...overrides,
  };
}

describe("roster sync against real validators", () => {
  it("writes a full roster, adopts an editorial-seeded player, and leaves every profile usable", async () => {
    const players = db.collection<NbaPlayerDoc>("nbaPlayers");

    // An editorial-seeded player, exactly as scripts/db/seed.ts writes them:
    // real authored content, placeholder roster facts, pending_sync.
    await players.insertOne({
      externalId: "pending-sync:stephen-curry",
      syncStatus: "pending_sync",
      name: "Stephen Curry",
      team: "Pending roster sync",
      position: "Point Guard",
      editorial: {
        learn: {
          whatTheyDoWell: "AUTHORED PROSE",
          howTheyPlay: "y",
          whatToWatchFor: "z",
        },
        skills: {
          shooting: 99,
          finishing: 65,
          ballHandling: 92,
          playmaking: 85,
          defense: 55,
          athleticism: 72,
        },
        strengths: ["authored strength"],
        weaknesses: [],
        bio: { careerInfo: "real career info" },
        signatureMoves: [],
      },
      createdAt: new Date(),
    } as never);

    const roster = [
      apiPlayer({ id: 115, first_name: "Stephen", last_name: "Curry" }),
      apiPlayer({
        id: 246,
        first_name: "Victor",
        last_name: "Wembanyama",
        position: "C",
        height: "7-4",
        college: null,
        country: "France",
        team: { id: 27, full_name: "San Antonio Spurs", abbreviation: "SAS" },
      }),
      // A record with nothing but a name - the roster still has to absorb it.
      apiPlayer({
        id: 300,
        first_name: "Unknown",
        last_name: "Position",
        position: null,
        jersey_number: null,
        height: null,
        weight: null,
        college: null,
        country: null,
        draft_year: null,
        draft_round: null,
        draft_number: null,
        team: null,
      }),
    ];

    const { operations, created, matched } = buildRosterSyncOperations(
      roster,
      new Set(["stephen curry"]),
      new Date(),
    );
    expect(created).toBe(2);
    expect(matched).toBe(1);

    // The real validators run here - a bad field shape would throw.
    await players.bulkWrite(operations as never, { ordered: false });

    const all = await players.find().sort({ name: 1 }).toArray();
    expect(all).toHaveLength(3);

    // The seeded player was adopted, not duplicated, and kept their content.
    const curry = all.find((p) => p.name === "Stephen Curry")!;
    expect(curry.syncStatus).toBe("synced");
    expect(curry.team).toBe("Golden State Warriors");
    expect(curry.jerseyNumber).toBe("30");
    expect(curry.college).toBe("Davidson");
    expect(curry.draftYear).toBe(2009);
    expect(curry.editorial.learn.whatTheyDoWell).toBe("AUTHORED PROSE");
    expect(curry.editorial.strengths).toEqual(["authored strength"]);

    // Height/position drove a real archetype for each new player.
    expect(curry.archetypeKey).toBe("lead_guard");
    expect(all.find((p) => p.name === "Victor Wembanyama")!.archetypeKey).toBe(
      "interior_big",
    );
    expect(all.find((p) => p.name === "Unknown Position")!.archetypeKey).toBe(
      "all_around",
    );

    // BRD 7.4, the whole point: every profile is usable.
    const { resolvePlayerEditorial } = await import(
      "@/server/services/playerEditorialService"
    );
    for (const player of all) {
      const resolved = await resolvePlayerEditorial(player);
      expect(
        resolved.signatureMoves.length,
        `${player.name} must have at least one signature move`,
      ).toBeGreaterThan(0);
      for (const move of resolved.signatureMoves) {
        expect(move.drill.name, `${player.name}'s move needs a real drill`).toBeTruthy();
      }
      expect(resolved.learn.whatTheyDoWell).toBeTruthy();
      // And something concrete to actually watch.
      expect(resolved.studyClip?.callouts.length ?? 0).toBeGreaterThan(0);
      // Still the BRD 6.4/7.14 guarantee - no league footage without a
      // licence - but asserted through the shared disclosure descriptor now,
      // so the label the player actually sees is what is under test.
      expect(resolved.studyClip?.media.disclosure.isPlaceholder).toBe(true);
      expect(resolved.studyClip?.media.disclosure.note).toBeTruthy();
    }
  });

  it("is idempotent - re-running the same sync changes nothing", async () => {
    const players = db.collection<NbaPlayerDoc>("nbaPlayers");
    const before = await players.find().sort({ name: 1 }).toArray();

    const existing = new Set(before.map((p) => p.name.toLowerCase()));
    const { operations, created, matched } = buildRosterSyncOperations(
      [apiPlayer({ id: 115, first_name: "Stephen", last_name: "Curry" })],
      existing,
      new Date(),
    );
    expect(created).toBe(0);
    expect(matched).toBe(1);

    await players.bulkWrite(operations as never, { ordered: false });

    const after = await players.find().sort({ name: 1 }).toArray();
    expect(after).toHaveLength(before.length);
    expect(after.find((p) => p.name === "Stephen Curry")!.editorial.learn.whatTheyDoWell).toBe(
      "AUTHORED PROSE",
    );
  });
});
