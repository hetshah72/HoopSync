import { describe, expect, it } from "vitest";
import {
  generateFeedbackForSession,
  generateShotFeedback,
  headlineFor,
} from "@/lib/shot-feedback";
import { mechanicsDrillSlugs } from "@/lib/shot-mechanics";
import type { ShotZone } from "@/types/db";

/**
 * Per-shot feedback is the most-tapped feedback surface in the app, and BRD
 * 7.6's success criteria apply to *every* piece of feedback - not just the
 * session summary. It used to be two hardcoded sentences.
 */

const SHOTS: {
  id: string;
  zone: ShotZone;
  made: boolean;
  timestampInVideoSeconds: number;
}[] = [
  { id: "s1", zone: "right_wing_3", made: false, timestampInVideoSeconds: 1 },
  { id: "s2", zone: "right_wing_3", made: false, timestampInVideoSeconds: 2 },
  { id: "s3", zone: "right_wing_3", made: true, timestampInVideoSeconds: 3 },
  { id: "s4", zone: "paint", made: true, timestampInVideoSeconds: 4 },
  { id: "s5", zone: "paint", made: true, timestampInVideoSeconds: 5 },
];

describe("headlineFor", () => {
  it("names the result and the zone", () => {
    expect(headlineFor("right_wing_3", false)).toBe("Miss - Right Wing 3");
    expect(headlineFor("paint", true)).toBe("Make - Paint");
  });
});

describe("generateShotFeedback", () => {
  it("gives every shot all four parts", () => {
    for (const shot of SHOTS) {
      const feedback = generateShotFeedback({
        shotId: shot.id,
        zone: shot.zone,
        made: shot.made,
        shots: SHOTS,
      });

      expect(feedback.headline, shot.id).toBe(
        headlineFor(shot.zone, shot.made),
      );
      expect(feedback.observation.trim().length, shot.id).toBeGreaterThan(20);
      expect(feedback.potentialIssue.trim(), shot.id).not.toBe("");
      expect(feedback.correction.trim().length, shot.id).toBeGreaterThan(20);
      expect(feedback.drillSlug.trim(), shot.id).not.toBe("");
      expect(feedback.isSimulated, shot.id).toBe(true);
    }
  });

  it("quotes the shot's real zone tally rather than a canned line", () => {
    const miss = generateShotFeedback({
      shotId: "s1",
      zone: "right_wing_3",
      made: false,
      shots: SHOTS,
    });
    // 1/3 from Right Wing 3 - the player's own logged numbers.
    expect(miss.observation).toContain("1/3");
    expect(miss.observation).toContain("Right Wing 3");
  });

  it("does not attach an invented fault to a shot that went in", () => {
    const make = generateShotFeedback({
      shotId: "s4",
      zone: "paint",
      made: true,
      shots: SHOTS,
    });
    expect(make.observation).toContain("dropped");
    // Still four parts, but the issue is framed as what to watch rather than
    // a fault found in a made shot.
    expect(make.potentialIssue.toLowerCase()).toContain("slip first");
  });

  it("differs between two misses from the same zone in the same session", () => {
    const a = generateShotFeedback({
      shotId: "s1",
      zone: "right_wing_3",
      made: false,
      shots: SHOTS,
    });
    const b = generateShotFeedback({
      shotId: "s2",
      zone: "right_wing_3",
      made: false,
      shots: SHOTS,
    });
    // Same zone, same result, same session - the old implementation returned
    // one identical sentence for both.
    expect(a.potentialIssue).not.toBe(b.potentialIssue);
  });

  it("is deterministic, so a reload never rewrites what a player read", () => {
    const args = {
      shotId: "s1",
      zone: "right_wing_3" as ShotZone,
      made: false,
      shots: SHOTS,
    };
    expect(generateShotFeedback(args)).toEqual(generateShotFeedback(args));
  });

  it("never recommends a drill outside the covered parameter bank", () => {
    // mechanicsDrillSlugs() is what the drill-coverage test checks against the
    // seed, so staying inside it is what keeps "Add Drill" from 404ing.
    const covered = new Set(mechanicsDrillSlugs());
    for (const shot of SHOTS) {
      const feedback = generateShotFeedback({
        shotId: shot.id,
        zone: shot.zone,
        made: shot.made,
        shots: SHOTS,
      });
      expect(covered, shot.id).toContain(feedback.drillSlug);
    }
  });

  it("is not generic", () => {
    const BANNED = ["keep practicing", "good job", "keep it up", "work on it"];
    for (const shot of SHOTS) {
      const feedback = generateShotFeedback({
        shotId: shot.id,
        zone: shot.zone,
        made: shot.made,
        shots: SHOTS,
      });
      const text =
        `${feedback.observation} ${feedback.potentialIssue} ${feedback.correction}`.toLowerCase();
      for (const phrase of BANNED) {
        expect(text, shot.id).not.toContain(phrase);
      }
    }
  });
});

describe("generateFeedbackForSession", () => {
  it("covers every shot, keyed by id", () => {
    const map = generateFeedbackForSession(SHOTS);
    expect(map.size).toBe(SHOTS.length);
    for (const shot of SHOTS) {
      expect(map.get(shot.id)?.headline).toBe(
        headlineFor(shot.zone, shot.made),
      );
    }
  });

  it("matches what the single-shot generator produces", () => {
    const map = generateFeedbackForSession(SHOTS);
    expect(map.get("s1")).toEqual(
      generateShotFeedback({
        shotId: "s1",
        zone: "right_wing_3",
        made: false,
        shots: SHOTS,
      }),
    );
  });
});
