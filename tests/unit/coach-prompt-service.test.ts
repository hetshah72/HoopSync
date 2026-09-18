import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildCoachSystemPrompt } from "@/server/services/coachPromptService";
import type { CoachPersonality } from "@/types/db";

const PERSONALITIES: CoachPersonality[] = [
  "encouraging",
  "balanced",
  "direct",
  "elite_trainer",
];

function basePrompt(personality: CoachPersonality) {
  return buildCoachSystemPrompt({
    personality,
    profile: null,
    stats: null,
    goals: [],
    contextBlocks: [],
  });
}

describe("buildCoachSystemPrompt", () => {
  it("produces a distinct prompt per personality - not a relabeled default (BRD §7.9)", () => {
    const prompts = PERSONALITIES.map(basePrompt);
    const unique = new Set(prompts);
    expect(unique.size).toBe(PERSONALITIES.length);
  });

  it("never leaks 'undefined' into the prompt when profile/stats/goals are absent", () => {
    const prompt = basePrompt("balanced");
    expect(prompt).not.toContain("undefined");
  });

  it("includes real profile facts when a profile is provided", () => {
    const prompt = buildCoachSystemPrompt({
      personality: "balanced",
      profile: {
        _id: new ObjectId(),
        userId: new ObjectId(),
        focusAreas: ["shooting", "ball_handling"],
        equipment: [],
        coachPersonality: "balanced",
        position: "Point Guard",
        competitiveLevel: "high_school",
        consent: { parentalConsentRequired: false, parentalConsentGiven: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stats: null,
      goals: [],
      contextBlocks: [],
    });
    expect(prompt).toContain("Point Guard");
    expect(prompt).toContain("shooting");
    expect(prompt).toContain("high school");
  });


  /**
   * BRD 7.1's objective is that onboarding data personalizes "every other
   * feature (workouts, feed, Coach)". Eleven of the eighteen captured fields
   * never reached this prompt (audit 2.1), so Coach could not tell a
   * 12-year-old from an 18-year-old, did not know the player's team role or
   * weekly load, and would prescribe drills they had no equipment for.
   */
  it("carries every onboarding answer into the prompt, not just four of them", () => {
    const prompt = buildCoachSystemPrompt({
      personality: "balanced",
      profile: {
        _id: new ObjectId(),
        userId: new ObjectId(),
        displayName: "Jordan",
        age: 11, // stale snapshot - must be ignored in favour of the DOB
        heightInches: 70,
        weightLbs: 150,
        educationLevel: "high_school",
        expectedGraduationYear: 2028,
        position: "Point Guard",
        competitiveLevel: "high_school",
        onTeam: true,
        teamName: "Lincoln High",
        teamLevel: "Varsity",
        roleOnTeam: "Limited role",
        primaryGoal: "Make my school team",
        focusAreas: ["shooting"],
        gamesPerWeek: 3,
        practiceFrequencyPerWeek: 4,
        equipment: ["ball", "jump_rope"],
        coachPersonality: "balanced",
        consent: {
          dateOfBirth: new Date(Date.UTC(2010, 0, 1)),
          parentalConsentRequired: false,
          parentalConsentGiven: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stats: null,
      goals: [],
      contextBlocks: [],
    });

    expect(prompt).toContain("5'10\"");
    expect(prompt).toContain("150 lbs");
    expect(prompt).toContain("high school");
    expect(prompt).toContain("2028");
    expect(prompt).toContain("Lincoln High");
    expect(prompt).toContain("Varsity");
    expect(prompt).toContain("limited role");
    expect(prompt).toContain("3 game(s)");
    expect(prompt).toContain("4 practice(s)");
    expect(prompt).toContain("jump rope");
    // Age is derived from the stored DOB, never the denormalised snapshot.
    expect(prompt).not.toContain("is 11 years old");
  });

  it("tells Coach not to prescribe drills the player has no equipment for", () => {
    const base = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      focusAreas: ["shooting"] as const,
      coachPersonality: "balanced" as const,
      consent: { parentalConsentRequired: false, parentalConsentGiven: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const none = buildCoachSystemPrompt({
      personality: "balanced",
      profile: { ...base, focusAreas: ["shooting"], equipment: [] },
      stats: null,
      goals: [],
      contextBlocks: [],
    });
    expect(none.toLowerCase()).toContain("no training equipment");

    const some = buildCoachSystemPrompt({
      personality: "balanced",
      profile: { ...base, focusAreas: ["shooting"], equipment: ["ball", "hoop"] },
      stats: null,
      goals: [],
      contextBlocks: [],
    });
    expect(some).toContain("Only recommend drills they can do with this.");
  });

  it("instructs the model to reference shared context specifically when contextBlocks are present", () => {
    const withContext = buildCoachSystemPrompt({
      personality: "balanced",
      profile: null,
      stats: null,
      goals: [],
      contextBlocks: ["Shooting session from Mon Sep 01 2026: 1/3 (33.3%)."],
    });
    expect(withContext).toContain("1/3 (33.3%)");
    expect(withContext.toLowerCase()).toContain("reference it specifically");
  });
});

/**
 * BRD 7.9 requires Coach to "provide confidence/mental-game support (see
 * 7.10)". Carrying the check-in passively is the always-on half of that.
 */
describe("buildCoachSystemPrompt with a recent pre-game feeling", () => {
  const now = new Date("2026-09-16T18:00:00Z");

  function withFeeling(at: Date) {
    return buildCoachSystemPrompt({
      personality: "balanced",
      profile: null,
      stats: null,
      goals: [],
      contextBlocks: [],
      recentFeeling: { feeling: "nervous", at },
      now,
    });
  }

  it("carries today's feeling, and says it is for tone only", () => {
    const prompt = withFeeling(new Date("2026-09-16T16:00:00Z"));

    expect(prompt).toContain("Nervous");
    // The instruction is the load-bearing part - without it every reply
    // opens "I see you were feeling nervous...", which is the generic
    // reassurance BRD 7.10 rules out.
    expect(prompt).toContain("Do not open with it");
    expect(prompt).toContain("do not offer reassurance");
  });

  it("drops a feeling older than a day rather than steering today's answer with it", () => {
    const stale = withFeeling(new Date("2026-09-14T16:00:00Z"));
    expect(stale).not.toContain("Nervous");
  });

  it("omits the section entirely when there is no check-in", () => {
    const prompt = buildCoachSystemPrompt({
      personality: "balanced",
      profile: null,
      stats: null,
      goals: [],
      contextBlocks: [],
      recentFeeling: null,
      now,
    });

    expect(prompt).not.toContain("checked in as");
    expect(prompt).not.toContain("undefined");
  });
});
