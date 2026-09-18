import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import { generateDrillVariants } from "@/lib/drill-library";
import { DRILLS, seedDrills } from "../../scripts/db/seed";
import { initializeDatabase } from "../../scripts/db/init";

/**
 * The real seeding path for the ~1,000-drill library (BRD 6.2), against a real
 * Mongo with the real `$jsonSchema` validator applied.
 *
 * Runs `seedDrills` itself rather than a copy: the unit tests already prove the
 * catalogue is well-formed, and what is left to prove is that it survives the
 * trip into the database - that the validator accepts every row, that ~1,000
 * bulk upserts actually land, and that re-running is genuinely idempotent
 * rather than doubling the library.
 */
describe("seedDrills", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const placeholderAssetId = new ObjectId();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("hoopsync_test");
    await initializeDatabase(db);
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it("seeds the authored core plus every variant", async () => {
    await seedDrills(db, placeholderAssetId);

    const count = await db.collection(COLLECTIONS.drills).countDocuments();
    expect(count).toBe(DRILLS.length + generateDrillVariants().length);
    // The BRD's target, reached and verifiable rather than asserted.
    expect(count).toBeGreaterThanOrEqual(1000);
  }, 60_000);

  it("keeps every authored slug intact", async () => {
    // These are referenced by name from the archetype packs, signature moves
    // and the shot-mechanics mapping. A variant overwriting one would silently
    // break "every player profile has a signature move with a matching drill".
    const collection = db.collection(COLLECTIONS.drills);
    for (const drill of DRILLS) {
      const found = await collection.findOne({ slug: drill.slug });
      expect(found, `authored drill ${drill.slug} is missing`).toBeTruthy();
      expect(found!.name).toBe(drill.name);
      // An authored drill must never be marked as descending from another.
      expect(found!.variantOf).toBeUndefined();
    }
  }, 60_000);

  it("is idempotent - re-seeding does not duplicate the library", async () => {
    const before = await db.collection(COLLECTIONS.drills).countDocuments();
    await seedDrills(db, placeholderAssetId);
    const after = await db.collection(COLLECTIONS.drills).countDocuments();
    expect(after).toBe(before);
  }, 60_000);

  it("gives every variant a base drill that actually exists", async () => {
    // A dangling `variantOf` would make the provenance claim a lie.
    const collection = db.collection(COLLECTIONS.drills);
    const authored = new Set(DRILLS.map((d) => d.slug));
    const variants = await collection
      .find({ variantOf: { $exists: true } })
      .toArray();

    expect(variants.length).toBeGreaterThan(900);
    for (const variant of variants) {
      expect(
        authored.has(variant.variantOf as string),
        `${variant.slug} claims descent from unknown drill ${variant.variantOf}`,
      ).toBe(true);
    }
  }, 60_000);

  it("attaches the placeholder clip provenance to every drill", async () => {
    // BRD 7.14: every piece of content needs a traceable source, and a
    // 1,000-row library is exactly where an untraceable row would hide.
    const missing = await db
      .collection(COLLECTIONS.drills)
      .countDocuments({ videoAssetId: { $exists: false } });
    expect(missing).toBe(0);
  }, 60_000);
});
