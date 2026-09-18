import { describe, expect, it } from "vitest";
import {
  hashKey,
  orderDeterministically,
  pickDeterministic,
} from "@/lib/deterministic";

describe("hashKey", () => {
  it("is stable for the same input", () => {
    expect(hashKey("user:2026-09-14")).toBe(hashKey("user:2026-09-14"));
  });

  it("differs for different inputs", () => {
    expect(hashKey("user:2026-09-14")).not.toBe(hashKey("user:2026-09-15"));
  });

  it("stays a non-negative integer, so it is safe to modulo", () => {
    for (const key of ["", "a", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "🏀"]) {
      const hash = hashKey(key);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("pickDeterministic", () => {
  const items = ["a", "b", "c", "d"];

  it("returns the same element for the same key", () => {
    expect(pickDeterministic(items, "k")).toBe(pickDeterministic(items, "k"));
  });

  it("returns undefined for an empty list rather than throwing", () => {
    expect(pickDeterministic([], "k")).toBeUndefined();
  });

  it("spreads across the options as the key changes", () => {
    const seen = new Set(
      Array.from({ length: 50 }, (_, i) => pickDeterministic(items, `key-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("orderDeterministically", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const identify = (item: { id: string }) => item.id;

  it("is a permutation - never drops or duplicates an item", () => {
    const ordered = orderDeterministically(items, "day-1", identify);
    expect(ordered).toHaveLength(items.length);
    expect(ordered.map(identify).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("gives the same order for the same key", () => {
    expect(orderDeterministically(items, "day-1", identify)).toEqual(
      orderDeterministically(items, "day-1", identify),
    );
  });

  it("changes the order across keys, which is what makes the feed change daily", () => {
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) =>
        orderDeterministically(items, `day-${i}`, identify)
          .map(identify)
          .join(""),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("does not mutate the input", () => {
    const original = [...items];
    orderDeterministically(items, "day-1", identify);
    expect(items).toEqual(original);
  });
});
