import "server-only";
import type { ObjectId } from "mongodb";
import {
  findFeedItemById,
  findQuoteForDay,
  listFeedItemsByIds,
  listInteractionsForUser,
  listInteractionsForUserByAction,
  listLibraryFeedItems,
  recordShareOnce,
  toggleInteraction as toggleInteractionRepo,
} from "@/server/repositories/feedRepository";
import { generateDailyFeed } from "@/server/services/feedGenerationService";
import {
  resolveMediaAssets,
  type MediaView,
} from "@/server/services/mediaProvenanceService";
import { evaluateScheduledNotifications } from "@/server/services/notificationService";
import { feedItemKind, GENERATED_KIND_ORDER } from "@/lib/feed-options";
import { orderDeterministically } from "@/lib/deterministic";
import { todayStamp } from "@/lib/day-stamp";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { FeedItemDoc, FeedItemKind, FeedItemProvenance } from "@/types/db";

export interface FeedRelatedLink {
  label: string;
  href: string;
}

export interface FeedItemView {
  id: string;
  kind: FeedItemKind;
  type: FeedItemDoc["type"];
  title: string;
  body: string;
  tags: string[];
  relatedDrillId: string | null;
  relatedPlayerId: string | null;
  relatedWorkoutId: string | null;
  relatedSessionId: string | null;
  liked: boolean;
  saved: boolean;
  /** Real, navigable destinations - never decorative text (audit Bug Feed-9). */
  related: FeedRelatedLink[];
  provenance: FeedItemProvenance | null;
  /**
   * The card's clip, with the disclosure it must be shown under (BRD 7.14).
   *
   * `FeedItemDoc.mediaAssetId` existed from the start and this view dropped it
   * on the floor, so the one seeded media-bearing card promised "see the
   * footwork and timing" and rendered nothing at all. Null means either no
   * media or media that could not be vouched for - both render the same
   * honest nothing, never a bare URL.
   */
  media: MediaView | null;
}

export interface PersonalizedFeed {
  quote: { text: string; author: string } | null;
  items: FeedItemView[];
}

/**
 * How strongly a library card matches what this player is working on.
 *
 * Still deliberately a lookup rather than a model, but no longer only
 * `focusAreas`: the audit's finding was that "no shot-session, workout, goal,
 * streak, like, save, or share signal is ever read". Target skills now come
 * from real activity (see feedSignalsService), so a player whose shooting
 * data says "left wing" gets shooting content ranked up even if they picked
 * different focus areas at onboarding and never revisited them.
 */
function scoreLibraryItem(item: FeedItemDoc, weightedTags: Set<string>): number {
  return item.tags.filter((tag) => weightedTags.has(tag)).length;
}

/**
 * Related content, as links that actually go somewhere.
 *
 * Previously this was a list of plain-text titles - "the only feed control
 * that touches no server code at all" (audit Bug Feed-9 / FEED-09). There is
 * no drill detail route in this app, so a drill relates through to Train and
 * a player through to their profile; anything else falls back to library
 * cards sharing a tag, which at least land on something real.
 */
function relatedLinksFor(
  item: FeedItemDoc,
  library: FeedItemDoc[],
  limit = 2,
): FeedRelatedLink[] {
  const links: FeedRelatedLink[] = [];

  if (item.relatedPlayerId) {
    links.push({
      label: "Open this player's profile",
      href: `/players/${item.relatedPlayerId.toString()}`,
    });
  }
  if (item.relatedSessionId) {
    links.push({
      label: "Open the shooting report",
      href: `/analyze/shooting/${item.relatedSessionId.toString()}`,
    });
  }
  if (item.relatedWorkoutId) {
    links.push({
      label: "Open this workout",
      href: `/train/${item.relatedWorkoutId.toString()}`,
    });
  }
  // A confidence tip is the one card kind whose destination isn't a document
  // id - it points at the feature itself (BRD 7.10), which is otherwise
  // reachable only from a single card on Home.
  if (feedItemKind(item) === "confidence_boost" || item.type === "confidence_tip") {
    links.push({
      label: "Get a routine for how you're feeling",
      href: "/confidence",
    });
  }

  if (links.length < limit) {
    for (const other of library) {
      if (links.length >= limit) break;
      if (other._id.equals(item._id)) continue;
      if (!other.tags.some((tag) => item.tags.includes(tag))) continue;
      links.push({ label: other.title, href: `/home#card-${other._id.toString()}` });
    }
  }

  return links.slice(0, limit);
}

