import "server-only";
import { MongoServerError, ObjectId } from "mongodb";
import { usersCollection } from "@/server/db/collections";
import type { Role, UserDoc } from "@/types/db";

/**
 * The `users` collection is owned by @auth/mongodb-adapter for the Google
 * flow, but email/password accounts are created by this app rather than by
 * the adapter - so the reads and writes sign-up and sign-in need live here,
 * behind the same repository boundary as every other collection.
 */

/** Callers must pass an already-normalized (trimmed, lower-cased) email. */
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const collection = await usersCollection();
  return collection.findOne({ email });
}

export async function findUserById(id: ObjectId): Promise<UserDoc | null> {
  const collection = await usersCollection();
  return collection.findOne({ _id: id });
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}

/**
 * Creates an account, or reports that the email is already taken.
 *
 * Returns `null` - rather than throwing - when the unique index on `email`
 * rejects the insert. A caller checks for an existing account first, but two
 * simultaneous sign-ups with the same email both pass that check and only the
 * index can settle it; keeping the duplicate-key code (E11000) in here is
 * what keeps MongoDB specifics out of the service layer.
 */
export async function insertUserIfEmailFree(
  user: NewUser,
): Promise<UserDoc | null> {
  const collection = await usersCollection();
  const doc: UserDoc = {
    _id: new ObjectId(),
    ...user,
    // Matches what the adapter writes for a brand-new user. A password
    // account hasn't proven ownership of the address, so it stays null until
    // something actually verifies it.
    emailVerified: null,
    createdAt: new Date(),
  };

  try {
    await collection.insertOne(doc);
    return doc;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) return null;
    throw err;
  }
}
