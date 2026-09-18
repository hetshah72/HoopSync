import { describe, expect, it } from "vitest";
import { formatHeight, initials } from "@/lib/format";

describe("formatHeight", () => {
  it("formats inches as feet'inches\"", () => {
    expect(formatHeight(78)).toBe(`6'6"`);
    expect(formatHeight(74)).toBe(`6'2"`);
  });

  it("returns an em dash when height is unknown", () => {
    expect(formatHeight(undefined)).toBe("—");
    expect(formatHeight(0)).toBe("—");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Stephen Curry")).toBe("SC");
    expect(initials("Paul George")).toBe("PG");
  });

  it("handles a single-word name", () => {
    expect(initials("Zion")).toBe("Z");
  });
});
