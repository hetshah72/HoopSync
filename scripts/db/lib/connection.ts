import { config as loadEnv } from "dotenv";
import { MongoClient, type Db } from "mongodb";

// Mirror Next.js's env file precedence for local dev: .env.local overrides
// .env. Scripts run outside Next's runtime, so this has to be done manually.
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

/**
 * Standalone MongoDB connection for db scripts (init/seed), intentionally
 * separate from src/server/db/client.ts (the app runtime's cached
 * connection). Scripts run once via `tsx` and exit - they don't need
 * dev-hot-reload caching, and keeping them separate means the app's runtime
 * module never gets pulled into a script execution context or vice versa.
 */
export async function connectForScript(): Promise<{
  client: MongoClient;
  db: Db;
}> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI. Copy .env.example to .env.local and set it before running db scripts.",
    );
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "hoopsync");
  return { client, db };
}
