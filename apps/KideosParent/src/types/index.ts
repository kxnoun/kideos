// Kideos for Parents — TypeScript types

import { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
type Timestamp = FirebaseFirestoreTypes.Timestamp;

export type SubscriptionTier = "free" | "premium";
export type SeedingStatus = "pending" | "ready" | "error";
export type SuggestionResponse = "approved" | "denied" | "pending";
export type ChildMode = "young" | "older";

// Questionnaire answers — defined with their logic in ../prefs.ts
export type { ValueFilters, Dim, DimRule, OverAction } from "../prefs";

export interface ChildProfile {
  name: string;
  age: number;
  avatar: string;
  mode: ChildMode;
}

export interface WhitelistedChannel {
  channelId: string;
  name: string;
  thumbnail: string;
  addedAt: Timestamp;
  addedBy: "parent" | "ai_suggestion";
  seedingStatus: SeedingStatus;
  videoCount: number;
}

export interface FlaggedContent {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  timestamp: Timestamp;
  reason: string;
  flags: string[];
  severity: "low" | "medium" | "high";
  status?: "hidden" | "pending_review"; // pending_review = waiting for your OK
  parentViewed?: boolean;
  resolution?: "approved" | "hidden";
}

export interface ChannelSuggestion {
  channelId: string;
  channelName: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  description: string;
  reason: string;
  generatedAt: Timestamp;
  parentResponse: SuggestionResponse;
}

export interface WeeklyDigest {
  weekOf: string;
  summary: string;
  totalHours: number;
  videoCount: number;
  flaggedCount: number;
  generatedAt: Timestamp;
}

export interface NowPlaying {
  videoId: string;
  title: string;
  channelName: string;
  thumbnail: string;
  startedAt: Timestamp;
}

// Navigation
export type RootStackParamList = {
  // Auth
  Auth: undefined;
  // Onboarding
  CreateChild: undefined;
  SetFilters: { childId: string; childAge: number };
  AddChannels: { childId: string };
  // Main tab navigator
  Main: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Channels: undefined;
  Digest: undefined;
  Settings: undefined;
};
