import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";

/**
 * Email/password account creation and credential checking against a real
 * MongoDB, including the unique index that settles a sign-up race.
 *
 * `src/server/db/client.ts` caches its client on the first connection, so
 * MONGODB_URI has to point at the in-memory server before anything under test
 * opens one. Every import of that code is dynamic and happens after the
 * in-memory server is up, which also gives this file its own module cache.
 *
 * The index is created here rather than by importing `scripts/db/init`:
 * that module pulls in `scripts/db/lib/connection`, which calls
 * `dotenv.config({ override: true })` at module scope and would replace the
 * in-memory MONGODB_URI with the real one from `.env.local` - pointing
 * everything imported afterwards at the developer's own database. That
 * script's own coverage lives in db-init.test.ts, which asserts this index.
 */
let mongod: MongoMemoryServer;
let client: MongoClient;

const base = {
  name: "Jordan",
  email: "jordan@example.com",
  password: "hoopsync1",
  confirmPassword: "hoopsync1",
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";

  client = new MongoClient(mongod.getUri());
  await client.connect();
  await client
    .db("hoopsync_test")
    .collection("users")
    .createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: "string" } } },
    );
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await client.db("hoopsync_test").collection("users").deleteMany({});
});

async function service() {
  return import("@/server/services/authService");
}

async function users() {
  return client.db("hoopsync_test").collection("users");
}

describe("registerWithPassword", () => {
  it("creates a player account and returns no secret material", async () => {
    const { registerWithPassword } = await service();

    const created = await registerWithPassword(base);

    expect(created).toEqual({
      id: expect.any(String),
      email: "jordan@example.com",
      name: "Jordan",
      role: "player",
    });
    expect(created).not.toHaveProperty("passwordHash");
    expect(ObjectId.isValid(created.id)).toBe(true);
  });

  it("stores a hash, never the password itself", async () => {
    const { registerWithPassword } = await service();
    await registerWithPassword(base);

    const stored = await (await users()).findOne({
      email: "jordan@example.com",
    });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(stored)).not.toContain("hoopsync1");
    // Matches what the Auth.js adapter writes for a new user: the address is
    // not verified just because someone typed it.
    expect(stored?.emailVerified).toBeNull();
  });

  it("refuses an email that already has an account", async () => {
    const { registerWithPassword } = await service();
    const { ConflictError } = await import("@/server/errors");
    await registerWithPassword(base);

    await expect(registerWithPassword(base)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await (await users()).countDocuments()).toBe(1);
  });

  it("refuses to attach a password to an existing Google account", async () => {
    // Anyone knowing the address could otherwise set a password on someone
    // else's account, since nothing here proves they control the mailbox.
    const { registerWithPassword } = await service();
    await (await users()).insertOne({
      _id: new ObjectId(),
      email: "jordan@example.com",
      name: "Jordan",
      role: "player",
      createdAt: new Date(),
    });

    await expect(registerWithPassword(base)).rejects.toThrow(
      /already exists/i,
    );
    const stored = await (await users()).findOne({
      email: "jordan@example.com",
    });
    expect(stored?.passwordHash).toBeUndefined();
  });

  it("lets only one of two simultaneous sign-ups win the same email", async () => {
    // The existence check can't settle this - both callers pass it - so the
    // unique index has to, and the loser must surface as a clean conflict
    // rather than a raw driver error.
    const { registerWithPassword } = await service();
    const { ConflictError } = await import("@/server/errors");

    const results = await Promise.allSettled([
      registerWithPassword(base),
      registerWithPassword({ ...base, name: "Someone else" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError,
    );
    expect(await (await users()).countDocuments()).toBe(1);
  });
});

describe("verifyPasswordCredentials", () => {
  it("accepts the right password", async () => {
    const { registerWithPassword, verifyPasswordCredentials } = await service();
    const created = await registerWithPassword(base);

    await expect(
      verifyPasswordCredentials("jordan@example.com", "hoopsync1"),
    ).resolves.toEqual({
      id: created.id,
      email: "jordan@example.com",
      name: "Jordan",
      role: "player",
    });
  });

  it("rejects the wrong password, an unknown email, and a passwordless account", async () => {
    const { registerWithPassword, verifyPasswordCredentials } = await service();
    await registerWithPassword(base);
    await (await users()).insertOne({
      _id: new ObjectId(),
      email: "google-only@example.com",
      role: "player",
      createdAt: new Date(),
    });

    // All three answer identically - distinguishing them is what lets an
    // attacker find out which addresses have accounts.
    await expect(
      verifyPasswordCredentials("jordan@example.com", "wrong-password-1"),
    ).resolves.toBeNull();
    await expect(
      verifyPasswordCredentials("nobody@example.com", "hoopsync1"),
    ).resolves.toBeNull();
    await expect(
      verifyPasswordCredentials("google-only@example.com", "hoopsync1"),
    ).resolves.toBeNull();
  });

  it("carries a stored admin role through, rather than flattening it", async () => {
    const { registerWithPassword, verifyPasswordCredentials } = await service();
    await registerWithPassword(base);
    await (await users()).updateOne(
      { email: "jordan@example.com" },
      { $set: { role: "admin" } },
    );

    const authenticated = await verifyPasswordCredentials(
      "jordan@example.com",
      "hoopsync1",
    );
    expect(authenticated?.role).toBe("admin");
  });
});
