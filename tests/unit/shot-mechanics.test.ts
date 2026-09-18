import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  computeSessionSignals,
  generateFindings,
  MIN_ATTEMPTS_PER_SIDE,
  MIN_SIDE_GAP_POINTS,
  PARAMETER_LABELS,
  type MechanicsShot,
} from "@/lib/shot-mechanics";
import { SHOT_MECHANIC_PARAMETERS, type ShotZone } from "@/types/db";

/**
 * BRD 7.6's success criteria are stated as properties of *a sample of feedback
 * messages* - "a sample of feedback messages all follow the observation ->
 * issue -> correction -> drill pattern", "no feedback message reviewed is
 * generic or non-actionable". That is the shape of an automated assertion, not
 * a doc paragraph, so it lives here.
 *
 * The previous implementation had no unit test at all, which is how a bank of
 * four templates covering four of the nine required parameters survived.
 */

const SESSION = new ObjectId("651111111111111111111111");

function shot(
  zone: ShotZone,
  made: boolean,
  timestampInVideoSeconds = 0,
): MechanicsShot {
  return { zone, made, timestampInVideoSeconds };
}

/** n shots from one zone, the first `makes` of them made. */
function run(
  zone: ShotZone,
  attempts: number,
  makes: number,
  startAt = 0,
): MechanicsShot[] {
  return Array.from({ length: attempts }, (_, i) =>
    shot(zone, i < makes, startAt + i),
  );
}

/**
 * A session deliberately skewed left-strong / right-weak, with enough volume
 * on both sides to clear the sample bar - the exact scenario BRD 7.6's worked
 * example describes.
 */
function lopsidedSession(): MechanicsShot[] {
  return [...run("left_wing_3", 8, 6, 0), ...run("right_wing_3", 8, 1, 100)];
}

describe("computeSessionSignals", () => {
  it("measures the left/right split from mirrored zones only", () => {
    const signals = computeSessionSignals([
      ...run("left_wing_3", 5, 4),
      ...run("right_corner_3", 5, 1),
      // Centre shots belong to neither side and must not be counted into one.
      ...run("top_of_key_3", 6, 6),
      ...run("paint", 4, 4),
    ]);

    expect(signals.side.leftAttempts).toBe(5);
    expect(signals.side.rightAttempts).toBe(5);
    expect(signals.side.leftPct).toBe(80);
    expect(signals.side.rightPct).toBe(20);
    expect(signals.side.weakerSide).toBe("right");
    expect(signals.side.sampleAdequate).toBe(true);
  });

  it("refuses to name a weaker side below the per-side attempt bar", () => {
    const thin = computeSessionSignals([
      ...run("left_wing_3", MIN_ATTEMPTS_PER_SIDE - 1, 4),
      ...run("right_wing_3", MIN_ATTEMPTS_PER_SIDE - 1, 0),
    ]);

    // A four-for-four versus zero-for-four looks dramatic and means nothing.
    expect(thin.side.sampleAdequate).toBe(false);
    expect(thin.side.weakerSide).toBeNull();
  });

  it("refuses to name a weaker side when the gap is inside the noise", () => {
    const close = computeSessionSignals([
      ...run("left_wing_3", 10, 5),
      ...run("right_wing_3", 10, 6),
    ]);

    expect(close.side.sampleAdequate).toBe(true);
    expect(close.side.gapPoints).toBeLessThan(MIN_SIDE_GAP_POINTS);
    expect(close.side.weakerSide).toBeNull();
  });

  it("orders the fatigue split by video timestamp, not by insertion order", () => {
    // Deliberately inserted out of order: strong shots carry late timestamps.
    const signals = computeSessionSignals([
      ...run("top_of_key_3", 6, 0, 500),
      ...run("top_of_key_3", 6, 6, 0),
    ]);

    expect(signals.drift.firstHalfPct).toBe(100);
    expect(signals.drift.secondHalfPct).toBe(0);
    expect(signals.drift.dropPoints).toBe(100);
    expect(signals.drift.sampleAdequate).toBe(true);
  });

  it("tallies only shot types the player actually tagged", () => {
    const signals = computeSessionSignals([
      {
        zone: "top_of_key_3",
        made: true,
        shotType: "catch_and_shoot",
        timestampInVideoSeconds: 1,
      },
      {
        zone: "top_of_key_3",
        made: false,
        shotType: "catch_and_shoot",
        timestampInVideoSeconds: 2,
      },
      {
        zone: "left_mid",
        made: true,
        shotType: "off_dribble",
        timestampInVideoSeconds: 3,
      },
      // Untagged - must not be guessed into a bucket.
      shot("paint", true, 4),
    ]);

    expect(signals.shotTypes).toHaveLength(2);
    expect(signals.dominantShotType).toBe("catch_and_shoot");
    expect(signals.shotTypes.reduce((n, t) => n + t.attempts, 0)).toBe(3);
  });

  it("reports no dominant shot type when the player tagged none", () => {
    const signals = computeSessionSignals(run("paint", 5, 3));
    expect(signals.shotTypes).toEqual([]);
    expect(signals.dominantShotType).toBeNull();
  });
});

