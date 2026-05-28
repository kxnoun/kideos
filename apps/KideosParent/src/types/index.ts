// Kideos for Parents — TypeScript types

import { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
type Timestamp = FirebaseFirestoreTypes.Timestamp;

export type SubscriptionTier = "free" | "premium";
export type SeedingStatus = "pending" | "ready" | "error";
export type SuggestionResponse = "approved" | "denied" | "pending";
export type ViolenceLevel = "none" | "mild" | "moderate";
export type LanguageLevel = "none" | "mild" | "anything";
export type PoliticalLevel = "block_all" | "allow_educational" | "allow_all";
export type ChildMode = "young" | "older";

export interface ValueFilters {
  violence: ViolenceLevel;
  language: LanguageLevel;
  sexualContent: "none";
  religiousSensitivity: boolean;
  religion: string;
  political: PoliticalLevel;
  customRules: string;
  ageGroup: number;
}

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
  parentViewed: boolean;
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
