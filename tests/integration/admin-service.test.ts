import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

/**
 * The admin dashboard's access boundary (BRD 6.2).
 *
 * This is the test that matters most for this feature. The route layout hides
 * the screens, but every function here is reachable as a Server Action by
 * anyone who knows its name, and they read and write across every player's
 * data - so the gate has to live in the service and be proven to hold, not be
 * assumed from the fact that the UI is behind a redirect.
 */

/** Swapped per test to impersonate signed-out / player / admin. */
let currentSession: { user?: { id: string; role: string } } | null = null;

vi.mock("@/server/auth/auth", () => ({
  auth: async () => currentSession,
}));

let mongod: MongoMemoryServer;
const adminId = new ObjectId();
const playerId = new ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
}, 60_000);

afterAll(async () => {
  await mongod.stop();
});

beforeEach(async () => {
  const { usersCollection } = await import("@/server/db/collections");
  const users = await usersCollection();
  await users.deleteMany({});
  await users.insertMany([
    {
      _id: adminId,
      email: "admin@hoopsync.dev",
      role: "admin",
      createdAt: new Date(),
    },
    {
      _id: playerId,
      email: "player@hoopsync.dev",
      role: "player",
      createdAt: new Date(),
    },
  ] as never);
  currentSession = { user: { id: adminId.toString(), role: "admin" } };
});

function asSignedOut() {
  currentSession = null;
}
function asPlayer() {
  currentSession = { user: { id: playerId.toString(), role: "player" } };
}

describe("admin access boundary", () => {
  it("refuses every read to a signed-out caller", async () => {
    asSignedOut();
    const { getAdminOverview, listPlayers, getContentStatus, getAiStatus } =
      await import("@/server/services/adminService");

    await expect(getAdminOverview()).rejects.toThrow(/signed in/i);
    await expect(listPlayers()).rejects.toThrow(/signed in/i);
    await expect(getContentStatus()).rejects.toThrow(/signed in/i);
    await expect(getAiStatus()).rejects.toThrow(/signed in/i);
  });

  it("refuses every read to a signed-in non-admin", async () => {
    // The case a layout gate cannot cover: a logged-in player invoking the
    // action directly.
    asPlayer();
    const { getAdminOverview, listPlayers, getContentStatus, getAiStatus } =
      await import("@/server/services/adminService");

    await expect(getAdminOverview()).rejects.toThrow(/access/i);
    await expect(listPlayers()).rejects.toThrow(/access/i);
    await expect(getContentStatus()).rejects.toThrow(/access/i);
    await expect(getAiStatus()).rejects.toThrow(/access/i);
  });

  it("refuses a role change from a non-admin", async () => {
    asPlayer();
    const { setUserRole } = await import("@/server/services/adminService");
    await expect(setUserRole(adminId, "player")).rejects.toThrow(/access/i);

    // And the write genuinely did not happen.
    const { usersCollection } = await import("@/server/db/collections");
    const stillAdmin = await (await usersCollection()).findOne({ _id: adminId });
    expect(stillAdmin?.role).toBe("admin");
  });

  it("allows an admin through", async () => {
    const { getAdminOverview, getAiStatus } = await import(
      "@/server/services/adminService"
    );

    const overview = await getAdminOverview();
    expect(overview.collections.length).toBeGreaterThan(0);
    expect(overview.highlights.length).toBeGreaterThan(0);

    const ai = await getAiStatus();
    expect(ai.surfaces.length).toBeGreaterThan(0);
  });
});

describe("role management", () => {
  it("promotes and demotes another account", async () => {
    const { setUserRole } = await import("@/server/services/adminService");
    const { usersCollection } = await import("@/server/db/collections");
    const users = await usersCollection();

    await setUserRole(playerId, "admin");
    expect((await users.findOne({ _id: playerId }))?.role).toBe("admin");

    await setUserRole(playerId, "player");
    expect((await users.findOne({ _id: playerId }))?.role).toBe("player");
  });

  it("stops an admin demoting themselves", async () => {
    // The cheapest guard against locking every administrator out at once.
    const { setUserRole } = await import("@/server/services/adminService");
    await expect(setUserRole(adminId, "player")).rejects.toThrow(
      /your own role/i,
    );

    const { usersCollection } = await import("@/server/db/collections");
    expect((await (await usersCollection()).findOne({ _id: adminId }))?.role).toBe(
      "admin",
    );
  });

  it("reports a missing account rather than silently doing nothing", async () => {
    const { setUserRole } = await import("@/server/services/adminService");
    await expect(setUserRole(new ObjectId(), "admin")).rejects.toThrow(
      /no longer exists/i,
    );
  });
});

describe("admin reads", () => {
  it("never exposes a password hash in the player list", async () => {
    // These rows are the whole userbase; a projection slip here would leak
    // every credential hash in one response.
    const { usersCollection } = await import("@/server/db/collections");
    await (await usersCollection()).updateOne(
      { _id: playerId },
      { $set: { passwordHash: "scrypt$should-never-be-returned" } },
    );

    const { listPlayers } = await import("@/server/services/adminService");
    const rows = await listPlayers();

    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("should-never-be-returned");
    for (const row of rows) {
      expect(row).not.toHaveProperty("passwordHash");
    }
  });

  it("does not surface minors' personal details in the list view", async () => {
    // The profile behind each row carries date of birth, height and weight for
    // a userbase that is mostly under 18. An operational list has no business
    // rendering them.
    const { playerProfilesCollection } = await import("@/server/db/collections");
    await (await playerProfilesCollection()).insertOne({
      _id: new ObjectId(),
      userId: playerId,
      displayName: "Test Player",
      heightInches: 74,
      weightLbs: 165,
      focusAreas: ["shooting"],
      equipment: [],
      coachPersonality: "balanced",
      consent: {
        dateOfBirth: new Date(2011, 5, 15),
        parentalConsentRequired: true,
        parentalConsentGiven: false,
      },
      onboardingCompletedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const { listPlayers } = await import("@/server/services/adminService");
    const row = (await listPlayers()).find((r) => r.id === playerId.toString());

    expect(row?.displayName).toBe("Test Player");
    expect(row).not.toHaveProperty("heightInches");
    expect(row).not.toHaveProperty("weightLbs");
    expect(row).not.toHaveProperty("consent");
    expect(JSON.stringify(row)).not.toContain("2011");
  });
});
