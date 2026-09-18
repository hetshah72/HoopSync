/**
 * Pre-game routines for the Confidence / Mental Game feature (BRD 7.10).
 *
 * The BRD is unusually prescriptive about what these must *not* be: "Avoid
 * generic motivational quotes - every response must be actionable", and the
 * success criterion is that a "Nervous" check-in "returns a specific routine,
 * not a generic pep talk". So every routine below is a sequence of things to
 * physically do, with counts and durations, on a basketball court - never a
 * sentiment.
 *
 * Each one is matched to the *mechanism* behind that feeling rather than to
 * its mood: nerves are excess arousal, so the routine burns it off and slows
 * the breath; overthinking is too much conscious control, so the routine
 * crowds it out with pace and a single external cue.
 *
 * Pure and isomorphic - no database, directly unit-testable.
 */
import type { ConfidenceFeeling } from "@/types/db";

// Re-exported so callers here can stay on this module, the way `shot-zones`
// re-exports SHOT_ZONES. The definition lives beside the document type.
export { CONFIDENCE_FEELINGS } from "@/types/db";
export type { ConfidenceFeeling } from "@/types/db";

export const FEELING_LABELS: Record<ConfidenceFeeling, string> = {
  confident: "Confident",
  nervous: "Nervous",
  overthinking: "Overthinking",
  not_ready: "Not ready",
};

export interface ConfidenceRoutine {
  /** What this routine is actually for - stated plainly, no motivation. */
  purpose: string;
  /** Ordered, concrete steps. Each one is a thing you do, with a number. */
  steps: string[];
  /** One thing to hold in mind during the game itself. */
  inGameCue: string;
}

const ROUTINES: Record<ConfidenceFeeling, ConfidenceRoutine> = {
  confident: {
    purpose:
      "You're ready. This keeps the feeling from turning into rushing, which is the usual way a good warm-up becomes a bad first quarter.",
    steps: [
      "10 form shots from the block, one hand, holding your follow-through until the ball lands.",
      "5 catch-and-shoot reps from your two favourite spots - the ones you'd take in the first quarter.",
      "10 hard close-outs on an imaginary shooter, chopping your last two steps each time.",
      "Pick one teammate you'll talk to on defence every possession of the first quarter.",
    ],
    inGameCue:
      "Take the first good shot you're given, not the first shot you see.",
  },
  nervous: {
    purpose:
      "Nerves are extra adrenaline with nowhere to go. This burns some of it off and slows your breathing down so your hands settle.",
    steps: [
      "Sprint the court twice at about 80% - enough to feel your breathing change, not enough to tire you.",
      "Box breathing, 4 rounds: in for 4 seconds, hold 4, out for 6, hold 2. The long exhale is the part that works.",
      "20 close-range form shots. Stay inside 5 feet until 10 in a row feel automatic.",
      "5 free throws using your exact free-throw routine - same dribbles, same breath, every time.",
      "Name one job you can do well even on a bad shooting night: rebounding, talking on defence, getting the ball moving.",
    ],
    inGameCue:
      "Your first touch is a pass. Get one simple, easy completion before you look for your own shot.",
  },
  overthinking: {
    purpose:
      "Overthinking is too much conscious control over movement that should be automatic. These steps raise the pace so there isn't room to narrate.",
    steps: [
      "Two-ball dribbling for 60 seconds, eyes up the whole time - fast enough that you can't think about your hands.",
      "10 shots on the move off a cut, taken within one second of the catch. Don't reset your feet twice.",
      "Pick exactly one mechanical cue for tonight and discard the rest. One. Write it down if it helps.",
      "3 possessions of shadow defence at game speed, reacting to a partner or a wall - pure reaction, no planning.",
    ],
    inGameCue:
      "Play the next possession only. If you catch yourself replaying the last one, say your one cue out loud.",
  },
  not_ready: {
    purpose:
      "Feeling unprepared usually means your body hasn't warmed up yet, not that you can't play. This gets you to competent, which is enough to start.",
    steps: [
      "3 minutes of movement: jog, side shuffles, and 10 leg swings each side. Get actually warm before anything else.",
      "20 layups, 10 each side, off the correct foot. Simple makes to remind your hands what the rim looks like.",
      "15 shots from inside 10 feet - close enough that most go in.",
      "5 free throws, full routine.",
      "Choose one thing you'll do regardless of how you shoot tonight: first to the floor, box out every time, no wasted possessions.",
    ],
    inGameCue:
      "Do the simple job well early - a box-out, a good pass, a stop. Rhythm follows contribution.",
  },
};

export function routineFor(feeling: ConfidenceFeeling): ConfidenceRoutine {
  return ROUTINES[feeling];
}

/** Stored on the check-in as a readable record of what was actually given. */
export function routineToStoredText(routine: ConfidenceRoutine): string {
  return [
    routine.purpose,
    ...routine.steps.map((step, i) => `${i + 1}. ${step}`),
    `In-game cue: ${routine.inGameCue}`,
  ].join("\n");
}
