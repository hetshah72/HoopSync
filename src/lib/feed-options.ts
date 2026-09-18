import type { FeedItemDoc, FeedItemKind, FeedItemType } from "@/types/db";

export const FEED_TYPE_LABELS: Record<FeedItemType, string> = {
  tip: "Tip",
  lesson: "Lesson",
  drill_demo: "Drill Demo",
  player_breakdown: "Player Breakdown",
  ai_recommendation: "For You",
  confidence_tip: "Confidence",
  try_today: "Try Today",
  player_study: "Player Study",
};

/**
 * Badge text for generated cards.
 *
 * Generated cards are badged by `kind` rather than `type` because four
 * distinct kinds share the `ai_recommendation` type, and labelling all of
 * them "For You" would tell the player nothing about which is which.
 */
export const FEED_KIND_LABELS: Record<Exclude<FeedItemKind, "library">, string> = {
  daily_workout: "Today's Workout",
  weakness_callout: "Your Numbers",
  progress_update: "Your Progress",
  goal_nudge: "Your Goal",
  next_step: "Next Step",
  player_to_study: "Player Study",
  try_today: "Try Today",
  confidence_boost: "Confidence",
  achievement_unlocked: "Milestone",
};

/**
 * Documents seeded before generated cards existed carry no `kind`. They are
 * all authored library content, so that is what an absent value means.
 */
export function feedItemKind(item: Pick<FeedItemDoc, "kind">): FeedItemKind {
  return item.kind ?? "library";
}

/** Generated cards are per-user; library cards are global. */
export function isGeneratedKind(kind: FeedItemKind): boolean {
  return kind !== "library";
}

/**
 * The order generated cards appear in, ahead of the authored library.
 *
 * This is a product judgement, not a score: whatever else is true, a player
 * opening the app should first see what to do today, then what the data says
 * about them, then encouragement - so the daily workout always leads and the
 * library fills in behind. Ranking within the library is still earned
 * (see feedService), but these five never compete for position.
 */
export const GENERATED_KIND_ORDER: FeedItemKind[] = [
  "daily_workout",
  "weakness_callout",
  "next_step",
  "progress_update",
  "goal_nudge",
  "player_to_study",
  "try_today",
  "confidence_boost",
  // Last, deliberately. BRD 7.13 carries explicit founder guidance that
  // gamification must never become more prominent than the app's actual
  // development/coaching value, so a milestone never outranks a single card
  // that tells the player what to train. It is also the only kind here that
  // usually isn't drafted at all - see draftAchievement.
  "achievement_unlocked",
];
