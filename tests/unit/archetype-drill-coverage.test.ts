import { describe, expect, it } from "vitest";
import { archetypeDrillSlugs } from "@/lib/player-archetypes";
import { DRILLS } from "../../scripts/db/seed";

/**
 * The load-bearing guarantee behind full-roster coverage.
 *
 * BRD 7.4: "Every player profile must include at least one Signature Move
 * write-up with a matching drill." For the ~570 players with no hand-authored
 * content, the signature moves come from their archetype pack, and those
 * moves reference drills by slug. playerEditorialService deliberately *drops*
 * any move whose drill isn't in the library rather than rendering a button
 * that 404s - which means a typo'd or unseeded slug degrades silently into a
 * profile with no signature move at all.
 *
 * This test is what makes that failure loud instead.
 */
describe("archetype drill coverage", () => {
  const seededSlugs = new Set(DRILLS.map((drill) => drill.slug));

  it("seeds a drill for every slug the archetype packs reference", () => {
    const missing = archetypeDrillSlugs().filter((slug) => !seededSlugs.has(slug));
    expect(missing).toEqual([]);
  });

  it("has no duplicate slugs in the drill library", () => {
    // seedDrills upserts by slug, so a duplicate would mean one definition
    // silently overwrites the other depending on array order.
    expect(seededSlugs.size).toBe(DRILLS.length);
  });

  it("gives every archetype drill real coaching cues and a skill tag", () => {
    const archetypeSlugs = new Set(archetypeDrillSlugs());
    const archetypeDrills = DRILLS.filter((drill) => archetypeSlugs.has(drill.slug));

    expect(archetypeDrills.length).toBe(archetypeSlugs.size);
    for (const drill of archetypeDrills) {
      expect(drill.name).toBeTruthy();
      expect(drill.description).toBeTruthy();
      expect(drill.skillTags.length).toBeGreaterThan(0);
      expect(drill.coachingCues.length).toBeGreaterThan(0);
    }
  });
});
