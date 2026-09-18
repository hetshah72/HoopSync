import "server-only";
import { ObjectId } from "mongodb";
import {
  appendShot,
  createSession,
  findSessionByIdForUser,
  finalizeSession as finalizeSessionRepo,
  listSessionsForUser as listSessionsRepo,
  removeShot as removeShotRepo,
  setRecommendedWorkout,
} from "@/server/repositories/shotSessionRepository";
import {
  findDrillBySlug,
  findDrillsBySlugs,
} from "@/server/repositories/drillRepository";
import { storeSessionVideo } from "@/server/services/videoStorageService";
import {
  drillSlugForBreakdown,
  getShotMechanicalAnalysisProvider,
} from "@/server/services/shotMechanicalAnalysisProvider";
import { generateWorkout } from "@/server/services/workoutGenerationService";
import { addDrillToWorkout } from "@/server/services/workoutService";
import { recordShotSessionCompletion } from "@/server/services/progressService";
import { recalculateGoalsForUser } from "@/server/services/goalService";
import { recordNewlyUnlockedAchievements } from "@/server/services/achievementService";
import { notifySessionRecommendation } from "@/server/services/notificationService";
import {
  computeZoneBreakdown,
  findBestAndWeakestZones,
  fgPercent,
  ZONE_LABELS,
} from "@/lib/shot-zones";
import { NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { LogShotInput } from "@/lib/validation/shotSession";
import type {
  AchievementDoc,
  GoalDoc,
  ShotRecord,
  ShotSessionDoc,
} from "@/types/db";

export async function startSession(
  userId: ObjectId,
  videoBuffer: Buffer,
  contentType: string,
): Promise<ShotSessionDoc> {
  const mediaAsset = await storeSessionVideo(
    userId.toString(),
    videoBuffer,
    contentType,
  );

  return createSession({
    userId,
    videoAssetId: mediaAsset._id,
    recordedAt: new Date(),
    status: "processing",
    shots: [],
    totalAttempts: 0,
    totalMakes: 0,
    fgPercent: 0,
    zoneBreakdown: {},
    trendCallouts: [],
    createdAt: new Date(),
  });
}

export async function getSessionForUser(
  userId: ObjectId,
  sessionId: ObjectId,
): Promise<ShotSessionDoc | null> {
  return findSessionByIdForUser(userId, sessionId);
}

export async function listSessionsForUser(
  userId: ObjectId,
): Promise<ShotSessionDoc[]> {
  return listSessionsRepo(userId);
}

async function requireOwnedProcessingSession(
  userId: ObjectId,
  sessionId: ObjectId,
): Promise<ShotSessionDoc> {
  const session = await findSessionByIdForUser(userId, sessionId);
  if (!session) {
    throw new NotFoundError("Shot session not found.");
  }
  if (session.status !== "processing") {
    throw new ValidationError("This session has already been finalized.");
  }
  return session;
}

/** Logs one real, tap-entered shot - the actual shot-detection mechanism (BRD v1.1 §5). */
export async function logShot(
  userId: ObjectId,
  sessionId: ObjectId,
  input: LogShotInput,
): Promise<ShotSessionDoc> {
  await requireOwnedProcessingSession(userId, sessionId);

  const { provider } = getShotMechanicalAnalysisProvider();
  const shot: ShotRecord = {
    id: new ObjectId().toString(),
    zone: input.zone,
    location: { xPct: input.xPct, yPct: input.yPct },
    made: input.made,
    // Real player input, exactly like `made`. Absent when they didn't tag it -
    // the analysis then uses the general reference standard rather than
    // inferring a shot type from the zone (BRD 7.6 "for the same shot type").
    ...(input.shotType ? { shotType: input.shotType } : {}),
    timestampInVideoSeconds: input.timestampInVideoSeconds,
    replayStartSeconds: Math.max(0, input.timestampInVideoSeconds - 3),
    replayEndSeconds: input.timestampInVideoSeconds + 2,
    // Headline only: the four-part feedback quotes session-wide zone tallies,
    // which don't exist yet while shots are still being tapped in. Finalize
    // back-fills `feedback` for every shot at once.
    feedbackText: provider.headlineForShot(input.zone, input.made),
  };

  const updated = await appendShot(sessionId, shot);
  if (!updated) {
    throw new NotFoundError("Shot session not found.");
  }
  return updated;
}

export async function removeShot(
  userId: ObjectId,
  sessionId: ObjectId,
  shotId: string,
): Promise<ShotSessionDoc> {
  await requireOwnedProcessingSession(userId, sessionId);
  const updated = await removeShotRepo(sessionId, shotId);
  if (!updated) {
    throw new NotFoundError("Shot session not found.");
  }
  return updated;
}

/**
 * "Add a correction drill to a workout" from a single shot (BRD 7.5).
 *
 * Picks the drill via the same `drillSlugForBreakdown` mapping the session's
 * Mechanical Breakdown uses for that zone, so the drill the player adds is
 * the same fix the analysis told them about - and appends it to their pending
 * workout through the shared workoutService path rather than a parallel one.
 */
export async function addCorrectionDrillForShot(
  userId: ObjectId,
  sessionId: ObjectId,
  shotId: string,
): Promise<{ workoutId: ObjectId; drillName: string }> {
  const session = await findSessionByIdForUser(userId, sessionId);
  if (!session) {
    throw new NotFoundError("Shot session not found.");
  }

  const shot = session.shots.find((s) => s.id === shotId);
  if (!shot) {
    throw new NotFoundError("Shot not found in this session.");
  }

  const drill = await findDrillBySlug(
    drillSlugForBreakdown(shot.zone, sessionId),
  );
  if (!drill) {
    throw new NotFoundError(
      "No correction drill is available for that zone yet.",
    );
  }

  const workoutId = await addDrillToWorkout(userId, drill._id, {
    type: "shot_session",
    refId: sessionId,
    label: `${ZONE_LABELS[shot.zone]} correction - from your shooting session`,
  });

  return { workoutId, drillName: drill.name };
}

/**
 * Finalizes a session: computes real zone stats, generates the labeled
 * mechanical narrative for the weakest zone, and creates a real recommended
 * workout via the same engine Train/Player use (workoutGenerationService) -
 * reused, not duplicated.
 */
export interface FinalizeSessionResult {
  session: ShotSessionDoc;
  /**
   * Goals this session pushed over the line (BRD 7.12), so the caller can
   * tell the player in the moment rather than leaving them to find out.
   */
  newlyCompletedGoals: GoalDoc[];
  /**
   * Milestones this session earned (BRD 7.13). Genuinely new unlocks only,
   * never a backfilled stamp - see achievementService.
   */
  newlyUnlockedAchievements: AchievementDoc[];
}

export async function finalizeSession(
  userId: ObjectId,
  sessionId: ObjectId,
): Promise<FinalizeSessionResult> {
  const session = await requireOwnedProcessingSession(userId, sessionId);

  if (session.shots.length === 0) {
    throw new ValidationError(
      "Log at least one shot before finishing this session.",
    );
  }

  const totalAttempts = session.shots.length;
  const totalMakes = session.shots.filter((s) => s.made).length;
  const zoneBreakdown = computeZoneBreakdown(session.shots);
  const { bestZone, weakestZone } = findBestAndWeakestZones(zoneBreakdown);

  const trendCallouts: string[] = [];
  if (bestZone) {
    const stats = zoneBreakdown[bestZone]!;
    trendCallouts.push(
      `${ZONE_LABELS[bestZone]}: ${fgPercent(stats.makes, stats.attempts)}% - a real strength, keep feeding possessions here.`,
    );
  }
  if (weakestZone && weakestZone !== bestZone) {
    const stats = zoneBreakdown[weakestZone]!;
    trendCallouts.push(
      `${ZONE_LABELS[weakestZone]}: ${fgPercent(stats.makes, stats.attempts)}% - the clearest area to focus your next few sessions.`,
    );
  }

  let mechanicalBreakdown: ShotSessionDoc["mechanicalBreakdown"];
  let recommendedWorkoutId: ObjectId | undefined;

  // Four-part feedback for every shot (BRD 7.6: the structure applies to every
  // piece of feedback, not just the session summary). Done here rather than at
  // log time because the observation quotes session-wide zone tallies, which
  // only exist once logging has stopped.
  const shotFeedback =
    getShotMechanicalAnalysisProvider().provider.generateShotFeedback(
      session.shots,
    );
  const shotsWithFeedback = session.shots.map((shot) => {
    const feedback = shotFeedback.get(shot.id);
    return feedback
      ? { ...shot, feedback, feedbackText: feedback.headline }
      : shot;
  });

  // Only `weakestZone` is required: a single-zone session has no comparative
  // best zone, but it still deserves a breakdown and a recommended workout.
  if (weakestZone) {
    const { provider } = getShotMechanicalAnalysisProvider();
    const weakestStats = zoneBreakdown[weakestZone]!;
    const bestStats = bestZone ? zoneBreakdown[bestZone]! : undefined;
    const generated = await provider.generateBreakdown({
      sessionId,
      weakest: {
        zone: weakestZone,
        attempts: weakestStats.attempts,
        makes: weakestStats.makes,
        fgPercent: fgPercent(weakestStats.makes, weakestStats.attempts),
      },
      best:
        bestZone && bestStats
          ? {
              zone: bestZone,
              attempts: bestStats.attempts,
              makes: bestStats.makes,
              fgPercent: fgPercent(bestStats.makes, bestStats.attempts),
            }
          : undefined,
    });

    const drillSlug = drillSlugForBreakdown(weakestZone, sessionId);
    const drill = await findDrillBySlug(drillSlug);

    // The full nine-parameter analysis BRD 7.6 requires, alongside the
    // weakest-zone summary above. Drill slugs resolve in one batch query -
    // `shot-mechanics` is isomorphic and references drills by slug, the same
    // arrangement archetype signature moves use.
    const findings = await provider.generateFindings(
      { sessionId, shots: session.shots },
      weakestZone,
    );
    const findingDrills = await findDrillsBySlugs(
      findings.map((f) => f.drillSlug),
    );

    mechanicalBreakdown = {
      targetZone: weakestZone,
      ...generated,
      drillId: drill?._id,
      isSimulated: true,
      findings: findings.map((finding) => ({
        ...finding,
        drillId: findingDrills.get(finding.drillSlug)?._id,
      })),
    };

    try {
      const workout = await generateWorkout(userId, {
        targetSkills: ["shooting"],
        source: {
          type: "shot_session",
          refId: sessionId,
          label: `${ZONE_LABELS[weakestZone]} Shooting - built from your session`,
        },
      });
      recommendedWorkoutId = workout._id;
    } catch {
      // A missing equipment match shouldn't block finalizing the session
      // itself - the analysis is still real and useful without a workout.
      recommendedWorkoutId = undefined;
    }
  }

  const updated = await finalizeSessionRepo(sessionId, {
    status: "completed",
    shots: shotsWithFeedback,
    totalAttempts,
    totalMakes,
    fgPercent: fgPercent(totalMakes, totalAttempts),
    zoneBreakdown,
    bestZone,
    weakestZone,
    trendCallouts,
    mechanicalBreakdown,
  });
  if (!updated) {
    throw new NotFoundError("Shot session not found.");
  }

  if (recommendedWorkoutId) {
    await setRecommendedWorkout(sessionId, recommendedWorkoutId);
    updated.recommendedWorkoutId = recommendedWorkoutId;

    // BRD 7.15 "coach recommendations". Raised only when a real startable
    // workout was built, and it quotes the session's own tallies - Coach in
    // this app is reactive and never recommends unprompted, so a notification
    // implying it reached out on its own would be fiction. The recommendation
    // is the workout this session produced.
    if (weakestZone) {
      const stats = zoneBreakdown[weakestZone]!;
      await notifySessionRecommendation({
        userId,
        sessionId,
        zoneLabel: ZONE_LABELS[weakestZone],
        makes: stats.makes,
        attempts: stats.attempts,
        fgPercent: fgPercent(stats.makes, stats.attempts),
      });
    }
  }

  // Analyze -> Progress (v1.1 §7). Done here rather than in the action layer
  // so every finalize path updates Progress, exactly as workout completion
  // does. A failure to update counters must not lose the finalized session,
  // which is the real user data - so this is best-effort and logged.
  let newlyCompletedGoals: GoalDoc[] = [];
  let newlyUnlockedAchievements: AchievementDoc[] = [];
  try {
    await recordShotSessionCompletion(userId, { totalAttempts, totalMakes });
    // Analyze -> Goals (BRD 7.12): shooting goals advance off real logged
    // shots. Runs after the stats write, since some metrics read from it.
    newlyCompletedGoals = await recalculateGoalsForUser(userId);
    // Analyze -> Achievements (BRD 7.13). Last, because the milestones for
    // makes and sessions read the counters written above and "Goal Closed Out"
    // reads the statuses the line before just flipped.
    newlyUnlockedAchievements = await recordNewlyUnlockedAchievements(userId);
  } catch (err) {
    logger.error(
      {
        sessionId: sessionId.toString(),
        userId: userId.toString(),
        err,
      },
      "Failed to update Progress/Goals after finalizing a shot session",
    );
  }

  return { session: updated, newlyCompletedGoals, newlyUnlockedAchievements };
}
