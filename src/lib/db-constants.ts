/**
 * Collection name constants, shared between the Next.js app (src/server/db)
 * and the standalone db scripts (scripts/db). Pure/isomorphic - no MongoDB
 * or Next.js imports here.
 */
export const COLLECTIONS = {
  users: "users",
  accounts: "accounts",
  sessions: "sessions",
  verificationTokens: "verificationTokens",
  playerProfiles: "playerProfiles",
  nbaPlayers: "nbaPlayers",
  drills: "drills",
  workouts: "workouts",
  shotSessions: "shotSessions",
  gameFootageAnalyses: "gameFootageAnalyses",
  coachConversations: "coachConversations",
  coachMessages: "coachMessages",
  confidenceCheckins: "confidenceCheckins",
  goals: "goals",
  userStats: "userStats",
  achievements: "achievements",
  feedItems: "feedItems",
  feedInteractions: "feedInteractions",
  dailyQuotes: "dailyQuotes",
  mediaAssets: "mediaAssets",
  notifications: "notifications",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
