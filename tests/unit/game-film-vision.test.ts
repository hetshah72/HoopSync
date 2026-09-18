import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  describeVisionBasis,
  frameTimestamps,
  parseVisionResponse,
} from "@/lib/game-film-vision";

const FRAMES = [
  { base64: "a", timestampInVideoSeconds: 10 },
  { base64: "b", timestampInVideoSeconds: 20 },
];
const SENT = FRAMES.map((f) => f.timestampInVideoSeconds);

function response(body: Record<string, unknown>): string {
  return JSON.stringify({ usable: true, subjectFound: true, ...body });
}

describe("frameTimestamps", () => {
  it("spreads samples across the clip without hitting either end", () => {
    const stamps = frameTimestamps(60, 3);

    expect(stamps).toHaveLength(3);
    expect(stamps[0]).toBeGreaterThan(0);
    expect(stamps[stamps.length - 1]).toBeLessThan(60);
    // Strictly increasing, so the model sees the clip in order.
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  it("returns nothing for a duration the browser couldn't read", () => {
    expect(frameTimestamps(Number.NaN)).toEqual([]);
    expect(frameTimestamps(0)).toEqual([]);
  });

  it("never asks for more samples than the clip has seconds", () => {
    expect(frameTimestamps(3, 12).length).toBeLessThanOrEqual(3);
  });
});

describe("parseVisionResponse", () => {
  it("keeps events whose timestamps match frames we actually sent", () => {
    const parsed = parseVisionResponse(
      response({
        events: [
          { type: "drive", timestampInVideoSeconds: 20, description: "Drove right." },
        ],
      }),
      SENT,
    );

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].timestampInVideoSeconds).toBe(20);
  });

  it("drops events at timestamps we never sent", () => {
    // The whole point of the guard: a moment the model invented between
    // frames would render as a seekable point in the player's own video and
    // be indistinguishable from one that was really read.
    const parsed = parseVisionResponse(
      response({
        events: [
          { type: "shot", timestampInVideoSeconds: 47, description: "Pull-up." },
          { type: "shot", timestampInVideoSeconds: 10, description: "Catch and shoot." },
        ],
      }),
      SENT,
    );

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].timestampInVideoSeconds).toBe(10);
  });

  it("drops events with an unrecognised type", () => {
    const parsed = parseVisionResponse(
      response({
        events: [
          { type: "dunk_contest", timestampInVideoSeconds: 10, description: "x" },
        ],
      }),
      SENT,
    );

    expect(parsed.events).toEqual([]);
  });

  it("requires a recommendation on every weakness", () => {
    const parsed = parseVisionResponse(
      response({
        weaknesses: [
          { category: "spacing", text: "Drifted in." },
          { category: "drives", text: "One-way.", recommendation: "Go left." },
        ],
      }),
      SENT,
    );

    // A weakness with no fix is not actionable, and BRD 7.7 asks for
    // "opportunities for improvement", not a list of faults.
    expect(parsed.weaknesses).toHaveLength(1);
    expect(parsed.weaknesses[0].category).toBe("drives");
  });

  it("rejects categories outside the BRD's nine", () => {
    const parsed = parseVisionResponse(
      response({ strengths: [{ category: "dribbling_flair", text: "x" }] }),
      SENT,
    );

    expect(parsed.strengths).toEqual([]);
  });

  it("keeps only the first finding per category", () => {
    const parsed = parseVisionResponse(
      response({
        strengths: [
          { category: "spacing", text: "First." },
          { category: "spacing", text: "Second." },
        ],
      }),
      SENT,
    );

    expect(parsed.strengths).toHaveLength(1);
    expect(parsed.strengths[0].text).toBe("First.");
  });

  it("returns nothing at all when the subject wasn't found", () => {
    const parsed = parseVisionResponse(
      JSON.stringify({
        usable: true,
        subjectFound: false,
        strengths: [{ category: "spacing", text: "x" }],
        events: [{ type: "shot", timestampInVideoSeconds: 10, description: "x" }],
      }),
      SENT,
    );

    // Analysing whoever the model latched onto instead would be a report
    // about a stranger, presented to the player as being about them.
    expect(parsed.subjectFound).toBe(false);
    expect(parsed.strengths).toEqual([]);
    expect(parsed.events).toEqual([]);
  });

  it("reports unusable footage with its reason", () => {
    const parsed = parseVisionResponse(
      JSON.stringify({
        usable: false,
        unusableReason: "This is a football match.",
      }),
      SENT,
    );

    expect(parsed.usable).toBe(false);
    expect(parsed.unusableReason).toBe("This is a football match.");
  });

  it("degrades to unusable rather than throwing on unparseable output", () => {
    const parsed = parseVisionResponse("not json at all", SENT);

    expect(parsed.usable).toBe(false);
    expect(parsed.events).toEqual([]);
  });
});

describe("buildUserPrompt", () => {
  it("names the subject when the player told us their jersey", () => {
    const prompt = buildUserPrompt({
      frames: FRAMES,
      subject: { jerseyColor: "red", jerseyNumber: "23" },
    });

    expect(prompt).toMatch(/red jersey/);
    expect(prompt).toMatch(/number 23/);
  });

  it("tells the model to refuse rather than guess when no jersey was given", () => {
    const prompt = buildUserPrompt({ frames: FRAMES });

    expect(prompt).toMatch(/subjectFound to false/);
  });

  it("lists the exact timestamps it is sending", () => {
    const prompt = buildUserPrompt({ frames: FRAMES });

    expect(prompt).toMatch(/10s, 20s/);
  });
});

describe("describeVisionBasis", () => {
  it("says how many frames were read and who was followed", () => {
    expect(describeVisionBasis(12, { jerseyColor: "white", jerseyNumber: "7" })).toMatch(
      /12 frames/,
    );
    expect(describeVisionBasis(12, { jerseyColor: "white" })).toMatch(/white jersey/);
  });

  it("still states the frame count with no subject given", () => {
    expect(describeVisionBasis(5)).toMatch(/5 frames/);
  });
});
