import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  formatConfidenceCheckinContext,
  formatFeedItemContext,
  formatGameFilmContext,
  formatNbaPlayerContext,
  formatShotSessionContext,
  formatWorkoutContext,
  type NbaPlayerContextInput,
} from "@/lib/coach-context-format";
import type {
  ConfidenceCheckinDoc,
  FeedItemDoc,
  GameFootageAnalysisDoc,
  ShotSessionDoc,
  WorkoutDoc,
} from "@/types/db";

describe("formatShotSessionContext", () => {
  it("includes the real attempts/makes/FG%, zone breakdown, and best/weakest zone", () => {
    const session: ShotSessionDoc = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      videoAssetId: new ObjectId(),
      recordedAt: new Date("2026-09-01"),
      status: "completed",
      shots: [],
      totalAttempts: 3,
      totalMakes: 1,
      fgPercent: 33.3,
      zoneBreakdown: {
        paint: { attempts: 1, makes: 1 },
        left_corner_3: { attempts: 2, makes: 0 },
      },
      bestZone: "paint",
      weakestZone: "left_corner_3",
      trendCallouts: [],
      createdAt: new Date(),
    };

    const text = formatShotSessionContext(session);
    expect(text).toContain("1/3");
    expect(text).toContain("33.3%");
    expect(text).toContain("Paint");
    expect(text).toContain("Left Corner 3");
    expect(text).toContain("Best zone: Paint");
    expect(text).toContain("Weakest zone: Left Corner 3");
  });

  /**
   * "Ask Coach about that shot" (BRD 7.5) opens a conversation titled after
   * one shot. Without the shot id reaching the formatter, every message after
   * the opener saw only session totals - so Coach could not answer the
   * question actually being asked, which BRD 7.8's "never start from zero"
   * exists to prevent.
   */
  describe("when the player asked about one specific shot", () => {
    const sessionWithShots = (): ShotSessionDoc => ({
      _id: new ObjectId(),
      userId: new ObjectId(),
      videoAssetId: new ObjectId(),
      recordedAt: new Date("2026-09-01"),
      status: "completed",
      shots: [
        {
          id: "shot-a",
          zone: "paint",
          location: { xPct: 50, yPct: 80 },
          made: true,
          timestampInVideoSeconds: 12,
          feedbackText: "Make - Paint",
        },
        {
          id: "shot-b",
          zone: "right_wing_3",
          location: { xPct: 85, yPct: 45 },
          made: false,
          timestampInVideoSeconds: 125,
          feedbackText: "Miss - Right Wing 3",
        },
      ],
      totalAttempts: 2,
      totalMakes: 1,
      fgPercent: 50,
      zoneBreakdown: {
        paint: { attempts: 1, makes: 1 },
        right_wing_3: { attempts: 1, makes: 0 },
      },
      bestZone: "paint",
      weakestZone: "right_wing_3",
      trendCallouts: [],
      createdAt: new Date(),
    });

    it("names that shot's zone, outcome and timestamp, not just the session totals", () => {
      const text = formatShotSessionContext(sessionWithShots(), "shot-b");

      expect(text).toContain("ONE specific shot");
      expect(text).toContain("Right Wing 3");
      expect(text).toContain("miss");
      // 125s is 2:05 - the exact moment, so Coach can talk about the same
      // clip the player is looking at.
      expect(text).toContain("2:05");
    });

    it("describes a make as a make", () => {
      const text = formatShotSessionContext(sessionWithShots(), "shot-a");
      expect(text).toContain("Paint");
      expect(text).toContain("make");
      expect(text).toContain("0:12");
    });

    it("still carries the session-wide numbers as context for that shot", () => {
      const text = formatShotSessionContext(sessionWithShots(), "shot-b");
      expect(text).toContain("1/2");
      expect(text).toContain("Weakest zone: Right Wing 3");
    });

    it("says nothing about a specific shot when none was asked about", () => {
      const text = formatShotSessionContext(sessionWithShots());
      expect(text).not.toContain("ONE specific shot");
    });

    it("degrades to session context for a shot id that no longer exists", () => {
      // A deleted shot must not blow up the whole Coach prompt.
      const text = formatShotSessionContext(sessionWithShots(), "shot-gone");
      expect(text).not.toContain("ONE specific shot");
      expect(text).toContain("1/2");
    });
  });

  it("labels the mechanical breakdown as simulated so the LLM won't present it as measured", () => {
    const session: ShotSessionDoc = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      videoAssetId: new ObjectId(),
      recordedAt: new Date(),
      status: "completed",
      shots: [],
      totalAttempts: 2,
      totalMakes: 1,
      fgPercent: 50,
      zoneBreakdown: {},
      trendCallouts: [],
      mechanicalBreakdown: {
        targetZone: "paint",
        observation: "obs",
        makesVsMisses: "mvm",
        potentialIssue: "issue",
        correction: "fix it",
        isSimulated: true,
      },
      createdAt: new Date(),
    };

    const text = formatShotSessionContext(session);
    expect(text.toLowerCase()).toContain("simulated");
    expect(text).toContain("fix it");
  });

  it("doesn't crash and omits optional sections when a session has no zone data yet", () => {
    const session: ShotSessionDoc = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      videoAssetId: new ObjectId(),
      recordedAt: new Date(),
      status: "processing",
      shots: [],
      totalAttempts: 0,
      totalMakes: 0,
      fgPercent: 0,
      zoneBreakdown: {},
      trendCallouts: [],
      createdAt: new Date(),
    };

    expect(() => formatShotSessionContext(session)).not.toThrow();
    expect(formatShotSessionContext(session)).not.toContain("undefined");
  });
});

