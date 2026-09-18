import { describe, expect, it } from "vitest";
import {
  describeSubject,
  provenanceCoachPreamble,
  provenanceDisclosure,
  provenanceOpeningLine,
  provenanceSectionHeadings,
  resolveAnalysisProvenance,
} from "@/lib/game-film-provenance";

/**
 * These assertions exist because four separate surfaces - the report, the
 * upload form, the Coach context block and the Coach opener - all have to tell
 * the player the same true thing about where a review came from. The failure
 * mode this guards is a heuristic review that reads as though someone watched
 * the footage.
 */
describe("resolveAnalysisProvenance", () => {
  it("reads a recorded provenance back", () => {
    expect(resolveAnalysisProvenance({ provenance: "vision_model" })).toBe(
      "vision_model",
    );
    expect(resolveAnalysisProvenance({ provenance: "heuristic" })).toBe(
      "heuristic",
    );
  });

  it("treats a document written before real analysis as heuristic", () => {
    // Defaulting the other way would retroactively relabel every generated
    // report as a real read of the player's footage.
    expect(resolveAnalysisProvenance({})).toBe("heuristic");
  });
});

describe("provenanceDisclosure", () => {
  it("says a vision review was read from frames, and that it can be wrong", () => {
    const { detail } = provenanceDisclosure("vision_model", 12);

    expect(detail).toMatch(/12 frames/);
    expect(detail).toMatch(/misread|second opinion/i);
    // BRD 7.6: never present an uncertain CV conclusion as established fact.
    expect(detail).not.toMatch(/\bmeasured\b(?!.*not)/i);
  });

  it("still works when the frame count wasn't recorded", () => {
    expect(provenanceDisclosure("vision_model").detail).toMatch(/frames/);
  });

  it("states plainly that a heuristic review analysed nothing", () => {
    const { detail } = provenanceDisclosure("heuristic");

    expect(detail).toMatch(/nothing in your video was analysed/i);
    expect(detail).toMatch(/coaching profile/i);
  });
});

describe("provenanceSectionHeadings", () => {
  it("calls vision findings what they are", () => {
    expect(provenanceSectionHeadings("vision_model")).toEqual({
      strengths: "Strengths",
      weaknesses: "Needs work",
    });
  });

  it("frames heuristic findings as patterns to check, not findings", () => {
    // Labelling these "Strengths" would assert something nobody looked for.
    const headings = provenanceSectionHeadings("heuristic");

    expect(headings.strengths).toMatch(/likely|profile/i);
    expect(headings.weaknesses).toMatch(/checking/i);
  });
});

describe("provenanceOpeningLine", () => {
  it("opens a vision conversation as a read, not a verdict", () => {
    const line = provenanceOpeningLine("vision_model");

    expect(line).toMatch(/game film/i);
    expect(line).toMatch(/read rather than a measurement/i);
  });

  it("opens a heuristic conversation by disclaiming the footage", () => {
    const line = provenanceOpeningLine("heuristic");

    expect(line).toMatch(/nothing in the video was analysed/i);
  });
});

describe("provenanceCoachPreamble", () => {
  it("tells the model vision findings are observations to verify", () => {
    const preamble = provenanceCoachPreamble("vision_model", 8);

    expect(preamble).toMatch(/8 frames/);
    expect(preamble).toMatch(/never as measured fact/i);
  });

  it("tells the model a heuristic review observed nothing", () => {
    expect(provenanceCoachPreamble("heuristic")).toMatch(
      /nothing here was detected/i,
    );
  });
});

describe("describeSubject", () => {
  it("renders whichever half of the jersey the player gave", () => {
    expect(describeSubject({ jerseyColor: "red", jerseyNumber: "23" })).toBe(
      "red jersey, #23",
    );
    expect(describeSubject({ jerseyColor: "red" })).toBe("red jersey");
    expect(describeSubject({ jerseyNumber: "23" })).toBe("#23");
  });

  it("returns nothing when the player named no one", () => {
    expect(describeSubject(undefined)).toBeUndefined();
    expect(describeSubject({})).toBeUndefined();
  });
});
