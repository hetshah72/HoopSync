import "server-only";
import type { ObjectId } from "mongodb";
import {
  bulkUpsertSyncedPlayers,
  countPlayers,
  findPlayerById,
  listExistingPlayerNames,
  listPlayers as listPlayersRepo,
  listTeams as listTeamsRepo,
  type ListPlayersOptions,
  type ListPlayersResult,
} from "@/server/repositories/nbaPlayerRepository";
import { fetchAllActivePlayers } from "@/server/external/balldontlieClient";
import { buildRosterSyncOperations } from "@/lib/nba-roster";
import { NotFoundError, ValidationError } from "@/server/errors";
import { startDrillAsWorkout } from "@/server/services/workoutService";
import { generateWorkout } from "@/server/services/workoutGenerationService";
import { findDrillsByIds } from "@/server/repositories/drillRepository";
import { derivePlayerTendencies } from "@/lib/player-tendencies";
import {
  resolvePlayerEditorial,
  type ResolvedPlayerEditorial,
} from "@/server/services/playerEditorialService";
import type { NbaPlayerDoc, NbaPlayerSkillRatings, SkillCategory, WorkoutDoc } from "@/types/db";

/**
 * Re-exported so the Players page can size its "show more" step without
 * importing from the repository layer directly (CLAUDE.md: app/** reaches
 * services, never repositories).
 */
export { PLAYERS_PAGE_SIZE } from "@/server/repositories/nbaPlayerRepository";

export async function listPlayers(
  options: ListPlayersOptions = {},
): Promise<ListPlayersResult> {
  return listPlayersRepo(options);
}

export async function getPlayer(id: ObjectId): Promise<NbaPlayerDoc | null> {
  return findPlayerById(id);
}

export async function playerCount(): Promise<number> {
  return countPlayers();
}

export async function listTeams(): Promise<string[]> {
  return listTeamsRepo();
}

/** The player plus whatever actually backs their profile (authored or archetype). */
export async function getPlayerProfile(
  id: ObjectId,
): Promise<{ player: NbaPlayerDoc; editorial: ResolvedPlayerEditorial } | null> {
  const player = await findPlayerById(id);
  if (!player) return null;
  return { player, editorial: await resolvePlayerEditorial(player) };
}

export interface SyncResult {
  fetched: number;
  created: number;
  matched: number;
  skipped: number;
}

/**
 * Syncs the full current active-player roster from balldontlie (BRD 7.4:
 * must not be a hardcoded/limited list).
 *
 * Reconciles by exact name against any editorial-seeded player (see
 * scripts/db/seed.ts) so hand-authored Learn/Skills/Signature-Move content
 * is adopted by the real player record rather than duplicated - the bulk
 * operations only ever `$setOnInsert` the editorial shell, so an existing
 * player's authored content is never touched.
 *
 * Players with no authored content are not left blank: `archetypeKey` is
 * computed here from position/height, and playerEditorialService resolves it
 * to a real, labeled coaching profile with a startable signature-move drill.
 */
export async function syncRoster(): Promise<SyncResult> {
  const players = await fetchAllActivePlayers();
  const existingNames = await listExistingPlayerNames();

  const { operations, created, matched, skipped } = buildRosterSyncOperations(
    players,
    existingNames,
    new Date(),
  );

  await bulkUpsertSyncedPlayers(operations);

  return { fetched: players.length, created, matched, skipped };
}

/**
 * Player -> Signature Move -> Drill -> Workout (BRD v1.1 §7 required flow).
 * Reuses the same real workout-creation path Feed's "Start Drill" uses
 * (workoutService.startDrillAsWorkout), just with player-sourced context.
 *
 * Resolves through playerEditorialService, so this works identically for a
 * hand-authored player and for a roster-synced one backed by an archetype.
 */
