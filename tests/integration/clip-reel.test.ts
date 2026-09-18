import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { initializeDatabase } from "../../scripts/db/init";
import { COLLECTIONS } from "@/lib/db-constants";

/**
 * The Clips reel (BRD 7.14: "a TikTok/Instagram consumption model").
 *
 * What is actually worth testing here is not the scrolling - it is that the
 * reel only ever shows content it can vouch for, and that a deep link opens
 * the clip that was tapped rather than a different one.
 */
describe("getClipReel", () => {
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
  });

  async function seedAsset(overrides: Record<string, unknown> = {}) {
    const { insertedId } = await db.collection(COLLECTIONS.mediaAssets).insertOne({
      url: "/drill-demos/placeholder-drill-demo.mp4",
      type: "video",
      source: "placeholder",
      contributor: "hoopsync",
      rightsHolder: "HoopSync",
      rightsClearedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    });
    return insertedId;
  }

  async function seedCard(title: string, mediaAssetId: ObjectId | null) {
    const { insertedId } = await db.collection(COLLECTIONS.feedItems).insertOne({
      type: "drill_demo",
      kind: "library",
      title,
      body: `${title} body copy.`,
      tags: [],
      createdAt: new Date(),
      ...(mediaAssetId ? { mediaAssetId } : {}),
    });
    return insertedId.toString();
  }

  it("shows only cards that carry playable, vouched-for media", async () => {
    const assetId = await seedAsset();
    await seedCard("Has a clip", assetId);
    await seedCard("Text only", null);

    const { getClipReel } = await import("@/server/services/feedService");
    const reel = await getClipReel(new ObjectId());

    expect(reel.clips.map((c) => c.title)).toEqual(["Has a clip"]);
  });

  it("drops a card whose media is an image, not a video", async () => {
    // Nothing to play full-screen; showing a still in a video surface would
    // misrepresent what it is.
    const imageId = await seedAsset({ type: "image", url: "/uploads/x.png" });
    await seedCard("An image card", imageId);

    const { getClipReel } = await import("@/server/services/feedService");
    expect((await getClipReel(new ObjectId())).clips).toHaveLength(0);
  });

  it("drops a card whose media cannot be vouched for", async () => {
    const blocked = await seedAsset({
      url: "https://www.nba.com/video/highlight.mp4",
      source: "licensed",
      rightsHolder: "NBA",
      licenseNotes: "none",
    });
    await seedCard("Unvouchable", blocked);

    const { getClipReel } = await import("@/server/services/feedService");
    expect((await getClipReel(new ObjectId())).clips).toHaveLength(0);
  });

  it("every clip it does return carries a non-empty disclosure", async () => {
    const assetId = await seedAsset();
    await seedCard("Labelled", assetId);

    const { getClipReel } = await import("@/server/services/feedService");
    const { MEDIA_SOURCE_LABELS } = await import("@/lib/media-provenance");
    const { clips } = await getClipReel(new ObjectId());

    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      expect(Object.values(MEDIA_SOURCE_LABELS)).toContain(
        clip.media.disclosure.sourceLabel,
      );
    }
  });

  it("opens on the clip that was tapped", async () => {
    const assetId = await seedAsset();
    await seedCard("First", assetId);
    const secondId = await seedCard("Second", assetId);
    await seedCard("Third", assetId);

    const { getClipReel } = await import("@/server/services/feedService");
    const reel = await getClipReel(new ObjectId(), secondId);

    expect(reel.clips[reel.startIndex].id).toBe(secondId);
  });

  it("opens on a deep-linked clip that falls outside the first window", async () => {
    // The regression this locks down: slicing to the window *before* resolving
    // the index makes findIndex return -1 for anything past it, silently
    // opening clip 1 - a different clip, under a different disclosure, than
    // the one the player tapped.
    const assetId = await seedAsset();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await seedCard(`Clip ${i}`, assetId));

    const { getClipReel } = await import("@/server/services/feedService");
    const target = ids[27];
    const reel = await getClipReel(new ObjectId(), target);

    expect(reel.totalAvailable).toBe(30);
    expect(reel.clips.length).toBeLessThanOrEqual(20);
    expect(reel.clips[reel.startIndex]?.id).toBe(target);
  });

  it("falls back to the top for an unknown or absent start id", async () => {
    const assetId = await seedAsset();
    await seedCard("Only", assetId);

    const { getClipReel } = await import("@/server/services/feedService");
    expect((await getClipReel(new ObjectId(), "nope")).startIndex).toBe(0);
    expect((await getClipReel(new ObjectId())).startIndex).toBe(0);
  });

  it("returns an empty reel rather than throwing when nothing has media", async () => {
    await seedCard("Text only", null);

    const { getClipReel } = await import("@/server/services/feedService");
    const reel = await getClipReel(new ObjectId());
    expect(reel.clips).toEqual([]);
    expect(reel.totalAvailable).toBe(0);
  });
});