describe("formatFeedItemContext", () => {
  it("includes the real title and body", () => {
    const item: FeedItemDoc = {
      _id: new ObjectId(),
      type: "tip",
      title: "Load your shooting wrist before you rise",
      body: "Get the ball into the pocket before your legs extend.",
      tags: ["shooting"],
      createdAt: new Date(),
    };
    const text = formatFeedItemContext(item);
    expect(text).toContain("Load your shooting wrist before you rise");
    expect(text).toContain("Get the ball into the pocket");
  });
});

describe("formatWorkoutContext", () => {
  it("includes the real workout label, status, and drill names", () => {
    const workout: WorkoutDoc = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      source: { type: "shot_session", label: "Paint Shooting - built from your session" },
      difficulty: "beginner",
      estimatedDurationMinutes: 24,
      drills: [
        {
          drillId: new ObjectId(),
          order: 1,
          name: "Form Shooting - Close Range",
          coachingCues: [],
          completed: false,
        },
      ],
      status: "completed",
      createdAt: new Date(),
    };
    const text = formatWorkoutContext(workout);
    expect(text).toContain("Paint Shooting - built from your session");
    expect(text).toContain("completed");
    expect(text).toContain("Form Shooting - Close Range");
  });
});

describe("formatGameFilmContext", () => {
  function analysis(
    overrides: Partial<GameFootageAnalysisDoc> = {},
  ): GameFootageAnalysisDoc {
    return {
      _id: new ObjectId(),
      userId: new ObjectId(),
      videoAssetId: new ObjectId(),
      uploadedAt: new Date("2026-09-01"),
      status: "completed",
      events: [],
      strengths: [{ category: "finishing", text: "You attack the rim early." }],
      weaknesses: [
        {
          category: "spacing",
          text: "You drift toward the ball.",
          recommendation: "Hold the weak-side corner.",
        },
      ],
      recommendedWorkoutIds: [],
      basis: "Built from your stated focus areas.",
      isSimulated: true,
      ...overrides,
    };
  }

  // BRD v1.1 §5: game film has no measured data at all, so unlike a shooting
  // session the *whole* block must be marked heuristic. If this ever stops
  // being true, Coach can start describing generated findings as observed.
  it("marks the whole review as heuristic and never observed in the video", () => {
    const text = formatGameFilmContext(analysis());
    expect(text).toMatch(/heuristic/i);
    expect(text).toMatch(/nothing here was detected in their video/i);
    expect(text).toMatch(/never as something observed/i);
  });

  it("includes the real strengths, weaknesses, and their fixes", () => {
    const text = formatGameFilmContext(analysis());
    expect(text).toContain("You attack the rim early.");
    expect(text).toContain("You drift toward the ball.");
    expect(text).toContain("Hold the weak-side corner.");
    expect(text).toContain("Built from your stated focus areas.");
  });

  it("mentions waiting workouts only when some were actually built", () => {
    expect(formatGameFilmContext(analysis())).not.toMatch(/waiting in Train/i);
    expect(
      formatGameFilmContext(
        analysis({ recommendedWorkoutIds: [new ObjectId(), new ObjectId()] }),
      ),
    ).toContain("2 workout(s)");
  });

  it("omits the optional sections rather than emitting empty labels", () => {
    const text = formatGameFilmContext(
      analysis({ strengths: [], weaknesses: [], basis: undefined }),
    );
    expect(text).not.toMatch(/Strengths suggested/i);
    expect(text).not.toMatch(/Areas to work on/i);
    expect(text).not.toContain("undefined");
  });
});

/**
 * The highest-stakes formatter in the app: most of the ~570-player roster is
 * backed by archetype packs, and an unlabeled archetype block is an invitation
 * for the model to restate role-level coaching prose as film study of a named
 * professional.
 */
