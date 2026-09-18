import "server-only";
import { ObjectId } from "mongodb";
import {
  completeAnalysis,
  createAnalysis,
  failAnalysis,
  findAnalysisByIdForUser,
  listAnalysesForUser as listAnalysesRepo,
} from "@/server/repositories/gameFootageRepository";
import { storeGameFootageVideo } from "@/server/services/videoStorageService";
import { analyzeWithBestProvider } from "@/server/services/gameFootageAnalysisProvider";
import { getProfileByUserId } from "@/server/services/profileService";
import { generateWorkout } from "@/server/services/workoutGenerationService";
import { recordGameFilmActivity } from "@/server/services/progressService";
import { recalculateGoalsForUser } from "@/server/services/goalService";
import { recordNewlyUnlockedAchievements } from "@/server/services/achievementService";
import { notifyGameFilmRecommendation } from "@/server/services/notificationService";
import {
  CATEGORY_TO_SKILL,
  GAME_CATEGORY_LABELS,
  type GameAnalysisCategory,
} from "@/lib/game-film-categories";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { GameFilmFrame } from "@/lib/game-film-vision";
import type {
  GameFilmSubject,
  GameFootageAnalysisDoc,
  SkillCategory,
} from "@/types/db";

export async function getAnalysisForUser(
  userId: ObjectId,
  analysisId: ObjectId,
): Promise<GameFootageAnalysisDoc | null> {
  return findAnalysisByIdForUser(userId, analysisId);
}

export async function listAnalysesForUser(
  userId: ObjectId,
): Promise<GameFootageAnalysisDoc[]> {
  return listAnalysesRepo(userId);
}

/**
 * Stores the upload and opens a `processing` analysis, without analysing yet.
 *
 * Split from the analysis pass because a real vision read takes tens of
 * seconds: holding the upload response open for it would violate the BRD 9.1
 * NFR ("the app must never freeze while processing video") and would put a
 * multi-frame model call inside the request the player is waiting on. The
 * route returns this id immediately and runs `runGameFootageAnalysis` after
 * the response - which is what the `processing` status, and the report
 * screen's polling, exist for.
 */
export async function startGameFootageAnalysis(
  userId: ObjectId,
  videoBuffer: Buffer,
  contentType: string,
  subject?: GameFilmSubject,
): Promise<GameFootageAnalysisDoc> {
  const mediaAsset = await storeGameFootageVideo(
    userId.toString(),
    videoBuffer,
    contentType,
  );

  const named = subject?.jerseyColor || subject?.jerseyNumber;

  return createAnalysis({
    userId,
    videoAssetId: mediaAsset._id,
    uploadedAt: new Date(),
    status: "processing",
    // Populated by the vision path only. Left empty rather than invented: a
    // fabricated timestamp is indistinguishable from a real one once it is
    // rendered as a seekable moment in the player's own video.
    events: [],
    strengths: [],
    weaknesses: [],
    recommendedWorkoutIds: [],
    ...(named ? { subject } : {}),
  });
}

/**
 * Analyse -> recommend -> record, for an analysis already opened by
 * `startGameFootageAnalysis` (BRD 7.7 success criterion: "Uploading a game
 * clip reliably returns strengths, weaknesses, and recommendations - not just
 * a processing confirmation").
 *
 * Runs after the upload response has been sent. `frames` are the stills the
 * browser lifted out of the clip; when they are absent, or a vision pass
 * fails, `analyzeWithBestProvider` degrades to the profile-based review and
 * reports that through `provenance`, so a fallback is never mislabelled as a
 * real read of the footage.
 */
