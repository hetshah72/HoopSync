import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "hoopsync_test";
});

afterAll(async () => {
  await mongod.stop();
});

async function seedDrill() {
  const { drillsCollection } = await import("@/server/db/collections");
  const collection = await drillsCollection();
  const result = await collection.insertOne({
    slug: "test-drill",
    name: "Test Drill",
    description: "A drill for testing.",
    skillTags: ["shooting"],
    difficulty: "beginner",
    coachingCues: ["Cue one"],
    equipmentNeeded: [],
    defaultSets: 3,
    defaultReps: 10,
    createdAt: new Date(),
  } as never);
  return result.insertedId;
}

async function seedFeedItem() {
  const { feedItemsCollection } = await import("@/server/db/collections");
  const collection = await feedItemsCollection();
  const result = await collection.insertOne({
    type: "tip",
    title: "A feed item",
    body: "body",
    tags: ["shooting"],
    createdAt: new Date(),
  } as never);
  return result.insertedId;
}

describe("workoutService", () => {
  it("startDrillAsWorkout creates a real workout referencing the real drill", async () => {
    const { startDrillAsWorkout } = await import("@/server/services/workoutService");
    const { workoutsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    const drillId = await seedDrill();

    const workoutId = await startDrillAsWorkout(userId, drillId);

    const collection = await workoutsCollection();
    const workout = await collection.findOne({ _id: workoutId });
    expect(workout).not.toBeNull();
    expect(workout?.userId.equals(userId)).toBe(true);
    expect(workout?.drills).toHaveLength(1);
    expect(workout?.drills[0].drillId.equals(drillId)).toBe(true);
    expect(workout?.status).toBe("pending");
  });

  it("addDrillToWorkout appends to an existing pending workout instead of duplicating", async () => {
    const { startDrillAsWorkout, addDrillToWorkout } = await import(
      "@/server/services/workoutService"
    );
    const { drillsCollection, workoutsCollection } = await import(
      "@/server/db/collections"
    );

    const userId = new ObjectId();
    const firstDrillId = await seedDrill();
    const drillsCol = await drillsCollection();
    const secondDrillResult = await drillsCol.insertOne({
      slug: "second-drill",
      name: "Second Drill",
      description: "Another drill.",
      skillTags: ["ball_handling"],
      difficulty: "beginner",
      coachingCues: [],
      equipmentNeeded: [],
      createdAt: new Date(),
    } as never);

    const workoutId = await startDrillAsWorkout(userId, firstDrillId);
    const secondWorkoutId = await addDrillToWorkout(
      userId,
      secondDrillResult.insertedId,
    );

    expect(secondWorkoutId.equals(workoutId)).toBe(true);

    const collection = await workoutsCollection();
    const workout = await collection.findOne({ _id: workoutId });
    expect(workout?.drills).toHaveLength(2);
  });

  it("addDrillToWorkout doesn't duplicate the same drill twice", async () => {
    const { startDrillAsWorkout, addDrillToWorkout } = await import(
      "@/server/services/workoutService"
    );
    const { workoutsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    const drillId = await seedDrill();

    const workoutId = await startDrillAsWorkout(userId, drillId);
    await addDrillToWorkout(userId, drillId); // same drill again

    const collection = await workoutsCollection();
    const workout = await collection.findOne({ _id: workoutId });
    expect(workout?.drills).toHaveLength(1);
  });

  it("addDrillToWorkout starts a fresh workout when no pending one exists", async () => {
    const { addDrillToWorkout } = await import("@/server/services/workoutService");
    const userId = new ObjectId();
    const drillId = await seedDrill();

    const workoutId = await addDrillToWorkout(userId, drillId);
    expect(workoutId).toBeInstanceOf(ObjectId);
  });
});

describe("coachService.startConversationFromFeedItem", () => {
  it("creates a conversation with the feed item attached as context", async () => {
    const { startConversationFromFeedItem } = await import(
      "@/server/services/coachService"
    );
    const { coachConversationsCollection } = await import("@/server/db/collections");

    const userId = new ObjectId();
    const feedItemId = await seedFeedItem();

    const conversationId = await startConversationFromFeedItem(
      userId,
      "direct",
      feedItemId,
    );

    const collection = await coachConversationsCollection();
    const conversation = await collection.findOne({ _id: conversationId });
    expect(conversation?.personality).toBe("direct");
    expect(conversation?.contextRefs).toEqual([
      { type: "feed_item", refId: feedItemId },
    ]);
  });
});