describe("generateFindings - BRD 7.6 success criteria", () => {
  const scenarios: { name: string; shots: MechanicsShot[]; focus: ShotZone }[] =
    [
      {
        name: "lopsided left/right session",
        shots: lopsidedSession(),
        focus: "right_wing_3",
      },
      {
        name: "single zone, single shot",
        shots: run("paint", 1, 0),
        focus: "paint",
      },
      {
        name: "perfect session",
        shots: run("free_throw_mid", 12, 12),
        focus: "free_throw_mid",
      },
      {
        name: "scoreless session",
        shots: run("left_corner_3", 9, 0),
        focus: "left_corner_3",
      },
      {
        name: "wide spread across every zone",
        shots: [
          ...run("top_of_key_3", 4, 2),
          ...run("right_wing_3", 4, 1, 50),
          ...run("right_mid", 4, 3, 100),
          ...run("right_corner_3", 4, 2, 150),
          ...run("left_wing_3", 4, 3, 200),
          ...run("left_mid", 4, 1, 250),
          ...run("free_throw_mid", 4, 4, 300),
          ...run("paint", 4, 3, 350),
          ...run("left_corner_3", 4, 0, 400),
        ],
        focus: "left_corner_3",
      },
    ];

  it("covers all nine parameters, in the order BRD 7.6 lists them", () => {
    for (const scenario of scenarios) {
      const findings = generateFindings(
        { sessionId: SESSION, shots: scenario.shots },
        scenario.focus,
      );
      expect(
        findings.map((f) => f.parameter),
        scenario.name,
      ).toEqual([...SHOT_MECHANIC_PARAMETERS]);
    }
  });

  it("gives every finding all four parts, on every scenario", () => {
    for (const scenario of scenarios) {
      const findings = generateFindings(
        { sessionId: SESSION, shots: scenario.shots },
        scenario.focus,
      );

      for (const finding of findings) {
        const where = `${scenario.name} / ${finding.parameter}`;
        expect(finding.observation.trim().length, where).toBeGreaterThan(20);
        expect(finding.potentialIssue.trim().length, where).toBeGreaterThan(5);
        expect(finding.correction.trim().length, where).toBeGreaterThan(20);
        expect(finding.drillSlug.trim(), where).not.toBe("");
        expect(finding.referenceStandard.trim().length, where).toBeGreaterThan(
          20,
        );
      }
    }
  });

  it("produces no generic or non-actionable feedback", () => {
    // The phrasings BRD 7.6 calls out by name, plus the usual filler that
    // creeps into coaching copy.
    const BANNED = [
      "keep practicing",
      "keep working",
      "keep it up",
      "good job",
      "nice work",
      "stay focused",
      "you got this",
      "practice makes perfect",
      "work on it",
      "try harder",
      "keep shooting",
    ];

    for (const scenario of scenarios) {
      const findings = generateFindings(
        { sessionId: SESSION, shots: scenario.shots },
        scenario.focus,
      );

      for (const finding of findings) {
        const text =
          `${finding.observation} ${finding.potentialIssue} ${finding.correction}`.toLowerCase();
        for (const phrase of BANNED) {
          expect(text, `${scenario.name} / ${finding.parameter}`).not.toContain(
            phrase,
          );
        }
        expect(text).not.toContain("!");
      }
    }
  });

  it("is deterministic - the same session never rewrites what a player already read", () => {
    const input = { sessionId: SESSION, shots: lopsidedSession() };
    expect(generateFindings(input, "right_wing_3")).toEqual(
      generateFindings(input, "right_wing_3"),
    );
  });

  it("varies between sessions rather than printing one fixed report", () => {
    const shots = lopsidedSession();
    const a = generateFindings({ sessionId: SESSION, shots }, "right_wing_3");
    const b = generateFindings(
      { sessionId: new ObjectId("652222222222222222222222"), shots },
      "right_wing_3",
    );

    const differing = a.filter(
      (finding, i) => finding.potentialIssue !== b[i].potentialIssue,
    );
    expect(differing.length).toBeGreaterThan(0);
  });
});