export async function startWorkoutFromSignatureMove(
  userId: ObjectId,
  playerId: ObjectId,
  signatureMoveId: string,
): Promise<ObjectId> {
  const player = await findPlayerById(playerId);
  if (!player) {
    throw new NotFoundError("Player not found.");
  }

  const editorial = await resolvePlayerEditorial(player);
  const move = editorial.signatureMoves.find((m) => m.id === signatureMoveId);
  if (!move) {
    throw new ValidationError("Signature move not found for this player.");
  }

  return startDrillAsWorkout(userId, move.drillId, {
    type: "player",
    refId: player._id,
    label: `${player.name}: ${move.name}`,
  });
}

export const SKILL_RATING_TO_CATEGORY: Record<
  keyof NbaPlayerSkillRatings,
  SkillCategory
> = {
  shooting: "shooting",
  finishing: "finishing",
  ballHandling: "ball_handling",
  playmaking: "playmaking",
  defense: "defense",
  athleticism: "athletic_development",
};

/**
 * The player's own highest-rated skills - what makes their game worth
 * modeling. Ties are broken by the declaration order above rather than by
 * whatever order Object.entries happens to produce, so an all-equal profile
 * is at least deterministic instead of arbitrary.
 */
export function getTopSkillCategories(
  skills: NbaPlayerSkillRatings,
  count = 2,
): SkillCategory[] {
  const keys = Object.keys(SKILL_RATING_TO_CATEGORY) as (keyof NbaPlayerSkillRatings)[];
  return keys
    .map((key, index) => ({ key, value: skills[key], index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, count)
    .map((entry) => SKILL_RATING_TO_CATEGORY[entry.key]);
}

/**
 * "I want to play more like <Player>" (BRD 7.3) - generates a real,
 * multi-drill workout targeting that player's strongest skill categories,
 * reusing the exact same deterministic generation engine Train's own
 * skill/weakness-driven flow uses (workoutGenerationService.generateWorkout).
 *
 * Reads the *resolved* skills, so a roster-synced player targets their
 * archetype's real emphasis rather than the flat placeholder ratings that
 * previously made this an arbitrary tie-break.
 */
export async function generateWorkoutFromPlayer(
  userId: ObjectId,
  playerId: ObjectId,
): Promise<WorkoutDoc> {
  const player = await findPlayerById(playerId);
  if (!player) {
    throw new NotFoundError("Player not found.");
  }

  const editorial = await resolvePlayerEditorial(player);

  // The drills an editor linked to this player's signature moves are the
  // strongest available statement of what defines their game, so their skill
  // tags lead the resolution.
  //
  // Only *authored* moves count as that statement. When the moves came from
  // the player's archetype pack they describe the role, not the individual,
  // so feeding their drill tags in as a tier-1 signal would reintroduce
  // exactly the "arbitrary but confident" result audit Bug NBA-3 was about -
  // every wing would model as a shooter regardless of their own ratings.
  const moveDrills =
    editorial.sources.signatureMoves === "authored"
      ? await findDrillsByIds(editorial.signatureMoves.map((move) => move.drillId))
      : [];

  const tendencies = derivePlayerTendencies({
    signatureMoveSkillTags: moveDrills.map((drill) => drill.skillTags),
    // Authored strengths only, for the same reason: archetype strengths are
    // prose about a role. Reading them as tier-2 signal would let generic
    // role text outrank this player's own skill ratings.
    strengths: player.editorial.strengths,
    skills: editorial.skills,
    position: player.position,
  });

  // Now reachable, unlike the rating-count check it replaces: an unauthored
  // player with flat ratings and an unknown position genuinely resolves to
  // nothing, and saying so beats inventing a focus (audit Bug NBA-3).
  if (tendencies.skills.length === 0) {
    throw new ValidationError(
      `We don't know enough about ${player.name}'s game yet to model a workout on it. Pick a player with a Learn breakdown, or generate a workout by skill.`,
    );
  }

  return generateWorkout(userId, {
    targetSkills: tendencies.skills,
    subject: player.name,
    source: { type: "player", refId: player._id },
  });
}
