import { describe, expect, it } from "vitest";
import { generateDrillVariants } from "@/lib/drill-library";
import { SHOT_ZONES } from "@/lib/shot-zones";
import { EQUIPMENT_OPTIONS, SKILL_CATEGORIES } from "@/lib/validation/onboarding";

const variants = generateDrillVariants();

/**
 * The generated catalogue (BRD 6.2's ~1,000-drill target).
 *
 * These assertions exist because a generated catalogue is exactly the kind of
 * thing that quietly rots into nonsense - duplicate slugs that silently
 * collapse on upsert, equipment the onboarding form can't express, a variant
 * claiming descent from a drill that doesn't exist. Volume is only worth
 * having if every row is usable.
 */
describe("generateDrillVariants", () => {
  it("reaches the BRD's ~1,000-drill target alongside the authored core", () => {
    // 24 authored drills live in the seed script; these are the rest.
    expect(variants.length).toBeGreaterThanOrEqual(976);
  });

  it("gives every drill a unique slug", () => {
    // Slug is the upsert key - a collision would silently overwrite a drill
    // rather than add one, so the catalogue would be smaller than it claims.
    const slugs = variants.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("is deterministic, so re-seeding is a no-op rather than churn", () => {
    expect(generateDrillVariants().map((d) => d.slug)).toEqual(
      variants.map((d) => d.slug),
    );
  });

  it("gives every drill real, renderable content", () => {
    for (const drill of variants) {
      expect(drill.slug).toMatch(/^[a-z0-9-]+$/);
      expect(drill.name.trim().length).toBeGreaterThan(0);
      // Long enough to actually tell a player what the rep is.
      expect(drill.description.trim().length).toBeGreaterThan(40);
      expect(drill.coachingCues.length).toBeGreaterThan(0);
      for (const cue of drill.coachingCues) {
        expect(cue.trim().length).toBeGreaterThan(0);
      }
      expect(drill.skillTags.length).toBeGreaterThan(0);
    }
  });

  it("only uses skills and equipment the rest of the app can express", () => {
    // Workout generation filters on both, so a drill tagged with anything
    // outside these vocabularies is a drill no player can ever be given.
    for (const drill of variants) {
      for (const skill of drill.skillTags) {
        expect(SKILL_CATEGORIES).toContain(skill);
      }
      for (const item of drill.equipmentNeeded) {
        expect(EQUIPMENT_OPTIONS).toContain(item);
      }
    }
  });

  it("labels every variant with the authored drill it came from", () => {
    // The honesty mechanism: the catalogue reaches ~1,000 by varying a core,
    // and each row says so rather than posing as an unrelated drill.
    for (const drill of variants) {
      expect(drill.variantOf, drill.slug).toBeTruthy();
    }
  });

  it("covers all seven skill categories", () => {
    const covered = new Set(variants.flatMap((d) => d.skillTags));
    for (const skill of SKILL_CATEGORIES) {
      expect(covered, `no drills for ${skill}`).toContain(skill);
    }
  });

  it("offers a drill for every shot zone, so weak-zone targeting always resolves", () => {
    // The point of `targetZone`: a player whose chart flags Left Corner 3 gets
    // a drill for that spot, not a generic shooting drill.
    const byZone = new Map<string, number>();
    for (const drill of variants) {
      if (drill.targetZone) {
        byZone.set(drill.targetZone, (byZone.get(drill.targetZone) ?? 0) + 1);
      }
    }
    for (const zone of SHOT_ZONES) {
      expect(byZone.get(zone) ?? 0, `no drills for ${zone}`).toBeGreaterThan(0);
    }
  });

  /**
   * The distribution assertions below are the ones that matter most, and the
   * weaker "at least one beginner drill exists" version of them is what let
   * the first build of this library ship 548 advanced drills against 29
   * beginner ones. A catalogue can hit its headline count and still be
   * unusable for the players most likely to open the app.
   */
  it("gives every difficulty a genuinely usable pool", () => {
    const counts = new Map<string, number>();
    for (const drill of variants) {
      counts.set(drill.difficulty, (counts.get(drill.difficulty) ?? 0) + 1);
    }
    for (const difficulty of ["beginner", "intermediate", "advanced"]) {
      expect(
        counts.get(difficulty) ?? 0,
        `only ${counts.get(difficulty) ?? 0} ${difficulty} drills`,
      ).toBeGreaterThan(variants.length * 0.08);
    }
  });

  it("keeps a real beginner pool in every skill", () => {
    // A 13-year-old signing up should not be handed an advanced-only
    // catalogue in any skill they might pick as a focus area.
    for (const skill of SKILL_CATEGORIES) {
      const beginner = variants.filter(
        (d) => d.skillTags.includes(skill) && d.difficulty === "beginner",
      );
      expect(
        beginner.length,
        `only ${beginner.length} beginner drills for ${skill}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });
});
