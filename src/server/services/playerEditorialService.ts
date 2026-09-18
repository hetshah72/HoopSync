import "server-only";
import type { ObjectId } from "mongodb";
import {
  findDrillById,
  findDrillsBySlugs,
} from "@/server/repositories/drillRepository";
import { findFirstPlaceholderVideoAsset } from "@/server/repositories/mediaAssetRepository";
import {
  resolveMediaAsset,
  type MediaView,
} from "@/server/services/mediaProvenanceService";
import {
  archetypeFor,
  classifyArchetype,
  type PlayerArchetype,
} from "@/lib/player-archetypes";
import type {
  DrillDoc,
  NbaPlayerDoc,
  NbaPlayerSkillRatings,
  SignatureMove,
  StudyClipCallout,
} from "@/types/db";

/**
 * Resolves what a player profile actually shows.
 *
 * BRD 7.4 requires every profile across the full roster to carry at least
 * one Signature Move with a matching drill. Hand-authored editorial covers a
 * marquee tier; everyone else is backed by the authored archetype pack their
 * position/size classifies into (src/lib/player-archetypes.ts).
 *
 * `provenance` is the honesty contract: the UI must say which of the two a
 * profile is showing, the same way Analyze labels its simulated mechanical
 * narrative. Archetype content is a coaching profile for a *role*, never a
 * claim about the individual and never presented as NBA statistics.
 */
export type EditorialProvenance = "authored" | "archetype";

export interface ResolvedSignatureMove extends Omit<SignatureMove, "drillId"> {
  drillId: ObjectId;
  /** The real drill this move practises - surfaced so the card isn't a bare button. */
  drill: {
    id: ObjectId;
    name: string;
    description: string;
    coachingCues: string[];
    equipmentNeeded: string[];
  };
}

export interface ResolvedPlayerEditorial {
  /**
   * "authored" only when every section below came from hand-written content.
   * Anything else is "archetype", so the disclosure errs toward saying more
   * is role-based rather than less - partial authoring must never read as a
   * fully hand-written scouting profile.
   */
  provenance: EditorialProvenance;
  /** Which source each section actually came from. */
  sources: {
    learn: EditorialProvenance;
    skills: EditorialProvenance;
    signatureMoves: EditorialProvenance;
  };
  /** Present whenever any section fell back to the archetype pack. */
  archetype?: Pick<PlayerArchetype, "key" | "label" | "summary">;
  learn: NbaPlayerDoc["editorial"]["learn"];
  skills: NbaPlayerSkillRatings;
  strengths: string[];
  weaknesses: string[];
  bio: { careerInfo: string };
  signatureMoves: ResolvedSignatureMove[];
  /**
   * Fully resolved for rendering - the media asset is looked up here so the
   * page never reaches past the service layer for it.
   *
   * Call-outs come from the player's own authored clip when they have one,
   * and from their archetype pack otherwise, so every profile has something
   * real to study. `media` carries the disclosure required by BRD 6.4/7.14 -
   * the same descriptor every other surface renders, rather than a bespoke
   * boolean this one screen has to interpret.
   */
  studyClip?: {
    media: MediaView;
    callouts: StudyClipCallout[];
  };
}

function toDrillSummary(drill: DrillDoc): ResolvedSignatureMove["drill"] {
  return {
    id: drill._id,
    name: drill.name,
    description: drill.description,
    coachingCues: drill.coachingCues,
    equipmentNeeded: drill.equipmentNeeded,
  };
}

/** Hand-authored content counts only when it actually has a signature move. */
export function hasAuthoredEditorial(player: NbaPlayerDoc): boolean {
  return player.editorial.signatureMoves.length > 0;
}

export function archetypeKeyFor(player: NbaPlayerDoc) {
  return (
    player.archetypeKey ??
    classifyArchetype({
      position: player.position,
      heightInches: player.heightInches,
    })
  );
}

/** The seeded shell writes zeros; any real rating means someone authored them. */
function hasAuthoredSkills(skills: NbaPlayerSkillRatings): boolean {
  return Object.values(skills).some((value) => value > 0);
}

function hasAuthoredLearn(learn: NbaPlayerDoc["editorial"]["learn"]): boolean {
  return learn.whatTheyDoWell.trim().length > 0;
}

/**
 * Resolves each section independently.
 *
 * Content authoring is incremental - a player can get hand-written Learn
 * prose and skill ratings before anyone writes their signature moves, or
 * vice versa. An all-or-nothing check would either discard the authored work
 * or leave the profile without the signature move BRD 7.4 requires, so each
 * section falls back to the archetype pack on its own.
 */
