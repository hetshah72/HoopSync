import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { getMongoClient } from "@/server/db/client";
import { verifyPasswordCredentials } from "@/server/services/authService";
import { signInSchema } from "@/lib/validation/auth";
import { authConfig } from "@/server/auth/auth.config";

/**
 * The full Auth.js instance: the database-free base from `auth.config.ts` plus
 * everything that needs a database. Everything except `src/proxy.ts` imports
 * from here - see the note in that file for why the proxy doesn't.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  /**
   * Auth.js logs the real cause of every failure server-side and then hands
   * the browser a deliberately vague code, which is right for players and
   * useless while developing. In dev this also prints the callback query on a
   * CallbackRouteError - the one detail that would have identified the
   * "response parameter iss missing" failure straight away.
   */
  debug: process.env.NODE_ENV !== "production",

  /**
   * Passed as a factory, not a promise. The adapter resolves it lazily on each
   * operation, and its own docs call the `Promise<MongoClient>` form "not
   * recommended" - a module-scope connect() that fails becomes an unhandled
   * rejection with nothing attached to catch it.
   */
  adapter: MongoDBAdapter(getMongoClient, {
    databaseName: process.env.MONGODB_DB_NAME || "hoopsync",
  }),

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    /**
     * Email + password. Accounts are created by the sign-up Server Action
     * (`src/server/actions/authActions.ts`), never here - `authorize` only
     * ever checks an existing credential, so a typo'd email at sign-in can't
     * silently mint a second account.
     *
     * Returning `null` is what Auth.js turns into a `CredentialsSignin`
     * error; the service deliberately collapses "unknown email", "no
     * password on this account" and "wrong password" into that one answer.
     */
    Credentials({
      id: "password",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;
        return verifyPasswordCredentials(
          parsed.data.email,
          parsed.data.password,
        );
      },
    }),
  ],
});
