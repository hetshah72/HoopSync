import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/server/lib/rateLimiter";

function uniqueKey(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

describe("checkRateLimit", () => {
  it("allows calls up to the limit within the window", () => {
    const key = uniqueKey();
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
  });

  it("throws once the limit is exceeded within the window", () => {
    const key = uniqueKey();
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    expect(() => checkRateLimit(key, 2, 60_000)).toThrow();
  });

  it("resets the count after the window elapses", async () => {
    const key = uniqueKey();
    checkRateLimit(key, 1, 20);
    expect(() => checkRateLimit(key, 1, 20)).toThrow();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(() => checkRateLimit(key, 1, 20)).not.toThrow();
  });

  it("tracks separate keys independently", () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    checkRateLimit(keyA, 1, 60_000);
    expect(() => checkRateLimit(keyA, 1, 60_000)).toThrow();
    expect(() => checkRateLimit(keyB, 1, 60_000)).not.toThrow();
  });
});
