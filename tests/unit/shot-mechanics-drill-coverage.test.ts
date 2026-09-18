import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { generateFindings, mechanicsDrillSlugs } from "@/lib/shot-mechanics";
import {
  allReferenceStandards,
  referenceStandardFor,
} from "@/lib/shot-reference-standards";
import { SHOT_MECHANIC_PARAMETERS, SHOT_TYPES } from "@/types/db";
import { DRILLS } from "../../scripts/db/seed";

/**
 * The load-bearing guarantee behind BRD 7.6's parameter list.
 *
 * Every finding ends in a drill, and the service resolves that drill by slug.
 * A slug with no seeded drill behind it degrades to a finding whose "add this
 * drill" action goes nowhere - the same silent failure
 * tests/unit/archetype-drill-coverage.test.ts exists to prevent for signature
 * moves. This test is what makes it loud instead.
 */
describe("shot mechanics drill coverage", () => {
  const seededSlugs = new Set(DRILLS.map((drill) => drill.slug));

  it("seeds a drill for every slug the parameter bank can recommend", () => {
    const missing = mechanicsDrillSlugs().filter(
      (slug) => !seededSlugs.has(slug),
    );
    expect(missing).toEqual([]);
  });

  it("recommends a shooting drill for every one of the nine parameters", () => {
    const bySlug = new Map(DRILLS.map((drill) => [drill.slug, drill]));
    const findings = generateFindings(
      {
        sessionId: new ObjectId("653333333333333333333333"),
        shots: [
          { zone: "left_wing_3", made: true, timestampInVideoSeconds: 1 },
          { zone: "right_wing_3", made: false, timestampInVideoSeconds: 2 },
        ],
      },
      "right_wing_3",
    );

    expect(findings).toHaveLength(SHOT_MECHANIC_PARAMETERS.length);
    for (const finding of findings) {
      const drill = bySlug.get(finding.drillSlug);
      expect(
        drill,
        `${finding.parameter} -> ${finding.drillSlug}`,
      ).toBeDefined();
      // A shooting-form fix handed a defensive-slide drill would be worse than
      // no drill at all.
      expect(drill!.skillTags, finding.parameter).toContain("shooting");
    }
  });

  it("reaches the shooting drills that were previously unreachable from Analyze", () => {
    // Before 7.6 the template bank referenced three slugs total, stranding
    // these - they were seeded, shooting-tagged, and no analysis could ever
    // recommend them.
    const slugs = mechanicsDrillSlugs();
    for (const slug of [
      "relocation-catch-and-shoot",
      "step-back-separation",
      "pick-and-pop-trail-three",
    ]) {
      expect(slugs).toContain(slug);
    }
  });
});

describe("shot mechanics reference standards", () => {
  it("authors a general standard for every parameter", () => {
    for (const parameter of SHOT_MECHANIC_PARAMETERS) {
      const standard = referenceStandardFor(parameter);
      expect(standard.parameter).toBe(parameter);
      expect(standard.shotType).toBe("general");
      expect(standard.standard.trim().length).toBeGreaterThan(20);
    }
  });

  it("resolves a standard for every parameter and shot-type combination", () => {
    for (const parameter of SHOT_MECHANIC_PARAMETERS) {
      for (const shotType of SHOT_TYPES) {
        const standard = referenceStandardFor(parameter, shotType);
        expect(standard.parameter).toBe(parameter);
        // Either a standard written for that shot type, or the general
        // fallback - never nothing, and never another parameter's.
        expect([shotType, "general"]).toContain(standard.shotType);
      }
    }
  });

  it("ships no reference clip until a league licence exists (BRD 6.4/7.14)", () => {
    // `referenceClipUrl` is the swap point, exactly as `playerImageUrl` is for
    // player imagery. A populated one here would mean footage entered the repo
    // ahead of the rights to use it.
    for (const standard of allReferenceStandards()) {
      expect(standard.referenceClipUrl).toBeUndefined();
    }
  });

  it("describes form rather than naming a player", () => {
    // The archetype rule, applied here: a standard is a coaching benchmark,
    // never film study of a named person.
    for (const standard of allReferenceStandards()) {
      expect(standard.standard).not.toMatch(
        /\b(Curry|LeBron|Durant|Jordan|Kobe)\b/i,
      );
    }
  });
});