export async function resolvePlayerEditorial(
  player: NbaPlayerDoc,
): Promise<ResolvedPlayerEditorial> {
  const { editorial } = player;
  const archetype = archetypeFor(archetypeKeyFor(player));

  const learnAuthored = hasAuthoredLearn(editorial.learn);
  const skillsAuthored = hasAuthoredSkills(editorial.skills);
  const movesAuthored = editorial.signatureMoves.length > 0;

  const signatureMoves = movesAuthored
    ? await resolveAuthoredMoves(editorial.signatureMoves)
    : await resolveArchetypeMoves(archetype);

  const sources = {
    learn: (learnAuthored ? "authored" : "archetype") as EditorialProvenance,
    skills: (skillsAuthored ? "authored" : "archetype") as EditorialProvenance,
    signatureMoves: (movesAuthored
      ? "authored"
      : "archetype") as EditorialProvenance,
  };

  const fullyAuthored = learnAuthored && skillsAuthored && movesAuthored;

  return {
    provenance: fullyAuthored ? "authored" : "archetype",
    sources,
    archetype: fullyAuthored
      ? undefined
      : {
          key: archetype.key,
          label: archetype.label,
          summary: archetype.summary,
        },
    learn: learnAuthored ? editorial.learn : archetype.learn,
    skills: skillsAuthored ? editorial.skills : archetype.skills,
    strengths:
      editorial.strengths.length > 0 ? editorial.strengths : archetype.strengths,
    weaknesses:
      editorial.weaknesses.length > 0 ? editorial.weaknesses : archetype.weaknesses,
    // Career info is a factual claim about a person - never synthesized from
    // an archetype. It stays empty rather than being filled with role prose.
    bio: editorial.bio,
    signatureMoves,
    studyClip: await resolveStudyClip(player),
  };
}

async function resolveAuthoredMoves(
  moves: SignatureMove[],
): Promise<ResolvedSignatureMove[]> {
  // Authored moves already carry a real drillId; look the drills up so the
  // card can show what the player is actually about to do.
  const drills = await findDrillsForMoves(moves);
  return moves.flatMap((move) => {
    const drill = drills.get(move.drillId.toString());
    // A move whose drill was removed from the library would otherwise render
    // a button that 404s on click - drop it rather than show it.
    if (!drill) return [];
    return [{ ...move, drill: toDrillSummary(drill) }];
  });
}

async function resolveArchetypeMoves(
  archetype: PlayerArchetype,
): Promise<ResolvedSignatureMove[]> {
  const drills = await findDrillsBySlugs(
    archetype.signatureMoves.map((move) => move.drillSlug),
  );

  return archetype.signatureMoves.flatMap((move) => {
    const drill = drills.get(move.drillSlug);
    // Same rule as authored moves: never render a move whose drill isn't in
    // the library. `npm run db:seed` keeps every archetype slug populated,
    // and tests/unit/player-archetypes.test.ts asserts that.
    if (!drill) return [];
    return [
      {
        id: move.id,
        name: move.name,
        whatItIs: move.whatItIs,
        whenUsed: move.whenUsed,
        whatMakesItEffective: move.whatMakesItEffective,
        keyMechanics: move.keyMechanics,
        commonMistakes: move.commonMistakes,
        drillId: drill._id,
        drill: toDrillSummary(drill),
      },
    ];
  });
}

/**
 * A study clip needs both footage and call-outs. The footage is always a
 * real media asset (provenance tracked on MediaAssetDoc per BRD 7.14); the
 * call-outs are the player's own when authored, and their archetype's
 * otherwise - so a roster-synced player still gets something concrete to
 * watch for rather than an empty tab.
 */
async function resolveStudyClip(
  player: NbaPlayerDoc,
): Promise<ResolvedPlayerEditorial["studyClip"]> {
  const authored = player.editorial.studyClip;
  const callouts =
    authored && authored.callouts.length > 0
      ? authored.callouts
      : archetypeStudyCallouts(player);

  if (callouts.length === 0) return undefined;

  // Without an asset there is nothing to play; the call-outs alone would be
  // a list of instructions about footage the player can't see.
  const assetId = authored?.mediaAssetId ?? (await findSharedPlaceholderAssetId());
  if (!assetId) return undefined;

  // Resolution refuses media it cannot vouch for, so a study clip whose asset
  // is missing or sits on a host we have no rights to renders as no clip at
  // all rather than as unattributed footage (BRD 7.14).
  const media = await resolveMediaAsset(assetId);
  if (!media) return undefined;

  return { media, callouts };
}

/**
 * Roster-synced players have no clip of their own. Rather than leave them
 * with nothing, they borrow the seeded placeholder asset - which is already
 * labeled as placeholder footage, so the disclosure stays accurate.
 */
async function findSharedPlaceholderAssetId(): Promise<ObjectId | undefined> {
  const asset = await findFirstPlaceholderVideoAsset();
  return asset?._id;
}

async function findDrillsForMoves(
  moves: SignatureMove[],
): Promise<Map<string, DrillDoc>> {
  const entries = await Promise.all(
    moves.map(async (move) => {
      const drill = await findDrillById(move.drillId);
      return drill ? ([move.drillId.toString(), drill] as const) : null;
    }),
  );
  return new Map(entries.filter((entry) => entry !== null));
}

/** Archetype call-outs, used when a player has no authored study clip of their own. */
export function archetypeStudyCallouts(player: NbaPlayerDoc): StudyClipCallout[] {
  return archetypeFor(archetypeKeyFor(player)).studyClipCallouts.map((callout) => ({
    atSeconds: callout.atSeconds,
    label: callout.label,
    text: callout.text,
  }));
}
