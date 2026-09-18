import { describe, expect, it } from "vitest";
import {
  hashPassword,
  spendFailedVerificationCost,
  verifyPassword,
} from "@/lib/password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const hash = await hashPassword("correct-horse-1");
    await expect(verifyPassword("correct-horse-1", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse-1");
    await expect(verifyPassword("correct-horse-2", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("never stores the password, and salts every hash separately", async () => {
    const first = await hashPassword("correct-horse-1");
    const second = await hashPassword("correct-horse-1");

    expect(first).not.toContain("correct-horse-1");
    // Same input, different salt - so a stolen dump can't be attacked once
    // for every account that shares a password.
    expect(first).not.toEqual(second);
    await expect(verifyPassword("correct-horse-1", second)).resolves.toBe(true);
  });

  it("records the cost parameters it used, so they can be raised later", async () => {
    const [scheme, n, r, p, salt, key] = (
      await hashPassword("correct-horse-1")
    ).split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
    expect(salt.length).toBeGreaterThan(0);
    expect(key.length).toBeGreaterThan(0);
  });

  it("verifies a hash written with different cost parameters", async () => {
    // Exactly what an old record looks like after the constants are raised:
    // the stored parameters must win, or every existing player is locked out.
    const cheap = "scrypt$1024$8$1$" + Buffer.from("salty-salt").toString("base64");
    const { scrypt } = await import("node:crypto");
    const derived = await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        "correct-horse-1",
        Buffer.from("salty-salt"),
        64,
        { N: 1024, r: 8, p: 1 },
        (err, key) => (err ? reject(err) : resolve(key)),
      ),
    );
    const stored = `${cheap}$${derived.toString("base64")}`;

    await expect(verifyPassword("correct-horse-1", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong", stored)).resolves.toBe(false);
  });

  it("returns false rather than throwing on a corrupt stored value", async () => {
    for (const corrupt of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfourparts",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$aGFzaA==",
    ]) {
      await expect(verifyPassword("correct-horse-1", corrupt)).resolves.toBe(
        false,
      );
    }
  });

  it("spends real work when there is no account to check against", async () => {
    // The point of the helper is that it is *not* a fast path - a quick
    // "no such user" is what lets an attacker enumerate addresses.
    const started = Date.now();
    await spendFailedVerificationCost("correct-horse-1");
    expect(Date.now() - started).toBeGreaterThan(5);
  });
});
