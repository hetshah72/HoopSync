import "server-only";
import { MongoClient } from "mongodb";

declare global {
  var _hoopsyncMongoClientPromise: Promise<MongoClient> | undefined;
}

/** Production cache. Development caches on `globalThis` instead - see below. */
let cachedClientPromise: Promise<MongoClient> | undefined;

/**
 * The connected MongoClient, opened on first use rather than at import.
 *
 * This used to read MONGODB_URI and call connect() at module scope, which
 * meant a missing variable threw while the module was still being *evaluated*.
 * That took down every importer, and `src/proxy.ts` is one of them - its
 * matcher covers every route, so one absent env var 500'd the whole app,
 * including the sign-in and auth error pages whose entire job is to explain
 * what went wrong. Reading it here turns that into an ordinary request-time
 * failure that an error boundary can render.
 *
 * In development, Next.js hot-reloads server modules, which would otherwise
 * open a new connection per reload; caching on `globalThis` survives that. In
 * production each serverless invocation gets its own module scope, so the
 * module-level cache is enough there.
 */
export function getMongoClient(): Promise<MongoClient> {
  const isDev = process.env.NODE_ENV === "development";
  const cached = isDev
    ? globalThis._hoopsyncMongoClientPromise
    : cachedClientPromise;
  if (cached) return cached;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI environment variable. Copy .env.example to .env.local and set it.",
    );
  }

  const promise = new MongoClient(uri).connect();
  if (isDev) globalThis._hoopsyncMongoClientPromise = promise;
  else cachedClientPromise = promise;

  /**
   * Two jobs, both of which the previous version got wrong.
   *
   * Attaching a handler at all means a failed connect is never an *unhandled*
   * rejection - Node exits the process on those by default - so one
   * unreachable database no longer takes the server with it. Callers still
   * receive the original promise, so everyone who actually awaits it still
   * sees the failure.
   *
   * And evicting the cache means the failure isn't replayed forever: without
   * this, one bad connect (a laptop that woke before the VPN did) stays parked
   * on `globalThis` and every later request gets the same rejection until the
   * dev server restarts.
   */
  promise.catch(() => {
    if (isDev) {
      if (globalThis._hoopsyncMongoClientPromise === promise) {
        globalThis._hoopsyncMongoClientPromise = undefined;
      }
    } else if (cachedClientPromise === promise) {
      cachedClientPromise = undefined;
    }
  });

  return promise;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB_NAME || "hoopsync");
}
