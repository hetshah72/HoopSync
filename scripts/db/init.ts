/**
 * Database initialization script.
 *
 * Creates every HoopSync collection (if missing), applies a light
 * `$jsonSchema` validator to app-owned collections (Auth.js-owned
 * collections - users/accounts/sessions/verificationTokens - are left
 * unvalidated since the adapter controls their exact shape), and ensures
 * indexes exist.
 *
 * Safe to re-run: collection creation and validator updates are both
 * checked/applied idempotently, and `createIndexes` is a no-op for indexes
 * that already exist. This script never drops data.
 *
 * Usage: npm run db:init
 */
import type { Db, Document } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import { connectForScript } from "./lib/connection";

interface IndexSpec {
  key: Record<string, 1 | -1 | "text">;
  options?: Record<string, unknown>;
}

interface CollectionSpec {
  name: string;
  validator?: Document;
  indexes?: IndexSpec[];
}

const jsonSchema = (required: string[], properties: Document) => ({
  $jsonSchema: {
    bsonType: "object",
    required,
    properties,
  },
});

const objectId = { bsonType: "objectId" };
const string = { bsonType: "string" };

const SPECS: CollectionSpec[] = [
  // --- Auth.js-owned: existence only, no validator ---
  {
    name: COLLECTIONS.users,
    /**
     * The adapter creates no indexes of its own, and email/password sign-up
     * needs this one to be the thing that actually decides who owns an
     * address: the service checks for an existing account first, but two
     * simultaneous sign-ups both pass that check, and only a unique index
     * can stop the second insert. Partial, because `email` is optional as
     * far as the adapter's schema is concerned - without the filter, two
     * users lacking the field would collide with each other.
     */
    indexes: [
      {
        key: { email: 1 },
        options: {
          unique: true,
          partialFilterExpression: { email: { $type: "string" } },
        },
      },
    ],
  },
  { name: COLLECTIONS.accounts },
  { name: COLLECTIONS.sessions },
  { name: COLLECTIONS.verificationTokens },

  // --- App-owned collections ---
  {
    name: COLLECTIONS.playerProfiles,
    validator: jsonSchema(["userId", "focusAreas", "equipment", "coachPersonality"], {
      userId: objectId,
      focusAreas: { bsonType: "array" },
      equipment: { bsonType: "array" },
      coachPersonality: string,
    }),
    indexes: [{ key: { userId: 1 }, options: { unique: true } }],
  },
  {
    name: COLLECTIONS.nbaPlayers,
    validator: jsonSchema(
      ["externalId", "syncStatus", "name", "team", "position"],
      {
        externalId: string,
        syncStatus: { bsonType: "string", enum: ["synced", "pending_sync"] },
        name: string,
        team: string,
        position: string,
      },
    ),
    indexes: [
      { key: { externalId: 1 }, options: { unique: true } },
      { key: { name: "text" } },
      // Browse/search sorts by name and filters by team (see
      // nbaPlayerRepository.listPlayers). `name` ascending backs both the
      // sort and the paging; `team + name` backs the team filter with its
      // sort already satisfied.
      { key: { name: 1 } },
      { key: { team: 1, name: 1 } },
      { key: { syncStatus: 1 } },
    ],
  },
  {
    name: COLLECTIONS.drills,
    validator: jsonSchema(["slug", "name", "skillTags", "difficulty"], {
      slug: string,
      name: string,
      skillTags: { bsonType: "array" },
      difficulty: string,
    }),
    indexes: [
      { key: { slug: 1 }, options: { unique: true } },
      { key: { skillTags: 1 } },
    ],
  },
  {
    name: COLLECTIONS.workouts,
    validator: jsonSchema(["userId", "source", "status", "drills"], {
      userId: objectId,
      status: string,
      drills: { bsonType: "array" },
    }),
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { status: 1 } },
      // "Last completed workout" / "workouts this week" for the feed's
      // progress summaries, which would otherwise scan a user's whole
      // history and filter in memory.
      { key: { userId: 1, completedAt: -1 } },
      // One `daily_feed` workout per player per day (BRD 7.2). Partial so it
      // only constrains day-stamped workouts - every other creation path
      // leaves `dayStamp` unset and is unaffected.
      {
        key: { userId: 1, dayStamp: 1 },
        options: {
          unique: true,
          partialFilterExpression: { dayStamp: { $type: "string" } },
        },
      },
    ],
  },
  {
    name: COLLECTIONS.shotSessions,
    validator: jsonSchema(["userId", "status", "shots"], {
      userId: objectId,
      status: string,
      shots: { bsonType: "array" },
    }),
    indexes: [{ key: { userId: 1, recordedAt: -1 } }],
  },
  {
    name: COLLECTIONS.gameFootageAnalyses,
    validator: jsonSchema(["userId", "status", "videoAssetId"], {
      userId: objectId,
      status: string,
      videoAssetId: objectId,
      // Where the findings came from, constrained at the database so no write
      // path can invent a third kind of claim. `vision_model` means they were
      // read off frames of the player's own upload; `heuristic` means nothing
      // was watched (BRD v1.1 §5). Absent on documents written before real
      // analysis existed - those are read as heuristic.
      provenance: { enum: ["vision_model", "heuristic"] },
      framesAnalyzed: { bsonType: "int" },
      // Legacy marker, superseded by `provenance` and no longer written.
      isSimulated: { bsonType: "bool" },
    }),
    indexes: [{ key: { userId: 1, uploadedAt: -1 } }],
  },
  {
    name: COLLECTIONS.coachConversations,
    validator: jsonSchema(["userId", "personality"], {
      userId: objectId,
      personality: string,
    }),
    indexes: [{ key: { userId: 1, lastMessageAt: -1 } }],
  },
  {
    name: COLLECTIONS.coachMessages,
    validator: jsonSchema(["conversationId", "userId", "role", "content"], {
      conversationId: objectId,
      userId: objectId,
      role: string,
      content: string,
      // Optional: absent on user messages and on the openers HoopSync composes
      // itself. Only generated replies carry "ai" / "fallback".
      source: string,
    }),
    indexes: [{ key: { conversationId: 1, createdAt: 1 } }],
  },
  {
    name: COLLECTIONS.confidenceCheckins,
    validator: jsonSchema(["userId", "type"], {
      userId: objectId,
      type: string,
    }),
    // Every read is type-filtered ("the latest pre-game check-in", "the latest
    // recovery plan") except the Progress history, which this still serves as
    // a prefix. `_id` is in the key so the createdAt tiebreak is read off the
    // index instead of forcing a blocking sort.
    indexes: [{ key: { userId: 1, type: 1, createdAt: -1, _id: -1 } }],
  },
  {
    name: COLLECTIONS.goals,
    validator: jsonSchema(["userId", "type", "status"], {
      userId: objectId,
      type: string,
      status: string,
    }),
    indexes: [{ key: { userId: 1, status: 1 } }],
  },
  {
    name: COLLECTIONS.userStats,
    validator: jsonSchema(["userId"], { userId: objectId }),
    indexes: [{ key: { userId: 1 }, options: { unique: true } }],
  },
  {
    name: COLLECTIONS.achievements,
    validator: jsonSchema(["userId", "key"], { userId: objectId, key: string }),
    // The unique index - not a read-then-write in the service - is what makes
    // stamping an achievement at-most-once, exactly as the unique partial index
    // on feedItems does for generated cards. Two concurrent completions race
    // to insert; one wins and the other is a no-op.
    indexes: [{ key: { userId: 1, key: 1 }, options: { unique: true } }],
  },
  {
    name: COLLECTIONS.feedItems,
    validator: jsonSchema(["type", "title", "body"], {
      type: string,
      title: string,
      body: string,
    }),
    indexes: [
      { key: { tags: 1 } },
      { key: { createdAt: -1 } },
      // Reading one player's generated cards for a given day.
      { key: { userId: 1, generatedForDate: -1 } },
      // One card of each kind per player per day. This is what makes the
      // lazy "generate on first Home view of the day" path safe to run from
      // a Server Component render: concurrent renders race to insert and
      // exactly one wins, instead of both appending a duplicate card.
      {
        key: { userId: 1, generatedForDate: 1, kind: 1 },
        options: {
          unique: true,
          partialFilterExpression: { userId: { $type: "objectId" } },
        },
      },
    ],
  },
  {
    name: COLLECTIONS.feedInteractions,
    validator: jsonSchema(["userId", "feedItemId", "action"], {
      userId: objectId,
      feedItemId: objectId,
      action: string,
    }),
    indexes: [
      {
        key: { userId: 1, feedItemId: 1, action: 1 },
        options: { unique: true },
      },
      // Backs the Saved screen (BRD 11.2): {userId, action} sorted newest
      // first. The unique index above can only serve a `userId` prefix.
      { key: { userId: 1, action: 1, createdAt: -1 } },
    ],
  },
  {
    name: COLLECTIONS.dailyQuotes,
    validator: jsonSchema(["text", "author", "dateAssigned"], {
      text: string,
      author: string,
      dateAssigned: string,
    }),
    indexes: [{ key: { dateAssigned: 1 }, options: { unique: true } }],
  },
  {
    name: COLLECTIONS.mediaAssets,
    // The database layer, not just the app, enforces BRD 7.14's five eligible
    // rights bases. `source` used to be a plain string, so any value at all
    // could be written and the UI would have had no idea what it was showing.
    //
    // `rightsHolder` is required: "traceable, legitimate source" is not
    // satisfiable without naming who owns the content. Making it required is
    // safe on an existing collection - `collMod` never rescans, and
    // `validationLevel: "moderate"` (see ensureCollection) exempts updates to
    // documents that were already non-conforming.
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["url", "type", "source", "rightsHolder"],
        properties: {
          url: string,
          type: { enum: ["video", "image"] },
          source: {
            enum: [
              "original",
              "generated",
              "licensed",
              "public_domain",
              "placeholder",
            ],
          },
          contributor: {
            enum: ["hoopsync", "coach_trainer", "user", "licensor", "institution"],
          },
          rightsHolder: string,
          attribution: string,
          sourceUrl: string,
          licenseNotes: string,
          durationSeconds: { bsonType: ["int", "long", "double"] },
          rightsClearedAt: { bsonType: "date" },
          rightsClearedBy: objectId,
          uploadedBy: objectId,
        },
        // Content we only have conditional rights to must record the terms.
        // An `original` clip a player filmed needs no licence note; a
        // `licensed` one with no record of its licence is precisely the
        // untraceable content BRD 7.14 exists to prevent.
        allOf: [
          {
            anyOf: [
              { properties: { source: { enum: ["licensed", "public_domain"] } }, required: ["licenseNotes"] },
              { properties: { source: { enum: ["original", "generated", "placeholder"] } } },
            ],
          },
        ],
      },
    },
    indexes: [
      { key: { uploadedBy: 1 } },
      // The admin inventory's default view: uncleared first, newest first.
      { key: { rightsClearedAt: 1, createdAt: -1 } },
    ],
  },
  {
    name: COLLECTIONS.notifications,
    validator: jsonSchema(
      ["userId", "type", "dedupeKey", "title", "body", "href"],
      {
        userId: objectId,
        type: string,
        dedupeKey: string,
        title: string,
        body: string,
        href: string,
      },
    ),
    indexes: [
      // The notification list, newest first.
      { key: { userId: 1, createdAt: -1 } },
      // The unread count the app-shell bell renders on every page.
      { key: { userId: 1, readAt: 1 } },
      // At-most-once emission, and the only thing that actually enforces it.
      // Notifications are raised from read paths (Home) and from service
      // choke points that can run concurrently, so two callers routinely race
      // to insert the same nudge; this rejects the loser instead of leaving a
      // duplicate. The key's shape is what encodes "once per day" vs "once
      // ever" - see `dedupeKeyFor` in src/lib/notification-types.ts.
      { key: { userId: 1, dedupeKey: 1 }, options: { unique: true } },
    ],
  },
];