export async function runGameFootageAnalysis(
  userId: ObjectId,
  analysisId: ObjectId,
  frames: GameFilmFrame[],
): Promise<GameFootageAnalysisDoc | null> {
  const analysis = await findAnalysisByIdForUser(userId, analysisId);
  if (!analysis) return null;

  try {
    const profile = await getProfileByUserId(userId);
    const generated = await analyzeWithBestProvider({
      analysisId: analysis._id.toString(),
      focusAreas: profile?.focusAreas ?? [],
      competitiveLevel: profile?.competitiveLevel,
      position: profile?.position,
      subject: analysis.subject,
      frames,
    });

    const recommendedWorkoutIds = await buildWorkoutsForWeaknesses(
      userId,
      generated.weaknesses.map((w) => w.category as GameAnalysisCategory),
    );

    const completed = await completeAnalysis(analysis._id, {
      strengths: generated.strengths,
      weaknesses: generated.weaknesses,
      recommendedWorkoutIds,
      basis: generated.basis,
      provenance: generated.provenance,
      events: generated.events,
      ...(generated.framesAnalyzed !== undefined
        ? { framesAnalyzed: generated.framesAnalyzed }
        : {}),
    });

    // Reviewing game film is real training activity, so it advances the
    // streak the same way a shooting session does - a player who only
    // uploads game footage shouldn't show a broken streak.
    try {
      await recordGameFilmActivity(userId);
      // Game Film -> Goals (BRD 7.12): the third activity choke point. What
      // advances is a count of films actually reviewed, never anything drawn
      // from the simulated analysis above. Best-effort, like the Progress
      // write - a goal failure must not lose the analysis.
      await recalculateGoalsForUser(userId);
      // Game Film -> Achievements (BRD 7.13), which is what earns "Film
      // Reviewed". Counts completed analyses only, so a failed upload never
      // credits a review that produced nothing.
      await recordNewlyUnlockedAchievements(userId);
    } catch (err) {
      logger.error(
        { userId: userId.toString(), analysisId: analysis._id.toString(), err },
        "Failed to update Progress/Goals after game footage analysis",
      );
    }

    // BRD 7.15 "coach recommendations", only when the review actually built
    // something startable. The copy states the review is heuristic rather than
    // detected, matching the disclosure `coach-context-format.ts` already
    // requires wherever this analysis is referenced.
    const primaryWeakness = generated.weaknesses[0];
    if (recommendedWorkoutIds.length > 0 && primaryWeakness) {
      await notifyGameFilmRecommendation({
        userId,
        analysisId: analysis._id,
        weaknessLabel:
          GAME_CATEGORY_LABELS[
            primaryWeakness.category as GameAnalysisCategory
          ] ?? primaryWeakness.category,
        workoutCount: recommendedWorkoutIds.length,
      });
    }

    return completed ?? analysis;
  } catch (err) {
    logger.error(
      { userId: userId.toString(), analysisId: analysis._id.toString(), err },
      "Game footage analysis failed",
    );
    const failed = await failAnalysis(
      analysis._id,
      "We couldn't finish reviewing that clip. Your upload is saved - try again from the Game Film screen.",
    );
    return failed ?? analysis;
  }
}

/**
 * BRD v1.1 §7's "Game Weakness -> Recommended Workout", and BRD 7.7's "turn
 * each identified weakness into a recommended, buildable workout".
 *
 * One real, startable workout per weakness, built by the same deterministic
 * engine Train uses - not a separate pipeline. A weakness whose skill has no
 * usable drills for this player is skipped rather than failing the whole
 * analysis: a report with two of three workouts is still useful, and the
 * generator's own error already explains the gap on the Train side.
 */
async function buildWorkoutsForWeaknesses(
  userId: ObjectId,
  categories: GameAnalysisCategory[],
): Promise<ObjectId[]> {
  const workoutIds: ObjectId[] = [];
  const seenSkills = new Set<SkillCategory>();

  for (const category of categories) {
    const skill = CATEGORY_TO_SKILL[category];
    // Two weaknesses can map to the same skill (spacing and off-ball movement
    // are both footwork); one workout covers both rather than two identical
    // ones cluttering Train.
    if (seenSkills.has(skill)) continue;
    seenSkills.add(skill);

    try {
      const workout = await generateWorkout(userId, {
        targetSkills: [skill],
        source: {
          type: "game_analysis",
          label: `${GAME_CATEGORY_LABELS[category]} - from your game film`,
        },
      });
      workoutIds.push(workout._id);
    } catch (err) {
      logger.info(
        { userId: userId.toString(), category, err },
        "No workout could be built for a game-film weakness",
      );
    }
  }

  return workoutIds;
}

/** Used by the report route to fail cleanly on an unknown id. */
export async function requireAnalysisForUser(
  userId: ObjectId,
  analysisId: ObjectId,
): Promise<GameFootageAnalysisDoc> {
  const analysis = await findAnalysisByIdForUser(userId, analysisId);
  if (!analysis) {
    throw new NotFoundError("Game film analysis not found.");
  }
  return analysis;
}