/**
 * One batched resolve for a whole feed, rather than one lookup per card.
 * Cards with no media contribute no ids, so a feed without clips issues no
 * query at all (`listMediaAssetsByIds` short-circuits on an empty array).
 */
async function mediaForItems(
  items: FeedItemDoc[],
): Promise<Map<string, MediaView>> {
  const assetIds = items
    .map((item) => item.mediaAssetId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  return resolveMediaAssets(assetIds);
}

function toView(
  item: FeedItemDoc,
  likedIds: Set<string>,
  savedIds: Set<string>,
  library: FeedItemDoc[],
  mediaById: Map<string, MediaView>,
): FeedItemView {
  const id = item._id.toString();
  return {
    id,
    kind: feedItemKind(item),
    type: item.type,
    title: item.title,
    body: item.body,
    tags: item.tags,
    relatedDrillId: item.relatedDrillId?.toString() ?? null,
    relatedPlayerId: item.relatedPlayerId?.toString() ?? null,
    relatedWorkoutId: item.relatedWorkoutId?.toString() ?? null,
    relatedSessionId: item.relatedSessionId?.toString() ?? null,
    liked: likedIds.has(id),
    saved: savedIds.has(id),
    related: relatedLinksFor(item, library),
    provenance: item.provenance ?? null,
    media: item.mediaAssetId
      ? (mediaById.get(item.mediaAssetId.toString()) ?? null)
      : null,
  };
}

function interactionSets(
  interactions: Awaited<ReturnType<typeof listInteractionsForUser>>,
): { likedIds: Set<string>; savedIds: Set<string> } {
  const likedIds = new Set<string>();
  const savedIds = new Set<string>();
  for (const interaction of interactions) {
    const id = interaction.feedItemId.toString();
    if (interaction.action === "like") likedIds.add(id);
    if (interaction.action === "save") savedIds.add(id);
  }
  return { likedIds, savedIds };
}

/**
 * The player's feed for today.
 *
 * Generation runs first and is what makes the feed personal; the authored
 * library fills in behind it, reordered daily so the mix genuinely changes
 * (BRD 7.2: "feed content changes daily"). A generation failure degrades to
 * the library rather than an error page - a feed with fewer cards is a far
 * better outcome than no Home screen.
 */
export async function getPersonalizedFeed(
  userId: ObjectId,
  now: Date = new Date(),
): Promise<PersonalizedFeed> {
  const dayStamp = todayStamp(now);

  const [generated, library, quote, interactions] = await Promise.all([
    generateDailyFeed(userId, dayStamp).catch((err) => {
      logger.error(
        { userId: userId.toString(), dayStamp, err },
        "Daily feed generation failed; falling back to library content",
      );
      return null;
    }),
    listLibraryFeedItems(),
    findQuoteForDay(dayStamp),
    listInteractionsForUser(userId),
  ]);

  const { likedIds, savedIds } = interactionSets(interactions);

  // Time-triggered notifications (BRD 7.15), evaluated off the signals feed
  // generation just computed rather than loading them a second time.
  //
  // Home is where this belongs: it is where a returning player lands, and
  // there is still no scheduler in this codebase to hang a nightly job off -
  // the same trade `generateDailyFeed` documents. Each of the three reminders
  // is keyed by calendar day, so this is at most three guarded upserts and
  // usually zero writes. It never blocks or fails the feed.
  if (generated) {
    await evaluateScheduledNotifications(
      userId,
      {
        stats: generated.signals.stats,
        lastCompletedWorkoutAt:
          generated.signals.lastCompletedWorkout?.completedAt,
        hasActivity: generated.signals.hasActivity,
      },
      now,
    );
  }

  // Tags worth ranking library content by: what the player declared, plus
  // what their activity actually says they should work on.
  const weightedTags = new Set<string>([
    ...(generated?.signals.profile?.focusAreas ?? []),
    ...(generated?.signals.targetSkills ?? []),
  ]);

  const rotationKey = `${userId.toString()}:${dayStamp}`;
  const rankedLibrary = orderDeterministically(
    library,
    rotationKey,
    (item) => item._id.toString(),
  ).sort((a, b) => scoreLibraryItem(b, weightedTags) - scoreLibraryItem(a, weightedTags));

  const generatedCards = (generated?.cards ?? []).slice().sort(
    (a, b) =>
      GENERATED_KIND_ORDER.indexOf(feedItemKind(a)) -
      GENERATED_KIND_ORDER.indexOf(feedItemKind(b)),
  );

  const ordered = [...generatedCards, ...rankedLibrary];
  const mediaById = await mediaForItems(ordered);

  return {
    quote: quote ? { text: quote.text, author: quote.author } : null,
    items: ordered.map((item) =>
      toView(item, likedIds, savedIds, library, mediaById),
    ),
  };
}

/**
 * A feed card that is known to carry playable, vouched-for media.
 *
 * The non-null `media` is the whole point: the reel never has to decide what
 * to do about a clip it cannot describe, because such a card never reaches it.
 */
export type ClipView = FeedItemView & { media: MediaView };

export interface ClipReel {
  clips: ClipView[];
  /** Where to open, resolved from the card the player tapped. */
  startIndex: number;
  /** How many media-bearing cards exist, when more than the window shows. */
  totalAvailable: number;
}

/**
 * The most clips one screen session will page through.
 *
 * Bounded because every mounted slide is a potential video connection, not
 * because the feed is ever this long today.
 */
const REEL_WINDOW = 20;

/**
 * The short-form reel (BRD 7.14: "a TikTok/Instagram consumption model").
 *
 * Built from the same personalized feed Home renders rather than a parallel
 * content store, so a clip's ranking, its provenance and its six actions are
 * the ones already under test - the reel is a second presentation of the
 * feed, not a second feed.
 *
 * WRITE PATH, not a read path: `getPersonalizedFeed` generates the day's cards
 * on first view, which means a Mongo write, an optional copy-writer call, and
 * notification evaluation. Opening /clips as the first screen of the day pays
 * Home's full generation cost, which is why /clips has a `loading.tsx` of its
 * own (see src/app/(app)/clips/loading.tsx).
 */
export async function getClipReel(
  userId: ObjectId,
  startFeedItemId?: string,
  now: Date = new Date(),
): Promise<ClipReel> {
  const feed = await getPersonalizedFeed(userId, now);

  // Video only. An image-bearing card has nothing to play full-screen, and
  // silently showing a still in a video surface would misrepresent it.
  const all = feed.items.filter(
    (item): item is ClipView =>
      item.media !== null && item.media.type === "video",
  );

  // Resolved against the FULL list before windowing. Slicing first would make
  // a deep link to clip 21+ resolve to -1 and silently open clip 1 instead -
  // a different clip, under a different disclosure, than the one tapped.
  const requestedIndex = startFeedItemId
    ? all.findIndex((clip) => clip.id === startFeedItemId)
    : -1;
  const anchor = requestedIndex === -1 ? 0 : requestedIndex;

  // Window around the anchor rather than from the top, so the tapped clip is
  // always inside the slice it is an index into.
  const start = Math.max(0, Math.min(anchor - Math.floor(REEL_WINDOW / 2), all.length - REEL_WINDOW));
  const from = Math.max(0, start);

  return {
    clips: all.slice(from, from + REEL_WINDOW),
    startIndex: anchor - from,
    totalAvailable: all.length,
  };
}

/**
 * Everything this player has saved, newest first.
 *
 * BRD 11.2 requires saved content to appear in Saved; the audit found Save to
 * be "a working write nobody can ever read back". Saved cards can include
 * generated ones that were later superseded, so anything no longer present is
 * simply dropped rather than rendered as a broken row.
 */
export async function getSavedFeed(userId: ObjectId): Promise<FeedItemView[]> {
  const saves = await listInteractionsForUserByAction(userId, "save");
  if (saves.length === 0) return [];

  const items = await listFeedItemsByIds(saves.map((save) => save.feedItemId));
  const byId = new Map(items.map((item) => [item._id.toString(), item]));

  const [library, interactions] = await Promise.all([
    listLibraryFeedItems(),
    listInteractionsForUser(userId),
  ]);
  const { likedIds, savedIds } = interactionSets(interactions);

  const savedItems = saves
    .map((save) => byId.get(save.feedItemId.toString()))
    .filter((item): item is FeedItemDoc => Boolean(item));
  const mediaById = await mediaForItems(savedItems);

  return savedItems.map((item) =>
    toView(item, likedIds, savedIds, library, mediaById),
  );
}

export async function toggleInteraction(
  userId: ObjectId,
  feedItemId: ObjectId,
  action: "like" | "save",
): Promise<boolean> {
  return toggleInteractionRepo(userId, feedItemId, action);
}

/** Records the share and returns a short shareable text for the client. */
export async function recordShare(
  userId: ObjectId,
  feedItemId: ObjectId,
): Promise<string> {
  const item = await findFeedItemById(feedItemId);
  if (!item) {
    throw new NotFoundError("Feed item not found.");
  }
  await recordShareOnce(userId, feedItemId);
  return `${item.title} - via HoopSync`;
}