describe("formatNbaPlayerContext", () => {
  function player(
    overrides: Partial<NbaPlayerContextInput> = {},
  ): NbaPlayerContextInput {
    return {
      name: "Jordan Example",
      team: "Test Team",
      position: "G",
      sources: {
        learn: "archetype",
        skills: "archetype",
        signatureMoves: "archetype",
      },
      archetype: {
        label: "Shot Creator",
        summary: "Creates his own look off the dribble.",
      },
      whatTheyDoWell: "Gets to his spots off a live dribble.",
      signatureMoveNames: ["Step-back jumper"],
      strengths: ["Separation off the bounce"],
      weaknesses: ["Finishing through contact"],
      ...overrides,
    };
  }

  it("tells the model in the imperative that archetype content is not about the person", () => {
    const text = formatNbaPlayerContext(player());
    expect(text).toContain("CRITICAL");
    expect(text).toMatch(/never as film study of Jordan Example/i);
    expect(text).toMatch(/never as their statistics/i);
    expect(text).toMatch(/Shot Creator/);
  });

  it("forbids the model topping the profile up from its own knowledge", () => {
    // The failure this guards against isn't the model repeating our archetype
    // prose - it's the model filling the gaps with career claims we never made
    // and can't stand behind, which the player will read as HoopSync's.
    const text = formatNbaPlayerContext(player());
    expect(text).toMatch(/do not add biographical or career details/i);
  });

  it("labels each section with the source it actually came from", () => {
    const text = formatNbaPlayerContext(
      player({
        sources: {
          learn: "authored",
          skills: "archetype",
          signatureMoves: "authored",
        },
      }),
    );
    expect(text).toMatch(
      /What they do well \(HoopSync editorial about Jordan Example\)/,
    );
    expect(text).toMatch(/Strengths \(role-based coaching profile, NOT about this individual\)/);
  });

  it("adds no disclaimer at all when every section is hand-authored", () => {
    const text = formatNbaPlayerContext(
      player({
        sources: {
          learn: "authored",
          skills: "authored",
          signatureMoves: "authored",
        },
        archetype: undefined,
      }),
    );
    expect(text).not.toContain("CRITICAL");
    expect(text).not.toMatch(/NOT about this individual/);
  });

  it("omits empty sections rather than emitting bare labels", () => {
    const text = formatNbaPlayerContext(
      player({
        whatTheyDoWell: "  ",
        signatureMoveNames: [],
        strengths: [],
        weaknesses: [],
      }),
    );
    expect(text).not.toMatch(/What they do well/);
    expect(text).not.toMatch(/Signature moves/);
    expect(text).not.toContain("undefined");
  });
});

describe("formatConfidenceCheckinContext", () => {
  function checkin(
    overrides: Partial<ConfidenceCheckinDoc> = {},
  ): ConfidenceCheckinDoc {
    return {
      _id: new ObjectId(),
      userId: new ObjectId(),
      type: "pre_game",
      feeling: "nervous",
      routine: "Four slow breaths. Ten free throws.",
      createdAt: new Date("2026-09-10"),
      ...overrides,
    } as ConfidenceCheckinDoc;
  }

  it("names the feeling the player actually selected", () => {
    const text = formatConfidenceCheckinContext(checkin());
    expect(text).toMatch(/nervous/i);
    expect(text).toContain("Four slow breaths.");
  });

  it("tells Coach not to simply re-read the routine back", () => {
    const text = formatConfidenceCheckinContext(checkin());
    expect(text).toMatch(/don't just repeat it back/i);
  });

  it("carries the recovery plan's real positives and areas", () => {
    const text = formatConfidenceCheckinContext(
      checkin({
        type: "post_game",
        feeling: undefined,
        routine: undefined,
        recoveryPlan: {
          positives: ["You trained 4 times this week"],
          areasToImprove: ["Left corner three"],
          planSteps: ["Two shooting sessions before Friday."],
          isDataBacked: true,
        },
      }),
    );
    expect(text).toContain("You trained 4 times this week");
    expect(text).toContain("Left corner three");
    expect(text).toContain("Two shooting sessions before Friday.");
  });

  it("tells Coach a data-backed plan's figures are real, not to be hedged", () => {
    const text = formatConfidenceCheckinContext(
      checkin({
        type: "post_game",
        feeling: undefined,
        routine: undefined,
        recoveryPlan: {
          positives: ["You trained 4 times this week"],
          areasToImprove: [],
          planSteps: ["Two shooting sessions before Friday."],
          isDataBacked: true,
        },
      }),
    );
    expect(text).toMatch(/own logged records/i);
    expect(text).toMatch(/never contradict these numbers/i);
  });

  it("tells Coach not to fill an empty plan with encouragement", () => {
    const text = formatConfidenceCheckinContext(
      checkin({
        type: "post_game",
        feeling: undefined,
        routine: undefined,
        recoveryPlan: {
          positives: [],
          areasToImprove: [],
          planSteps: ["Log a shooting session in Analyze."],
          isDataBacked: false,
        },
      }),
    );
    expect(text).toMatch(/do not invent/i);
    expect(text).toMatch(/encouragement/i);
  });

  it("always carries BRD 7.10's no-generic-motivation constraint", () => {
    expect(formatConfidenceCheckinContext(checkin())).toMatch(
      /generic motivational quotes/i,
    );
  });
});
