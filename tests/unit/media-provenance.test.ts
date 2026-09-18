import { describe, expect, it } from "vitest";
import {
  MEDIA_SOURCE_LABELS,
  disclosureFor,
  mediaContributor,
} from "@/lib/media-provenance";
import type { MediaAssetSource } from "@/types/db";

const ALL_SOURCES: MediaAssetSource[] = [
  "original",
  "generated",
  "licensed",
  "public_domain",
  "placeholder",
];

describe("disclosureFor", () => {
  it("labels every rights basis - no source can render unlabelled", () => {
    for (const source of ALL_SOURCES) {
      const disclosure = disclosureFor({ source });
      expect(disclosure.sourceLabel).toBe(MEDIA_SOURCE_LABELS[source]);
      expect(disclosure.sourceLabel.length).toBeGreaterThan(0);
    }
  });

  it("says placeholder footage is a stand-in, which is BRD 6.4's whole bargain", () => {
    const disclosure = disclosureFor({ source: "placeholder" });
    expect(disclosure.isPlaceholder).toBe(true);
    expect(disclosure.note).toMatch(/stand-in/i);
    expect(disclosure.note).toMatch(/licence/i);
  });

  it("never marks non-placeholder content as a placeholder", () => {
    for (const source of ALL_SOURCES.filter((s) => s !== "placeholder")) {
      expect(disclosureFor({ source }).isPlaceholder).toBe(false);
    }
  });

  it("says a generated demo is not a real player", () => {
    expect(disclosureFor({ source: "generated" }).note).toMatch(/not footage of a real player/i);
  });

  it("adds no disclaimer to a player's own footage", () => {
    // Nagging a player about the provenance of their own clip would be noise,
    // and there is nothing to disclose.
    const disclosure = disclosureFor({ source: "original", contributor: "user" });
    expect(disclosure.note).toBeNull();
    expect(disclosure.attribution).toBeNull();
  });

  it("credits an outside rights holder", () => {
    expect(
      disclosureFor({
        source: "licensed",
        contributor: "licensor",
        rightsHolder: "Example Media",
      }).attribution,
    ).toBe("Courtesy of Example Media");
  });

  it("prefers an explicit attribution over the derived courtesy line", () => {
    expect(
      disclosureFor({
        source: "licensed",
        contributor: "licensor",
        rightsHolder: "Example Media",
        attribution: "© 2026 Example Media, used under licence",
      }).attribution,
    ).toBe("© 2026 Example Media, used under licence");
  });

  it("does not credit HoopSync to itself on its own content", () => {
    expect(
      disclosureFor({
        source: "generated",
        contributor: "hoopsync",
        rightsHolder: "HoopSync",
      }).attribution,
    ).toBeNull();
  });

  it("credits a coach's clip, because the coach is not HoopSync", () => {
    expect(
      disclosureFor({
        source: "licensed",
        contributor: "coach_trainer",
        rightsHolder: "Coach Dana Reyes",
      }).attribution,
    ).toBe("Courtesy of Coach Dana Reyes");
  });
});

describe("mediaContributor", () => {
  it("reads rows written before the contributor axis as HoopSync's own", () => {
    // Defaulting the other way would attribute HoopSync's seeded material to
    // a third party that never supplied it.
    expect(mediaContributor({})).toBe("hoopsync");
  });

  it("does not override a contributor that was recorded", () => {
    expect(mediaContributor({ contributor: "coach_trainer" })).toBe("coach_trainer");
  });
});
