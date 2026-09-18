import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { initializeDatabase } from "../../scripts/db/init";
import { COLLECTIONS } from "@/lib/db-constants";

/**
 * The mechanical form of BRD 7.14's two success criteria:
 *
 *   1. "Every piece of content shipped in the MVP has a traceable, legitimate
 *      source" - nothing without a provenance row reaches a screen.
 *   2. "No league-owned footage is used before the pending license is in
 *      place" - refused on write, and refused again on read for anything that
 *      got in another way.
 *
 * Both are asserted against a real MongoDB (validators included), because the
 * $jsonSchema is half the enforcement and a unit test cannot see it.
 */
describe("content provenance (BRD 7.14)", () => {
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
    delete process.env.MEDIA_ALLOWED_HOSTS;
  });

  const validAsset = () => ({
    url: "/drill-demos/placeholder-drill-demo.mp4",
    type: "video",
    source: "placeholder",
    contributor: "hoopsync",
    rightsHolder: "HoopSync",
    createdAt: new Date(),
  });

  describe("the database validator", () => {
    it("accepts a fully-described asset", async () => {
      await expect(
        db.collection(COLLECTIONS.mediaAssets).insertOne(validAsset()),
      ).resolves.toBeTruthy();
    });

    it("refuses a rights basis outside BRD 7.14's five categories", async () => {
      await expect(
        db
          .collection(COLLECTIONS.mediaAssets)
          .insertOne({ ...validAsset(), source: "scraped" }),
      ).rejects.toThrow();
    });

    it("refuses an asset with no rights holder - 'traceable' needs an owner", async () => {
      const withoutHolder: Record<string, unknown> = { ...validAsset() };
      delete withoutHolder.rightsHolder;
      await expect(
        db.collection(COLLECTIONS.mediaAssets).insertOne(withoutHolder),
      ).rejects.toThrow();
    });

    it("refuses licensed content with no record of its licence", async () => {
      await expect(
        db.collection(COLLECTIONS.mediaAssets).insertOne({
          ...validAsset(),
          source: "licensed",
          rightsHolder: "Example Media",
        }),
      ).rejects.toThrow();
    });

    it("accepts licensed content once the licence is recorded", async () => {
      await expect(
        db.collection(COLLECTIONS.mediaAssets).insertOne({
          ...validAsset(),
          url: "https://storage.googleapis.com/hoopsync/licensed/clip.mp4",
          source: "licensed",
          rightsHolder: "Example Media",
          licenseNotes: "Perpetual web licence, contract 2026-11.",
        }),
      ).resolves.toBeTruthy();
    });

    it("refuses an unknown media type", async () => {
      await expect(
        db
          .collection(COLLECTIONS.mediaAssets)
          .insertOne({ ...validAsset(), type: "pdf" }),
      ).rejects.toThrow();
    });
  });

  describe("write-time refusal", () => {
    it("refuses to record league-owned footage at all", async () => {
      const { createMediaAsset } = await import(
        "@/server/repositories/mediaAssetRepository"
      );

      await expect(
        createMediaAsset({
          url: "https://www.nba.com/video/highlight.mp4",
          type: "video",
          source: "licensed",
          rightsHolder: "NBA",
          createdAt: new Date(),
        }),
      ).rejects.toThrow(/nba\.com/);

      // And nothing was written - the refusal is not merely cosmetic.
      expect(await db.collection(COLLECTIONS.mediaAssets).countDocuments()).toBe(
        0,
      );
    });

    it("records an asset whose host has been licensed and allowlisted", async () => {
      process.env.MEDIA_ALLOWED_HOSTS = "licensor.example";
      const { createMediaAsset } = await import(
        "@/server/repositories/mediaAssetRepository"
      );

      const asset = await createMediaAsset({
        url: "https://licensor.example/clip.mp4",
        type: "video",
        source: "licensed",
        rightsHolder: "Example Media",
        licenseNotes: "Contract 2026-11.",
        createdAt: new Date(),
      });
      expect(asset._id).toBeInstanceOf(ObjectId);
    });
  });

  describe("read-time refusal", () => {
    it("refuses to render league footage that reached the database another way", async () => {
      // Inserted directly, bypassing createMediaAsset entirely - exactly what
      // a direct write, a restored backup, or an older seed could do. The read
      // path must not trust that everything present was vetted on the way in.
      const { insertedId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne({
          ...validAsset(),
          url: "https://www.nba.com/video/highlight.mp4",
          source: "licensed",
          rightsHolder: "NBA",
          licenseNotes: "none",
        });

      const { resolveMediaAsset } = await import(
        "@/server/services/mediaProvenanceService"
      );
      expect(await resolveMediaAsset(insertedId)).toBeNull();
    });

    it("returns nothing for a dangling asset id rather than a broken player", async () => {
      const { resolveMediaAsset } = await import(
        "@/server/services/mediaProvenanceService"
      );
      expect(await resolveMediaAsset(new ObjectId())).toBeNull();
      expect(await resolveMediaAsset(undefined)).toBeNull();
    });

    it("resolves a legitimate asset with the disclosure it must be shown under", async () => {
      const { insertedId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne(validAsset());

      const { resolveMediaAsset } = await import(
        "@/server/services/mediaProvenanceService"
      );
      const view = await resolveMediaAsset(insertedId);

      expect(view).not.toBeNull();
      expect(view!.url).toBe("/drill-demos/placeholder-drill-demo.mp4");
      expect(view!.disclosure.isPlaceholder).toBe(true);
      expect(view!.disclosure.sourceLabel).toBe("Placeholder footage");
      expect(view!.disclosure.note).toBeTruthy();
    });
  });

  describe("npm run content:audit", () => {
    it("passes on a database whose content is all traceable", async () => {
      const { insertedId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne({ ...validAsset(), rightsClearedAt: new Date() });
      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Clean card",
        body: "Body.",
        mediaAssetId: insertedId,
        tags: [],
        createdAt: new Date(),
      });

      const { auditDatabase } = await import("../../scripts/db/content-audit");
      const report = await auditDatabase(db);

      expect(report.ok).toBe(true);
      expect(report.counts.violations).toBe(0);
    });

    it("fails when content points at an asset that does not exist", async () => {
      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Dangling card",
        body: "Body.",
        mediaAssetId: new ObjectId(),
        tags: [],
        createdAt: new Date(),
      });

      const { auditDatabase } = await import("../../scripts/db/content-audit");
      const report = await auditDatabase(db);

      expect(report.ok).toBe(false);
      expect(report.findings.some((f) => f.code === "missing_asset")).toBe(true);
    });

    it("fails when published content is attached to uncleared rights", async () => {
      // rightsClearedAt deliberately absent - BRD 7.14: "Production content
      // must have cleared rights before use".
      const { insertedId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne(validAsset());
      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Uncleared card",
        body: "Body.",
        mediaAssetId: insertedId,
        tags: [],
        createdAt: new Date(),
      });

      const { auditDatabase } = await import("../../scripts/db/content-audit");
      const report = await auditDatabase(db);

      expect(report.ok).toBe(false);
      expect(report.findings.some((f) => f.code === "uncleared_in_use")).toBe(
        true,
      );
    });

    it("reports what it did not walk, so the totals are not read as completeness", async () => {
      const { describeAuditScope, formatAuditReport } = await import(
        "@/lib/content-audit"
      );
      const { auditDatabase } = await import("../../scripts/db/content-audit");

      expect(describeAuditScope().notWalked.length).toBeGreaterThan(0);
      expect(formatAuditReport(await auditDatabase(db))).toContain("Not walked:");
    });
  });

  describe("the feed carries media to the screen", () => {
    it("surfaces a card's clip and its disclosure, instead of dropping it", async () => {
      // The regression this locks down: FeedItemDoc.mediaAssetId existed from
      // the start and toView dropped it, so the one seeded media-bearing card
      // promised a clip and rendered nothing.
      const { insertedId: assetId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne(validAsset());

      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Hesitation Into Drive - demo",
        body: "See the footwork and timing on a hesitation move.",
        mediaAssetId: assetId,
        tags: ["ball_handling"],
        createdAt: new Date(),
      });

      const { getPersonalizedFeed } = await import(
        "@/server/services/feedService"
      );
      const feed = await getPersonalizedFeed(new ObjectId());
      const card = feed.items.find(
        (item) => item.title === "Hesitation Into Drive - demo",
      );

      expect(card).toBeDefined();
      expect(card!.media).not.toBeNull();
      expect(card!.media!.url).toBe("/drill-demos/placeholder-drill-demo.mp4");
      expect(card!.media!.disclosure.sourceLabel).toBe("Placeholder footage");
    });

    it("gives a card with unvouchable media no media at all", async () => {
      const { insertedId: assetId } = await db
        .collection(COLLECTIONS.mediaAssets)
        .insertOne({
          ...validAsset(),
          url: "https://www.nba.com/video/highlight.mp4",
        });

      await db.collection(COLLECTIONS.feedItems).insertOne({
        type: "drill_demo",
        kind: "library",
        title: "Unvouchable clip",
        body: "Body copy.",
        mediaAssetId: assetId,
        tags: [],
        createdAt: new Date(),
      });

      const { getPersonalizedFeed } = await import(
        "@/server/services/feedService"
      );
      const feed = await getPersonalizedFeed(new ObjectId());
      const card = feed.items.find((item) => item.title === "Unvouchable clip");

      // The card still renders - losing the copy would be worse - but the
      // footage does not, and nothing leaks a bare URL to the client.
      expect(card).toBeDefined();
      expect(card!.media).toBeNull();
    });
  });
});
