import { describe, expect, it } from "vitest";
import { composeFallbackReply } from "@/lib/coach-fallback";
import { COACH_VOICES, coachVoice, leadWith } from "@/lib/coach-voice";
import type { CoachPersonality } from "@/types/db";

const ALL: CoachPersonality[] = [
  "encouraging",
  "balanced",
  "direct",
  "elite_trainer",
];

describe("coach voice", () => {
  it("gives every personality a distinct set of framing copy", () => {
    const closes = ALL.map((p) => coachVoice(p).openerClose);
    expect(new Set(closes).size).toBe(ALL.length);

    const leadIns = ALL.map((p) => coachVoice(p).dataLeadIn);
    expect(new Set(leadIns).size).toBe(ALL.length);
  });

  it("falls back to balanced for an unrecognised personality", () => {
    expect(coachVoice("nonsense" as CoachPersonality)).toBe(COACH_VOICES.balanced);
  });

  it("leaves a sentence untouched when the voice has no lead", () => {
    // `direct` leads with the problem rather than a preamble, so an empty lead
    // must not produce a stray space or a lowercased first word.
    expect(leadWith("", "You missed four in a row.")).toBe(
      "You missed four in a row.",
    );
  });

  it("joins a lead to a sentence without doubling capitals", () => {
    expect(leadWith("Got it -", "You shot 4 of 5.")).toBe(
      "Got it - you shot 4 of 5.",
    );
  });

  // The shot-session, workout and post-game openers all begin "I've got your
  // ...", so lowercasing blindly put "i've" in the first line Coach ever says
  // on three of the four personalities.
  it("never lowercases the pronoun I", () => {
    expect(leadWith("Got it -", "I've got your shooting session: 4 of 5.")).toBe(
      "Got it - I've got your shooting session: 4 of 5.",
    );
    expect(leadWith("Got it -", "I am watching that zone.")).toBe(
      "Got it - I am watching that zone.",
    );
    // "It"/"If" only *start* with I - they are ordinary words and must lower.
    expect(leadWith("Got it -", "It was the corner three.")).toBe(
      "Got it - it was the corner three.",
    );
  });

  it("leaves an acronym alone, since its capital is not sentence case", () => {
    expect(leadWith("Got it -", "FG% held up from the paint.")).toBe(
      "Got it - FG% held up from the paint.",
    );
  });

  // Guards the real call sites: every personality's opener must be readable.
  it("produces a grammatical opener for every personality", () => {
    for (const personality of ALL) {
      const line = leadWith(
        coachVoice(personality).openerLead,
        "I've got your shooting session: 4 of 5 (80%).",
      );
      expect(line).toContain("I've got your shooting session");
      expect(line).not.toContain("i've");
    }
  });
});

describe("composeFallbackReply", () => {
  const facts = ["3 workout(s) completed", 'Goal "Corner threes": 12/50 makes'];

  it("says plainly that it is not a generated answer", () => {
    for (const personality of ALL) {
      const reply = composeFallbackReply({ personality, facts });
      // The honesty bar: a composed reply must never read as a model reply.
      expect(reply).toMatch(/conversation model.*(isn't connected|offline)/i);
    }
  });

  it("differs by personality, which is what BRD 7.9 requires", () => {
    const replies = ALL.map((personality) =>
      composeFallbackReply({ personality, facts }),
    );
    expect(new Set(replies).size).toBe(ALL.length);
  });

  it("renders every supplied fact verbatim and invents none", () => {
    const reply = composeFallbackReply({ personality: "balanced", facts });
    for (const fact of facts) {
      expect(reply).toContain(fact);
    }
    // The only digits in the reply are the ones handed in - this module
    // composes and orders, it never computes.
    const digitsIn = facts.join(" ").match(/\d+/g) ?? [];
    const digitsOut = reply.match(/\d+/g) ?? [];
    expect(digitsOut.sort()).toEqual(digitsIn.sort());
  });

  it("still returns a usable reply for a player with no data at all", () => {
    const reply = composeFallbackReply({ personality: "encouraging", facts: [] });
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).toMatch(/once a model is configured/i);
  });

  it("includes the next step when one is given", () => {
    const reply = composeFallbackReply({
      personality: "direct",
      facts,
      nextStep: "run today's session in Train.",
    });
    expect(reply).toContain("run today's session in Train.");
  });
});
