"use server";

import { ObjectId } from "mongodb";
import { requireUserId } from "@/server/auth/require-session";
import { objectIdString } from "@/lib/validation/common";
import { ValidationError } from "@/server/errors";
import {
  generateWorkoutFromPlayer,
  listPlayers,
  startWorkoutFromSignatureMove,
} from "@/server/services/nbaPlayerService";
import { findPlayerById } from "@/server/repositories/nbaPlayerRepository";
import { resolvePlayerEditorial } from "@/server/services/playerEditorialService";
import { getProfileByUserId } from "@/server/services/profileService";
import { startConversationFromNbaPlayer } from "@/server/services/coachService";

function parsePlayerId(playerId: string): ObjectId {
  const parsed = objectIdString.safeParse(playerId);
  if (!parsed.success) {
    throw new ValidationError("Invalid player id.");
  }
  return new ObjectId(parsed.data);
}

export async function startWorkoutFromSignatureMoveAction(
  playerId: string,
  signatureMoveId: string,
): Promise<{ workoutId: string }> {
  const userId = await requireUserId();
  const workoutId = await startWorkoutFromSignatureMove(
    new ObjectId(userId),
    parsePlayerId(playerId),
    signatureMoveId,
  );
  return { workoutId: workoutId.toString() };
}

export async function generateWorkoutFromPlayerAction(
  playerId: string,
): Promise<{ workoutId: string }> {
  const userId = await requireUserId();
  const workout = await generateWorkoutFromPlayer(
    new ObjectId(userId),
    parsePlayerId(playerId),
  );
  return { workoutId: workout._id.toString() };
}

/**
 * "Ask Coach" from a player profile (BRD 7.9 "discuss player-study content").
 *
 * Resolves the editorial here rather than in `coachService` so the service is
 * handed the provenance as a fact instead of re-deriving it - and so the
 * archetype-vs-authored distinction is settled in exactly one place
 * (`resolvePlayerEditorial`) for every surface that needs it.
 *
 * Returns the id rather than redirecting, for the reason `feedActions`
 * documents: `redirect()` throws internally, and a client `try/catch` around
 * the call would report a successful navigation as an error.
 */
export async function askCoachAboutPlayerAction(
  playerId: string,
): Promise<{ conversationId: string }> {
  const userId = await requireUserId();
  const player = await findPlayerById(parsePlayerId(playerId));
  if (!player) {
    throw new ValidationError("Player not found.");
  }

  const [editorial, profile] = await Promise.all([
    resolvePlayerEditorial(player),
    getProfileByUserId(new ObjectId(userId)),
  ]);

  const conversationId = await startConversationFromNbaPlayer(
    new ObjectId(userId),
    profile?.coachPersonality ?? "balanced",
    player,
    {
      provenance: editorial.provenance,
      archetypeLabel: editorial.archetype?.label,
    },
  );
  return { conversationId: conversationId.toString() };
}

const PLAYER_SEARCH_LIMIT = 20;

/**
 * Backs Train's "model a player" picker. Returns a slim, serializable DTO
 * rather than whole player documents - the picker only needs enough to
 * identify someone, and ObjectIds can't cross the server/client boundary.
 */
export async function searchPlayersForWorkoutAction(
  search: string,
): Promise<Array<{ id: string; name: string; team: string; position: string }>> {
  await requireUserId();
  const trimmed = search.trim();
  if (trimmed.length < 2) return [];

  const { players } = await listPlayers({
    search: trimmed,
    limit: PLAYER_SEARCH_LIMIT,
  });

  return players.map((player) => ({
    id: player._id.toString(),
    name: player.name,
    team: player.team,
    position: player.position,
  }));
}