async function ensureCollection(db: Db, spec: CollectionSpec) {
  const existing = await db
    .listCollections({ name: spec.name })
    .toArray();

  if (existing.length === 0) {
    await db.createCollection(
      spec.name,
      spec.validator
        ? { validator: spec.validator, validationLevel: "moderate" }
        : undefined,
    );
    console.log(`  created collection: ${spec.name}`);
  } else if (spec.validator) {
    await db.command({
      collMod: spec.name,
      validator: spec.validator,
      validationLevel: "moderate",
    });
    console.log(`  updated validator: ${spec.name}`);
  } else {
    console.log(`  exists: ${spec.name}`);
  }

  if (spec.indexes?.length) {
    const collection = db.collection(spec.name);
    for (const index of spec.indexes) {
      await collection.createIndex(index.key, index.options);
    }
    console.log(`    ensured ${spec.indexes.length} index(es)`);
  }
}

/** Core init logic, exported separately so it's testable against any Db. */
export async function initializeDatabase(db: Db) {
  for (const spec of SPECS) {
    await ensureCollection(db, spec);
  }
}

async function main() {
  console.log(`Connecting to MongoDB (db: ${process.env.MONGODB_DB_NAME || "hoopsync"})...`);
  const { client, db } = await connectForScript();

  try {
    console.log("Ensuring collections, validators, and indexes:");
    await initializeDatabase(db);
    console.log("\nDatabase initialization complete.");
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Database initialization failed:", err);
    process.exitCode = 1;
  });
}
