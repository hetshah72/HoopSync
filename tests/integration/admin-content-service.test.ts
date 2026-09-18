import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { initializeDatabase } from "../../scripts/db/init";
import { COLLECTIONS } from "@/lib/db-constants";

/**
 * The content pipeline (BRD 7.14: "MVP for the content pipeline itself",
 * "Production content must have cleared rights before use").
 *
 * Storage is stubbed - whether bytes reach GCS or the dev-only local
 * directory is `mediaStorageService`'s business, and exercising it here would
 * write files into the repo. What is under test is the rights half: what gets
 * recorded, what clears itself, and what is refused publication.
 */
const storeContentClip = vi.fn();
vi.mock("@/server/services/contentStorageService", () => ({
  storeContentClip: (...args: unknown[]) => storeContentClip(...args),
}));

describe("adminContentService", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.MONGODB_DB_NAME = "hoopsync_test";
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("hoopsync_test");
    await initializeDatabase(db);
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await db.collection(COLLECTIONS.mediaAssets).deleteMany({});
    await db.collection(COLLECTIONS.feedItems).deleteMany({});
    storeContentClip.mockReset();
  });

  const admin = new ObjectId();

  /** Inserts the asset row the stubbed storage layer would have written. */
  async function fakeStoredAsset(overrides: Record<string, unknown> = {}) {
    const doc = {
      _id: new ObjectId(),
      url: "/uploads/library/clip.mp4",
      type: "video",
      source: "generated",
      contributor: "hoopsync",
      rightsHolder: "HoopSync",
      createdAt: new Date(),
      ...overrides,
    };
    await db.collection(COLLECTIONS.mediaAssets).insertOne(doc);
    return doc;
  }

  const ingestInput = (overrides: Record<string, unknown> = {}) => ({
    source: "generated" as const,
    contributor: "hoopsync" as const,
    rightsHolder: "HoopSync",
    title: "A demo clip",
    body: "What the clip shows.",
    ...overrides,
  });

  const file = { buffer: Buffer.from("x"), contentType: "video/mp4" };

  describe("ingest", () => {
    it("publishes HoopSync's own content immediately - it owns the rights", async () => {
      const asset = await fakeStoredAsset({ rightsClearedAt: new Date() });
      storeContentClip.mockResolvedValue(asset);

      const { ingestClip } = await import("@/server/services/adminContentService");
      const view = await ingestClip(admin, ingestInput(), file);

      expect(view.cleared).toBe(true);

      // The card it authored points at the clip, so it is live.
      const card = await db
        .collection(COLLECTIONS.feedItems)
        .findOne({ title: "A demo clip" });
      expect(card?.mediaAssetId?.toString()).toBe(asset._id.toString());
    });

    it("does NOT publish a coach's upload - somebody has to confirm a release", async () => {
      // The case that makes auto-clearing on rights basis indefensible: a
      // coach uploading footage of a minor.
      const asset = await fakeStoredAsset({ contributor: "coach_trainer" });
      storeContentClip.mockResolvedValue(asset);

      const { ingestClip } = await import("@/server/services/adminContentService");
      const view = await ingestClip(
        admin,
        ingestInput({ contributor: "coach_trainer", rightsHolder: "Coach Reyes" }),
        file,
      );

      expect(view.cleared).toBe(false);
      expect(view.pendingReason).toMatch(/release/i);

      // Crucially: the card exists but has no media, so nothing is visible.
      const card = await db
        .collection(COLLECTIONS.feedItems)
        .findOne({ title: "A demo clip" });
      expect(card).toBeTruthy();
      expect(card?.mediaAssetId).toBeUndefined();
    });

    it("keeps a licensor's content unpublished until a human confirms the licence", async () => {
      const asset = await fakeStoredAsset({ contributor: "licensor" });
      storeContentClip.mockResolvedValue(asset);

      const { ingestClip } = await import("@/server/services/adminContentService");
      const view = await ingestClip(
        admin,
        ingestInput({ contributor: "licensor" }),
        file,
      );
      expect(view.cleared).toBe(false);
      expect(view.pendingReason).toMatch(/licence/i);
    });

    it("passes the declared rights down to storage rather than inventing them", async () => {
      // licenseNotes is mandatory for a licensed asset - the $jsonSchema
      // enforces it independently of the app, which is why the fixture has to
      // satisfy it too.
      const asset = await fakeStoredAsset({
        source: "licensed",
        licenseNotes: "Contract 2026-11.",
      });
      storeContentClip.mockResolvedValue(asset);

      const { ingestClip } = await import("@/server/services/adminContentService");
      await ingestClip(
        admin,
        ingestInput({
          source: "licensed",
          contributor: "licensor",
          rightsHolder: "Example Media",
          licenseNotes: "Contract 2026-11.",
          attribution: "Courtesy of Example Media",
        }),
        file,
      );

      expect(storeContentClip).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "licensed",
          contributor: "licensor",
          rightsHolder: "Example Media",
          licenseNotes: "Contract 2026-11.",
          attribution: "Courtesy of Example Media",
        }),
      );
    });
  });

  describe("the clearance gate", () => {
    it("refuses to publish a clip whose rights are not cleared", async () => {
      const asset = await fakeStoredAsset({ contributor: "coach_trainer" });
      const { insertedId: cardId } = await db
        .collection(COLLECTIONS.feedItems)
        .insertOne({
          type: "drill_demo",
          kind: "library",
          title: "Target card",
          body: "Body.",
          tags: [],
          createdAt: new Date(),
        });

      const { attachAssetToFeedItem } = await import(
        "@/server/services/adminContentService"
      );
      await expect(
        attachAssetToFeedItem(asset._id, cardId),
      ).rejects.toThrow(/haven't been cleared/i);

      const card = await db.collection(COLLECTIONS.feedItems).findOne({ _id: cardId });
      expect(card?.mediaAssetId).toBeUndefined();
    });

    it("publishes once a human clears the rights", async () => {
      const asset = await fakeStoredAsset({ contributor: "coach_trainer" });
      const { insertedId: cardId } = await db
        .collection(COLLECTIONS.feedItems)
        .insertOne({
          type: "drill_demo",
          kind: "library",
          title: "Target card",
          body: "Body.",
          tags: [],
          createdAt: new Date(),
        });

      const { attachAssetToFeedItem, setAssetClearance } = await import(
        "@/server/services/adminContentService"
      );

      const cleared = await setAssetClearance(admin, asset._id, true);
      expect(cleared.cleared).toBe(true);

      await attachAssetToFeedItem(asset._id, cardId);
      const card = await db.collection(COLLECTIONS.feedItems).findOne({ _id: cardId });
      expect(card?.mediaAssetId?.toString()).toBe(asset._id.toString());
    });

    it("records who cleared it and when", async () => {
      const asset = await fakeStoredAsset({ contributor: "licensor" });
      const { setAssetClearance } = await import(
        "@/server/services/adminContentService"
      );
      await setAssetClearance(admin, asset._id, true);

      const row = await db
        .collection(COLLECTIONS.mediaAssets)
        .findOne({ _id: asset._id });
      expect(row?.rightsClearedBy?.toString()).toBe(admin.toString());
      expect(row?.rightsClearedAt).toBeInstanceOf(Date);
    });

    it("withdrawing clearance removes the timestamp, not just a flag", async () => {
      const asset = await fakeStoredAsset({ rightsClearedAt: new Date() });
      const { setAssetClearance } = await import(
        "@/server/services/adminContentService"
      );
      await setAssetClearance(admin, asset._id, false);

      const row = await db
        .collection(COLLECTIONS.mediaAssets)
        .findOne({ _id: asset._id });
      expect(row?.rightsClearedAt).toBeUndefined();
      expect(row?.rightsClearedBy).toBeUndefined();
    });

    it("does not gate rendering - a cleared placeholder still plays the demo", async () => {
      // BRD 6.4/11.1: the MVP must be demonstrable with no league licence, so
      // the gate is at publish time and never at render. If this ever fails,
      // the demo has been broken in the name of strictness.
      const asset = await fakeStoredAsset({
        source: "placeholder",
        rightsClearedAt: new Date(),
      });
      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Placeholder card",
        body: "Body.",
        mediaAssetId: asset._id,
        tags: [],
        createdAt: new Date(),
      });

      const { getPersonalizedFeed } = await import("@/server/services/feedService");
      const feed = await getPersonalizedFeed(new ObjectId());
      const card = feed.items.find((i) => i.title === "Placeholder card");

      expect(card?.media).not.toBeNull();
      expect(card?.media?.disclosure.isPlaceholder).toBe(true);
    });
  });

  describe("the inventory", () => {
    it("reports each asset's rights state for a human to act on", async () => {
      await fakeStoredAsset({ rightsClearedAt: new Date() });
      await fakeStoredAsset({ contributor: "coach_trainer" });

      const { listContentAssets } = await import(
        "@/server/services/adminContentService"
      );
      const all = await listContentAssets();
      expect(all).toHaveLength(2);
      expect(all.filter((a) => a.cleared)).toHaveLength(1);
      expect(all.filter((a) => !a.cleared)[0].pendingReason).toBeTruthy();
    });

    it("can list only what is still awaiting clearance", async () => {
      await fakeStoredAsset({ rightsClearedAt: new Date() });
      await fakeStoredAsset({ contributor: "licensor" });

      const { listContentAssets } = await import(
        "@/server/services/adminContentService"
      );
      const pending = await listContentAssets({ cleared: false });
      expect(pending).toHaveLength(1);
      expect(pending[0].cleared).toBe(false);
    });
  });
});
