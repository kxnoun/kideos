// Kideos for Parents — TypeScript types

import { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
type Timestamp = FirebaseFirestoreTypes.Timestamp;

export type SubscriptionTier = "free" | "premium";
export type SeedingStatus = "pending" | "ready" | "error";
export type SuggestionResponse = "approved" | "denied" | "pending";
export type ChildMode = "young" | "older";

// Questionnaire answers — defined with their logic in ../prefs.ts
export type { ValueFilters, Dim, DimRule } from "../prefs";
import type { Dim } from "../prefs";

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

// users/{p}/children/{c}/videoVerdicts/{videoId} — written by the backend
export interface VideoVerdict {
  videoId: string;
  channelId: string;
  channelName?: string;
  approved: boolean; // in the kid's feed
  status: "approved" | "hidden"; // what the child's answers decided
  parentDecision?: "approved" | "hidden"; // "Show anyway"
  reason: string; // why it's hidden, in plain words
  flags: string[];
  severity: "low" | "medium" | "high" | null;
  ratings?: Partial<Record<Dim, { level: number | null; evidence: string }>>;
  title: string;
  thumbnail: string;
  publishedAt: Timestamp;
  durationSeconds: number | null;
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
  // Pushed from Home
  Videos: { childId: string; childName: string };
  Suggestions: { childId: string; childName: string };
};

// Suggested channel for one child (getChannelSuggestions) — scored against
// that child's answers from the shared channel catalog
export interface SuggestedChannel {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  overview: string;
  topics: string[];
  analyzed: number; // checked videos
  unchecked: number; // no transcript, not counted
  fitting: number;
  severe: number; // 1–2 allowed (shown as a warning); 3+ are never suggested
  severeLabels: { label: string; count: number }[];
  educational: number;
  hiddenReasons: { label: string; count: number }[];
  ratings: { dim: Dim; maxLevel: number; count: number }[];
  samples: { videoId: string; title: string; thumbnail: string }[];
}

export type MainTabParamList = {
  Home: undefined;
  Channels: undefined;
  Digest: undefined;
  Settings: undefined;
};
