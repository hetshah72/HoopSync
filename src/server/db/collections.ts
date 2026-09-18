import "server-only";
import type { Collection } from "mongodb";
import { COLLECTIONS } from "@/lib/db-constants";
import { getDb } from "@/server/db/client";
import type {
  AchievementDoc,
  CoachConversationDoc,
  CoachMessageDoc,
  ConfidenceCheckinDoc,
  DailyQuoteDoc,
  DrillDoc,
  FeedInteractionDoc,
  FeedItemDoc,
  GameFootageAnalysisDoc,
  GoalDoc,
  MediaAssetDoc,
  NbaPlayerDoc,
  NotificationDoc,
  PlayerProfileDoc,
  ShotSessionDoc,
  UserDoc,
  UserStatsDoc,
  WorkoutDoc,
} from "@/types/db";

/**
 * Typed collection accessors. Repositories should go through these rather
 * than calling `getDb()` directly, so collection typing stays centralized.
 */
export async function usersCollection(): Promise<Collection<UserDoc>> {
  return (await getDb()).collection<UserDoc>(COLLECTIONS.users);
}

export async function playerProfilesCollection(): Promise<
  Collection<PlayerProfileDoc>
> {
  return (await getDb()).collection<PlayerProfileDoc>(
    COLLECTIONS.playerProfiles,
  );
}

export async function nbaPlayersCollection(): Promise<
  Collection<NbaPlayerDoc>
> {
  return (await getDb()).collection<NbaPlayerDoc>(COLLECTIONS.nbaPlayers);
}

export async function drillsCollection(): Promise<Collection<DrillDoc>> {
  return (await getDb()).collection<DrillDoc>(COLLECTIONS.drills);
}

export async function workoutsCollection(): Promise<Collection<WorkoutDoc>> {
  return (await getDb()).collection<WorkoutDoc>(COLLECTIONS.workouts);
}

export async function shotSessionsCollection(): Promise<
  Collection<ShotSessionDoc>
> {
  return (await getDb()).collection<ShotSessionDoc>(
    COLLECTIONS.shotSessions,
  );
}

export async function gameFootageAnalysesCollection(): Promise<
  Collection<GameFootageAnalysisDoc>
> {
  return (await getDb()).collection<GameFootageAnalysisDoc>(
    COLLECTIONS.gameFootageAnalyses,
  );
}

export async function coachConversationsCollection(): Promise<
  Collection<CoachConversationDoc>
> {
  return (await getDb()).collection<CoachConversationDoc>(
    COLLECTIONS.coachConversations,
  );
}

export async function coachMessagesCollection(): Promise<
  Collection<CoachMessageDoc>
> {
  return (await getDb()).collection<CoachMessageDoc>(
    COLLECTIONS.coachMessages,
  );
}

export async function confidenceCheckinsCollection(): Promise<
  Collection<ConfidenceCheckinDoc>
> {
  return (await getDb()).collection<ConfidenceCheckinDoc>(
    COLLECTIONS.confidenceCheckins,
  );
}

export async function goalsCollection(): Promise<Collection<GoalDoc>> {
  return (await getDb()).collection<GoalDoc>(COLLECTIONS.goals);
}

export async function userStatsCollection(): Promise<
  Collection<UserStatsDoc>
> {
  return (await getDb()).collection<UserStatsDoc>(COLLECTIONS.userStats);
}

export async function achievementsCollection(): Promise<
  Collection<AchievementDoc>
> {
  return (await getDb()).collection<AchievementDoc>(COLLECTIONS.achievements);
}

export async function feedItemsCollection(): Promise<
  Collection<FeedItemDoc>
> {
  return (await getDb()).collection<FeedItemDoc>(COLLECTIONS.feedItems);
}

export async function feedInteractionsCollection(): Promise<
  Collection<FeedInteractionDoc>
> {
  return (await getDb()).collection<FeedInteractionDoc>(
    COLLECTIONS.feedInteractions,
  );
}

export async function dailyQuotesCollection(): Promise<
  Collection<DailyQuoteDoc>
> {
  return (await getDb()).collection<DailyQuoteDoc>(COLLECTIONS.dailyQuotes);
}

export async function mediaAssetsCollection(): Promise<
  Collection<MediaAssetDoc>
> {
  return (await getDb()).collection<MediaAssetDoc>(COLLECTIONS.mediaAssets);
}

export async function notificationsCollection(): Promise<
  Collection<NotificationDoc>
> {
  return (await getDb()).collection<NotificationDoc>(COLLECTIONS.notifications);
}
