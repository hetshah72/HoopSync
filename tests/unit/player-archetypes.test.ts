import { describe, expect, it } from "vitest";
import {
  PLAYER_ARCHETYPES,
  PLAYER_ARCHETYPE_KEYS,
  archetypeDrillSlugs,
  archetypeFor,
  classifyArchetype,
  normalizePositionGroup,
} from "@/lib/player-archetypes";

describe("normalizePositionGroup", () => {
  it.each([
    // balldontlie abbreviation forms, which is what a real roster sync writes
    ["G", "guard"],
    ["PG", "guard"],
    ["SG", "guard"],
    ["F", "wing"],
    ["SF", "wing"],
    ["G-F", "wing"],
    ["F-G", "wing"],
    ["C", "big"],
    ["F-C", "big"],
    ["C-F", "big"],
    // full-name forms, which is what our own editorial seed writes
    ["Point Guard", "guard"],
    ["Shooting Guard", "guard"],
    ["Small Forward", "wing"],
    ["Power Forward", "big"],
    ["Center", "big"],
    ["Guard-Forward", "wing"],
    // casing and whitespace shouldn't matter
    ["  point guard  ", "guard"],
    ["center", "big"],
  ])("maps %s to %s", (position, expected) => {
    expect(normalizePositionGroup(position)).toBe(expected);
  });

  it("falls back to unknown for missing or unrecognized positions", () => {
    expect(normalizePositionGroup(undefined)).toBe("unknown");
    expect(normalizePositionGroup(null)).toBe("unknown");
    expect(normalizePositionGroup("")).toBe("unknown");
    expect(normalizePositionGroup("   ")).toBe("unknown");
    expect(normalizePositionGroup("Unknown")).toBe("unknown");
  });
});

describe("classifyArchetype", () => {
  it("splits guards on the 6'4\" boundary", () => {
    expect(classifyArchetype({ position: "G", heightInches: 75 })).toBe("lead_guard");
    expect(classifyArchetype({ position: "G", heightInches: 76 })).toBe("combo_guard");
  });

  it("splits wings on the 6'8\" boundary", () => {
    expect(classifyArchetype({ position: "G-F", heightInches: 79 })).toBe(
      "wing_scorer",
    );
    expect(classifyArchetype({ position: "G-F", heightInches: 80 })).toBe(
      "point_forward",
    );
  });

  it("splits bigs on the 6'11\" boundary", () => {
    expect(classifyArchetype({ position: "C", heightInches: 82 })).toBe("stretch_big");
    expect(classifyArchetype({ position: "C", heightInches: 83 })).toBe(
      "interior_big",
    );
  });

  it("classifies on position alone when height is unknown", () => {
    // A roster record with no height still has to land somewhere real - the
    // smaller archetype in each group is the safer default.
    expect(classifyArchetype({ position: "G" })).toBe("lead_guard");
    expect(classifyArchetype({ position: "F" })).toBe("wing_scorer");
    expect(classifyArchetype({ position: "C" })).toBe("stretch_big");
  });

  it("falls back to all_around when the position is unusable", () => {
    expect(classifyArchetype({ position: undefined, heightInches: 78 })).toBe(
      "all_around",
    );
    expect(classifyArchetype({ position: "Unknown" })).toBe("all_around");
  });

  it("is deterministic - the same input always yields the same archetype", () => {
    const input = { position: "F-C", heightInches: 84 };
    const first = classifyArchetype(input);
    for (let i = 0; i < 10; i++) {
      expect(classifyArchetype(input)).toBe(first);
    }
  });
});

describe("archetypeFor", () => {
  it("returns the all_around pack for a missing or unknown key", () => {
    expect(archetypeFor(undefined).key).toBe("all_around");
    expect(archetypeFor(null).key).toBe("all_around");
  });

  it("returns the matching pack for every declared key", () => {
    for (const key of PLAYER_ARCHETYPE_KEYS) {
      expect(archetypeFor(key).key).toBe(key);
    }
  });
});

describe("archetype pack content", () => {
  // BRD 7.4: "Every player profile must include at least one Signature Move
  // write-up with a matching drill." Archetype packs are how that holds
  // across the whole roster, so an empty pack would silently break it.
  it.each(PLAYER_ARCHETYPE_KEYS)(
    "%s carries at least one signature move with every BRD-required field",
    (key) => {
      const archetype = PLAYER_ARCHETYPES[key];
      expect(archetype.signatureMoves.length).toBeGreaterThan(0);

      for (const move of archetype.signatureMoves) {
        expect(move.id).toBeTruthy();
        expect(move.name).toBeTruthy();
        expect(move.whatItIs).toBeTruthy();
        expect(move.whenUsed).toBeTruthy();
        expect(move.whatMakesItEffective).toBeTruthy();
        expect(move.keyMechanics.length).toBeGreaterThan(0);
        expect(move.commonMistakes.length).toBeGreaterThan(0);
        expect(move.drillSlug).toBeTruthy();
      }
    },
  );

  it.each(PLAYER_ARCHETYPE_KEYS)("%s has Learn content for all three prompts", (key) => {
    const { learn } = PLAYER_ARCHETYPES[key];
    expect(learn.whatTheyDoWell).toBeTruthy();
    expect(learn.howTheyPlay).toBeTruthy();
    expect(learn.whatToWatchFor).toBeTruthy();
  });

  it.each(PLAYER_ARCHETYPE_KEYS)("%s has study-clip call-outs with real timestamps", (key) => {
    const callouts = PLAYER_ARCHETYPES[key].studyClipCallouts;
    expect(callouts.length).toBeGreaterThan(0);
    for (const callout of callouts) {
      expect(callout.atSeconds).toBeGreaterThanOrEqual(0);
      expect(callout.label).toBeTruthy();
      expect(callout.text).toBeTruthy();
    }
  });

  it.each(PLAYER_ARCHETYPE_KEYS)("%s rates all six skills within 0-100", (key) => {
    const skills = PLAYER_ARCHETYPES[key].skills;
    const values = Object.values(skills);
    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("uses globally unique signature-move ids", () => {
    // startWorkoutFromSignatureMove looks a move up by id within a player's
    // resolved profile; duplicates across packs would make a collision
    // possible the moment two packs are ever merged.
    const ids = PLAYER_ARCHETYPE_KEYS.flatMap((key) =>
      PLAYER_ARCHETYPES[key].signatureMoves.map((move) => move.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("archetypeDrillSlugs", () => {
  it("returns every referenced slug, deduplicated and sorted", () => {
    const slugs = archetypeDrillSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual(slugs);
  });
});
