import { ZONE_LABELS, fgPercent } from "@/lib/shot-zones";
import {
  provenanceCoachPreamble,
  resolveAnalysisProvenance,
} from "@/lib/game-film-provenance";
import { FEELING_LABELS } from "@/lib/confidence-routines";
import type {
  ConfidenceCheckinDoc,
  FeedItemDoc,
  GameFootageAnalysisDoc,
  ShotSessionDoc,
  WorkoutDoc,
} from "@/types/db";

/**
 * Formats a real ShotSessionDoc into a structured text block for the Coach
 * prompt - real attempts/makes/FG%/zone data first, the (labeled) simulated
 * mechanical narrative clearly marked as such so the LLM doesn't repeat it
 * as if it were measured.
 */
export function formatShotSessionContext(
  session: ShotSessionDoc,
  /**
   * Set when the player tapped "Ask Coach" on one specific shot (BRD 7.5).
   * Without it Coach only ever sees session totals, so it can't answer the
   * question actually being asked - which shot, from where, made or missed.
   */
  shotId?: string,
): string {
  const lines: string[] = [
    `Shooting session from ${session.recordedAt.toDateString()}: ${session.totalMakes}/${session.totalAttempts} (${session.fgPercent}%).`,
  ];

  const focusShot = shotId ? session.shots.find((s) => s.id === shotId) : undefined;
  if (focusShot) {
    const minutes = Math.floor(focusShot.timestampInVideoSeconds / 60);
    const seconds = Math.floor(focusShot.timestampInVideoSeconds % 60);
    lines.push(
      `The player is asking about ONE specific shot from this session: a ${
        focusShot.made ? "make" : "miss"
      } from ${ZONE_LABELS[focusShot.zone]} at ${minutes}:${seconds
        .toString()
        .padStart(2, "0")} into the video. Answer about that shot first; the session-wide numbers below are context for it.`,
    );
  }

  const zoneLines = Object.entries(session.zoneBreakdown)
    .filter((entry): entry is [keyof typeof ZONE_LABELS, { attempts: number; makes: number }] =>
      Boolean(entry[1]),
    )
    .map(
      ([zone, stats]) =>
        `${ZONE_LABELS[zone]}: ${stats.makes}/${stats.attempts} (${fgPercent(stats.makes, stats.attempts)}%)`,
    );
  if (zoneLines.length > 0) {
    lines.push(`Zone breakdown - ${zoneLines.join(", ")}.`);
  }

  if (session.bestZone) {
    lines.push(`Best zone: ${ZONE_LABELS[session.bestZone]}.`);
  }
  if (session.weakestZone) {
    lines.push(`Weakest zone: ${ZONE_LABELS[session.weakestZone]}.`);
  }

  if (session.mechanicalBreakdown) {
    const m = session.mechanicalBreakdown;
    lines.push(
      `Simulated mechanical analysis (label this as simulated if you reference it, never as measured) for ${ZONE_LABELS[m.targetZone]}: ${m.observation} Likely issue: ${m.potentialIssue}. Suggested correction: ${m.correction}`,
    );

    // The nine-parameter analysis (BRD 7.6), each line carrying its own
    // provenance. The measured/inference split is stated per finding rather
    // than once for the block: a left-vs-right gap computed from the player's
    // own logged shots is a different kind of claim from a generated read on
    // their elbow, and collapsing the two is exactly how Coach would end up
    // presenting one as the other.
    for (const finding of m.findings ?? []) {
      const provenance =
        finding.basis === "measured"
          ? "computed from the player's own logged shots - safe to reference as real"
          : "generated coaching inference, NOT measured - never state it as something observed in their video";
      lines.push(
        `Form parameter "${finding.parameter}" (${provenance}): ${finding.observation} Likely issue: ${finding.potentialIssue}. Suggested correction: ${finding.correction}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatFeedItemContext(item: FeedItemDoc): string {
  return `Feed item the player is asking about - "${item.title}" (${item.type}): ${item.body}`;
}

/**
 * The shape `formatNbaPlayerContext` needs, resolved by the caller.
 *
 * Deliberately not `NbaPlayerDoc` + `ResolvedPlayerEditorial`: resolving
 * editorial is a server concern (it reads drills and media assets), and this
 * module is isomorphic. The caller passes the already-resolved facts in.
 */
export interface NbaPlayerContextInput {
  name: string;
  team?: string;
  position?: string;
  /** Per-section provenance from `resolvePlayerEditorial`. */
  sources: {
    learn: "authored" | "archetype";
    skills: "authored" | "archetype";
    signatureMoves: "authored" | "archetype";
  };
  /** Present whenever any section fell back to the archetype pack. */
  archetype?: { label: string; summary: string };
  whatTheyDoWell: string;
  signatureMoveNames: string[];
  strengths: string[];
  weaknesses: string[];
}

/**
 * An NBA player the player is studying (BRD 7.9 "discuss player-study
 * content").
 *
 * This is the most dangerous context block in the app, and the reason it exists
 * at all is that BRD 7.9 lists player-study discussion as a Coach requirement
 * that had no implementation.
 *
 * The danger: most of the ~570-player roster has no hand-authored content, so
 * what the profile shows comes from an authored *archetype pack* - a coaching
 * profile for a role (CLAUDE.md: "archetype content describes a role, never the
 * individual"). Handed to a language model without that distinction, Coach
 * would fluently restate role-level coaching prose as film study of a named
 * professional, and invent the career claims to match. So provenance is stated
 * per section, in the imperative, at the model - exactly as the shot formatter
 * does for its measured-vs-inferred findings.
 *
 * Career/biographical prose is never included on the archetype path, for the
 * same reason `resolvePlayerEditorial` leaves `bio` empty rather than filling
 * it: a factual claim about a real person cannot be synthesized from a role.
 */
export function formatNbaPlayerContext(player: NbaPlayerContextInput): string {
  const identity = [player.position, player.team].filter(Boolean).join(", ");
  const lines: string[] = [
    `The player is studying ${player.name}${identity ? ` (${identity})` : ""}.`,
  ];

  const anyArchetype =
    player.sources.learn === "archetype" ||
    player.sources.skills === "archetype" ||
    player.sources.signatureMoves === "archetype";

  if (anyArchetype && player.archetype) {
    lines.push(
      `CRITICAL: some of the study content below is not about ${player.name} personally. ` +
        `It is HoopSync's authored coaching profile for the "${player.archetype.label}" role ` +
        `(${player.archetype.summary}), which ${player.name} was classified into by listed position and height. ` +
        `Discuss it as "the way this type of player operates", never as film study of ${player.name}, ` +
        `never as their statistics, and never as a claim about their career. ` +
        `Do not add biographical or career details about ${player.name} from your own knowledge - ` +
        `HoopSync has not verified them and the player will read them as ours.`,
    );
  }

  const label = (section: "learn" | "skills" | "signatureMoves") =>
    player.sources[section] === "authored"
      ? `HoopSync editorial about ${player.name}`
      : "role-based coaching profile, NOT about this individual";

  if (player.whatTheyDoWell.trim().length > 0) {
    lines.push(`What they do well (${label("learn")}): ${player.whatTheyDoWell}`);
  }
  if (player.signatureMoveNames.length > 0) {
    lines.push(
      `Signature moves the player can drill (${label("signatureMoves")}): ${player.signatureMoveNames.join(", ")}.`,
    );
  }
  if (player.strengths.length > 0) {
    lines.push(`Strengths (${label("skills")}): ${player.strengths.join("; ")}`);
  }
  if (player.weaknesses.length > 0) {
    lines.push(`Areas they're weaker in (${label("skills")}): ${player.weaknesses.join("; ")}`);
  }

  return lines.join("\n");
}

/**
 * A Confidence check-in (BRD 7.10), so Coach can pick up the mental-game thread
 * rather than starting cold.
 *
 * BRD 7.9 lists "provide confidence/mental-game support (see 7.10)" as a Coach
 * requirement, but the Confidence flow was built entirely outside Coach and
 * neither could see the other - the player would answer "I'm nervous", get a
 * routine, then open Coach and be met by something that had no idea.
 *
 * Both halves are real records, not generated: the pre-game routine is chosen
 * from an authored table and the recovery plan is computed from the player's
 * own sessions and workouts (`confidence-recovery.ts`). So unlike the analysis
 * blocks this one carries no simulation disclaimer - there is nothing
 * simulated in it. What it does carry is the instruction not to re-issue the
 * routine the player has already been given.
 */
export function formatConfidenceCheckinContext(
  checkin: ConfidenceCheckinDoc,
): string {
  const lines: string[] = [];

  if (checkin.type === "pre_game") {
    const feeling = checkin.feeling ? FEELING_LABELS[checkin.feeling] : undefined;
    lines.push(
      `Pre-game check-in from ${checkin.createdAt.toDateString()}${
        feeling ? `: the player said they were feeling "${feeling}"` : ""
      }.`,
    );
    if (checkin.routine) {
      lines.push(`The routine they were already given for that:\n${checkin.routine}`);
      lines.push(
        "They have read that routine. Don't just repeat it back - help them use it, or talk through what's behind the feeling.",
      );
    }
  } else {
    lines.push(`Post-game recovery check-in from ${checkin.createdAt.toDateString()}.`);
    const plan = checkin.recoveryPlan;
    if (plan) {
      if (plan.positives.length > 0) {
        lines.push(`Positives drawn from their real records: ${plan.positives.join("; ")}`);
      }
      if (plan.areasToImprove.length > 0) {
        lines.push(`Areas to improve: ${plan.areasToImprove.join("; ")}`);
      }
      lines.push(
        `The plan they were given:\n${plan.planSteps
          .map((step, i) => `${i + 1}. ${step}`)
          .join("\n")}`,
      );
      // The inverse of the game-film caveat below: that content is heuristic
      // and must be labelled, this content was computed from the player's own
      // stored records and must not be hedged or contradicted.
      lines.push(
        plan.isDataBacked
          ? "Every figure above was computed from this player's own logged records - they are real. Build on them; don't restate the plan back verbatim, and never contradict these numbers."
          : "There wasn't enough logged activity to build this from their numbers. Do not invent any, and do not fill the gap with encouragement - point them at logging a session or finishing a workout.",
      );
    }
  }

  lines.push(
    "This is mental-game context. Stay concrete and specific to their own data - BRD 7.10 rules out generic motivational quotes.",
  );

  return lines.join("\n");
}

export function formatWorkoutContext(workout: WorkoutDoc): string {
  const drillNames = workout.drills.map((d) => d.name).join(", ");
  return `Workout "${workout.source.label}" (${workout.status}, ${workout.difficulty}): ${drillNames || "no drills"}.`;
}

/**
 * Game film analysis for the Coach prompt.
 *
 * Unlike a shooting session there is no measured data here at all - BRD v1.1
 * §5 puts real event detection in Phase 2 - so the whole block is prefixed as
 * heuristic. The instruction to the model is explicit for the same reason the
 * shot formatter labels its mechanical narrative: Coach must not repeat any of
 * this as though it were observed in the player's footage.
 */
export function formatGameFilmContext(
  analysis: GameFootageAnalysisDoc,
): string {
  const provenance = resolveAnalysisProvenance(analysis);
  const lines: string[] = [
    `Game film review from ${analysis.uploadedAt.toDateString()}. ${provenanceCoachPreamble(
      provenance,
      analysis.framesAnalyzed,
    )}`,
  ];

  if (analysis.basis) lines.push(analysis.basis);

  if (provenance === "vision_model" && analysis.events.length > 0) {
    lines.push(
      `Moments read off the footage: ${analysis.events
        .map(
          (event) =>
            `${event.type.replace(/_/g, " ")} at ${Math.round(
              event.timestampInVideoSeconds,
            )}s - ${event.description}`,
        )
        .join(" ")}`,
    );
  }

  if (analysis.strengths.length > 0) {
    lines.push(
      `Strengths suggested: ${analysis.strengths.map((s) => s.text).join(" ")}`,
    );
  }
  if (analysis.weaknesses.length > 0) {
    lines.push(
      `Areas to work on: ${analysis.weaknesses
        .map((w) => `${w.text}${w.recommendation ? ` Fix: ${w.recommendation}` : ""}`)
        .join(" ")}`,
    );
  }
  if (analysis.recommendedWorkoutIds.length > 0) {
    lines.push(
      `${analysis.recommendedWorkoutIds.length} workout(s) have already been built for these and are waiting in Train.`,
    );
  }

  return lines.join("\n");
}