describe("generateFindings - the honesty bar", () => {
  it("marks the left/right finding measured, and quotes the real split", () => {
    const findings = generateFindings(
      { sessionId: SESSION, shots: lopsidedSession() },
      "right_wing_3",
    );
    const side = findings.find((f) => f.parameter === "side_to_side")!;

    expect(side.basis).toBe("measured");
    // 6/8 left = 75%, 1/8 right = 12.5%. Both must appear verbatim: this is
    // the player's own data, and a measured claim that rounds it away is no
    // longer measured.
    expect(side.observation).toContain("6/8");
    expect(side.observation).toContain("1/8");
    expect(side.observation).toContain("75%");
    expect(side.observation).toContain("12.5%");
  });

  it("falls back to a simulated observation when the sides are too thin to compare", () => {
    const findings = generateFindings(
      { sessionId: SESSION, shots: run("left_wing_3", 3, 1) },
      "left_wing_3",
    );
    const side = findings.find((f) => f.parameter === "side_to_side")!;

    // The honest answer to "is one side worse?" on three shots is silence,
    // not a confident claim badged as measured.
    expect(side.basis).toBe("simulated");
  });

  it("never marks a parameter measured that no logged shot can evidence", () => {
    // Elbow, wrist, pocket, arc and landing are invisible to tap-to-log. A
    // "measured" badge on any of them would be a straight fabrication.
    const invisible = [
      "wrist_loading",
      "elbow_alignment",
      "release_timing",
      "shooting_pocket",
      "follow_through_arc",
      "landing_position",
    ] as const;

    const findings = generateFindings(
      { sessionId: SESSION, shots: lopsidedSession() },
      "right_wing_3",
    );

    for (const parameter of invisible) {
      const finding = findings.find((f) => f.parameter === parameter)!;
      expect(finding.basis, parameter).toBe("simulated");
    }
  });

  it("pins the reference standard to the shot type the player actually tagged", () => {
    const tagged: MechanicsShot[] = Array.from({ length: 6 }, (_, i) => ({
      zone: "free_throw_mid",
      made: i < 3,
      shotType: "free_throw",
      timestampInVideoSeconds: i,
    }));

    const findings = generateFindings(
      { sessionId: SESSION, shots: tagged },
      "free_throw_mid",
    );
    const timing = findings.find((f) => f.parameter === "release_timing")!;

    expect(timing.referenceShotType).toBe("free_throw");
    expect(timing.referenceStandard.toLowerCase()).toContain("free throw");
  });

  it("uses the general standard when no shot type was tagged", () => {
    const findings = generateFindings(
      { sessionId: SESSION, shots: run("free_throw_mid", 6, 3) },
      "free_throw_mid",
    );
    for (const finding of findings) {
      expect(finding.referenceShotType).toBe("general");
    }
  });
});

describe("PARAMETER_LABELS", () => {
  it("labels every parameter", () => {
    for (const parameter of SHOT_MECHANIC_PARAMETERS) {
      expect(PARAMETER_LABELS[parameter]?.trim()).toBeTruthy();
    }
  });
});
