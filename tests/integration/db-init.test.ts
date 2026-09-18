import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { initializeDatabase } from "../../scripts/db/init";
import { COLLECTIONS } from "@/lib/db-constants";

describe("initializeDatabase", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("hoopsync_test");
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it("creates every collection with validators and indexes", async () => {
    await initializeDatabase(db);

    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    for (const expected of Object.values(COLLECTIONS)) {
      expect(names).toContain(expected);
    }

    const profileIndexes = await db
      .collection(COLLECTIONS.playerProfiles)
      .indexes();
    expect(profileIndexes.some((i) => i.key.userId === 1 && i.unique)).toBe(
      true,
    );

    // Email/password sign-up relies on this index, not just on its own
    // existence check, to decide who owns an address: two simultaneous
    // sign-ups both pass that check and only the index can reject the second
    // insert (see authService.registerWithPassword).
    const userIndexes = await db.collection(COLLECTIONS.users).indexes();
    expect(userIndexes.some((i) => i.key.email === 1 && i.unique)).toBe(true);
  });

  it("keeps the unique email index usable for adapter users with no email", async () => {
    // The Auth.js adapter treats `email` as optional, so the index is
    // partial - two such documents must not collide with each other.
    const users = db.collection(COLLECTIONS.users);
    await users.insertOne({ name: "No email A", createdAt: new Date() });
    await users.insertOne({ name: "No email B", createdAt: new Date() });

    await users.insertOne({ email: "taken@example.com", createdAt: new Date() });
    await expect(
      users.insertOne({ email: "taken@example.com", createdAt: new Date() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("is safe to re-run without error and without dropping data", async () => {
    await db.collection(COLLECTIONS.drills).insertOne({
      slug: "test-drill",
      name: "Test Drill",
      description: "x",
      skillTags: ["shooting"],
      difficulty: "beginner",
      coachingCues: [],
      equipmentNeeded: [],
      createdAt: new Date(),
    });

    await initializeDatabase(db);

    const count = await db.collection(COLLECTIONS.drills).countDocuments();
    expect(count).toBe(1);
  });
});
