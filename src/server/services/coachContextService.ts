import "server-only";
import type { ObjectId } from "mongodb";
import { findSessionByIdForUser } from "@/server/repositories/shotSessionRepository";
import { findFeedItemById } from "@/server/repositories/feedRepository";
import { findWorkoutByIdForUser } from "@/server/repositories/workoutRepository";
import { findAnalysisByIdForUser } from "@/server/repositories/gameFootageRepository";
import { findPlayerById } from "@/server/repositories/nbaPlayerRepository";
import { findCheckinByIdForUser } from "@/server/repositories/confidenceRepository";
import { resolvePlayerEditorial } from "@/server/services/playerEditorialService";
import {
  formatConfidenceCheckinContext,
  formatFeedItemContext,
  formatGameFilmContext,
  formatNbaPlayerContext,
  formatShotSessionContext,
  formatWorkoutContext,
} from "@/lib/coach-context-format";
import type { CoachContextRef } from "@/types/db";

/**
 * Loads the full document behind each real context ref and formats it - the
 * LLM gets the actual session/feed/workout/game-film content, not a one-line
 * summary (BRD v1.1 §6/§8: "hands the full session context").
 */
export async function loadContextBlocks(
  userId: ObjectId,
  contextRefs: CoachContextRef[],
): Promise<string[]> {
  const blocks = await Promise.all(
    contextRefs.map((ref) => loadOneContextBlock(userId, ref)),
  );
  return blocks.filter((block): block is string => Boolean(block));
}

async function loadOneContextBlock(
  userId: ObjectId,
  ref: CoachContextRef,
): Promise<string | null> {
  switch (ref.type) {
    case "shot_session": {
      const session = await findSessionByIdForUser(userId, ref.refId);
      return session ? formatShotSessionContext(session, ref.shotId) : null;
    }
    case "feed_item": {
      const item = await findFeedItemById(ref.refId);
      return item ? formatFeedItemContext(item) : null;
    }
    case "workout": {
      const workout = await findWorkoutByIdForUser(userId, ref.refId);
      return workout ? formatWorkoutContext(workout) : null;
    }
    case "game_footage_analysis": {
      const analysis = await findAnalysisByIdForUser(userId, ref.refId);
      return analysis ? formatGameFilmContext(analysis) : null;
    }
    // Not user-scoped: the NBA roster is global, shared editorial content, the
    // same way `feed_item` is. There is nothing of this player's here to leak.
    case "nba_player": {
      const player = await findPlayerById(ref.refId);
      if (!player) return null;
      const resolved = await resolvePlayerEditorial(player);
      return formatNbaPlayerContext({
        name: player.name,
        team: player.team,
        position: player.position,
        sources: resolved.sources,
        archetype: resolved.archetype
          ? { label: resolved.archetype.label, summary: resolved.archetype.summary }
          : undefined,
        whatTheyDoWell: resolved.learn.whatTheyDoWell,
        signatureMoveNames: resolved.signatureMoves.map((m) => m.name),
        strengths: resolved.strengths,
        weaknesses: resolved.weaknesses,
      });
    }
    case "confidence_checkin": {
      const checkin = await findCheckinByIdForUser(userId, ref.refId);
      return checkin ? formatConfidenceCheckinContext(checkin) : null;
    }
    default: {
      const exhaustive: never = ref.type;
      return exhaustive;
    }
  }
}
