import type { ObjectId } from "mongodb";
import { pickDeterministic } from "@/lib/deterministic";
import { ZONE_LABELS } from "@/lib/shot-zones";
import type { MechanicalBreakdown, ShotZone } from "@/types/db";

/**
 * Pure, isomorphic implementation of the "why did you miss" narrative
 * generator - deliberately kept out of the server-only provider file
 * (src/server/services/shotMechanicalAnalysisProvider.ts) so it can also be
 * imported from scripts/tests that don't run inside a Next.js server
 * context (e.g. scripts/db/seed.ts), without duplicating this logic.
 * Every result is generated/simulated - the provider wrapper is
 * responsible for marking it `isSimulated: true` before it reaches the UI.
 */
export interface ZoneStats {
  zone: ShotZone;
  attempts: number;
  makes: number;
  fgPercent: number;
}

export interface MechanicalAnalysisInput {
  sessionId: ObjectId;
  weakest: ZoneStats;
  /**
   * Absent when the player logged shots from only one zone - there is then
   * no comparison zone, and the observation says so rather than comparing
   * the zone against itself.
   */
  best?: ZoneStats;
}

interface IssueTemplate {
  potentialIssue: string;
  makesVsMisses: string;
  correction: string;
  drillSlug: string;
}

const ISSUE_TEMPLATES: IssueTemplate[] = [
  {
    potentialIssue: "Elbow drifting outward",
    makesVsMisses:
      "Release point sits a touch lower and the elbow flares more on misses than makes - the mechanics are there on your makes, they're just not repeating yet.",
    correction:
      "Keep the shooting elbow stacked directly under the ball through the whole release, not just at the set point.",
    drillSlug: "form-shooting-close-range",
  },
  {
    potentialIssue: "Late wrist load",
    makesVsMisses:
      "On misses, the ball reaches the shooting pocket later relative to your legs starting to extend - on makes, the wrist is already loaded before you rise.",
    correction:
      "Get the ball into the shooting pocket with the wrist cocked back before your legs start extending, not during the rise.",
    drillSlug: "one-dribble-pull-up",
  },
  {
    potentialIssue: "Rushed base before the catch",
    makesVsMisses:
      "Your feet are still adjusting after the catch on misses in this zone, while makes show a set base before the ball even arrives.",
    correction:
      "Get your feet set and squared to the rim a half-step earlier, before you're already gathering to shoot.",
    drillSlug: "hesitation-pull-up-signature",
  },
  {
    potentialIssue: "Inconsistent follow-through",
    makesVsMisses:
      "Makes hold a full follow-through with the wrist snapped down; misses tend to cut the follow-through short.",
    correction:
      "Hold your follow-through until the ball hits the rim - don't drop the hand early to watch the shot.",
    drillSlug: "form-shooting-close-range",
  },
];

/** Deterministic (not random) so the same session always shows the same
 * breakdown on reload, while different sessions/zones get variety. */
export function pickTemplate(sessionId: ObjectId, zone: ShotZone): IssueTemplate {
  return pickDeterministic(ISSUE_TEMPLATES, `${sessionId.toString()}:${zone}`)!;
}

export function generateMechanicalBreakdown(
  input: MechanicalAnalysisInput,
): Omit<MechanicalBreakdown, "targetZone" | "isSimulated"> {
  const template = pickTemplate(input.sessionId, input.weakest.zone);
  const zoneLabel = ZONE_LABELS[input.weakest.zone];
  const { makes, attempts, fgPercent: weakestPct } = input.weakest;

  const observation = input.best
    ? `Your ${zoneLabel} percentage (${makes}/${attempts} - ${weakestPct}%) is your lowest zone this session, and the pattern looks less consistent here than elsewhere. You're noticeably steadier at ${ZONE_LABELS[input.best.zone]} (${input.best.fgPercent}%) - the gap looks mechanical, not effort.`
    : `Your ${zoneLabel} percentage (${makes}/${attempts} - ${weakestPct}%) is the only zone you logged this session, so there's no comparison zone yet. Log shots from a second spot next time to see whether this pattern is specific to ${zoneLabel} or shows up in your base mechanics everywhere.`;

  return {
    observation,
    makesVsMisses: template.makesVsMisses,
    potentialIssue: template.potentialIssue,
    correction: template.correction,
  };
}

export function generateShotFeedback(zone: ShotZone, made: boolean): string {
  const zoneLabel = ZONE_LABELS[zone];
  if (made) {
    return `Make - ${zoneLabel}. Clean release, good follow-through.`;
  }
  return `Miss - ${zoneLabel}. Your release may be slightly late and your shooting wrist isn't fully loaded before extension.`;
}

export function drillSlugForBreakdown(weakestZone: ShotZone, sessionId: ObjectId): string {
  return pickTemplate(sessionId, weakestZone).drillSlug;
}
