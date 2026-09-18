import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for email/password accounts.
 *
 * Uses scrypt from Node's standard library rather than pulling in bcrypt or
 * argon2: it is a memory-hard KDF designed for exactly this, and it ships
 * with the runtime, so there's no native build step and no extra dependency
 * to keep patched.
 *
 * Lives in `src/lib` because `scripts/db/seed.ts` needs to hash the demo
 * account's password and scripts cannot import `@/server/**` (see CLAUDE.md).
 * Unlike the rest of `src/lib` this is **not** client-safe - it imports
 * `node:crypto` - but nothing outside the server and the db scripts has any
 * reason to touch it, and a password must never be hashed in a browser.
 *
 * Stored form - self-describing, so the cost parameters can be raised later
 * without invalidating a single existing password:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<derived key base64>
 *
 * `verifyPassword` reads the parameters back out of the stored string, so an
 * old hash keeps verifying with the cost it was written at while new hashes
 * use whatever the constants below say today.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** Cost of a *new* hash. Raising these is safe (see the format note above). */
const N = 16384; // CPU/memory cost - 2^14, ~16MB of working memory.
const R = 8; // Block size.
const P = 1; // Parallelization.
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const PREFIX = "scrypt";

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(normalize(plain), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
  });
  return [
    PREFIX,
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time comparison of a candidate password against a stored hash.
 *
 * Returns false - never throws - for a malformed or unrecognized stored
 * value, so a corrupt record fails the sign-in rather than the request.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  const derived = await scryptAsync(
    normalize(plain),
    parsed.salt,
    parsed.hash.length,
    { N: parsed.N, r: parsed.r, p: parsed.p },
  ).catch(() => null);
  if (!derived) return false;

  // Lengths are equal by construction (keylen is taken from the stored hash),
  // but timingSafeEqual throws on a mismatch, so guard rather than trust it.
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/**
 * Burns the same work a real verification costs, then reports failure.
 *
 * Called when sign-in finds no account (or an account with no password) for
 * the submitted email. Without it, "no such user" would answer noticeably
 * faster than "wrong password", turning the sign-in form into an oracle for
 * which emails have accounts here - which for a platform whose users are
 * minors is a disclosure worth paying ~100ms to avoid.
 */
export async function spendFailedVerificationCost(
  plain: string,
): Promise<void> {
  await verifyPassword(plain, await decoyHash());
}

/**
 * A hash of a value nobody can submit, computed once per process and reused.
 * Generated rather than hard-coded so it can never be recognized in source
 * and short-circuited by a caller.
 */
let decoyHashPromise: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  decoyHashPromise ??= hashPassword(randomBytes(32).toString("hex"));
  return decoyHashPromise;
}

/**
 * Unicode-normalize before hashing. The same typed password can arrive with
 * accented characters composed differently depending on the keyboard or OS
 * used, which would otherwise hash to two different values and lock a player
 * out of their own account on a second device.
 */
function normalize(plain: string): string {
  return plain.normalize("NFKC");
}

function parse(stored: string): {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
} | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;

  const [prefix, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (prefix !== PREFIX) return null;

  const parsedN = Number(rawN);
  const parsedR = Number(rawR);
  const parsedP = Number(rawP);
  if (![parsedN, parsedR, parsedP].every(Number.isSafeInteger)) return null;
  if (parsedN < 2 || parsedR < 1 || parsedP < 1) return null;

  const salt = Buffer.from(rawSalt, "base64");
  const hash = Buffer.from(rawHash, "base64");
  if (salt.length === 0 || hash.length === 0) return null;

  return { N: parsedN, r: parsedR, p: parsedP, salt, hash };
}
