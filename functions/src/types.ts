// ─────────────────────────────────────────────────────────────
// Kideos — Shared TypeScript types
// Mirrors the Firestore data model from product_spec_v1.md
// ─────────────────────────────────────────────────────────────

import { Timestamp } from "firebase-admin/firestore";

// ── Subscription ──────────────────────────────────────────────

export type SubscriptionTier = "free" | "premium";

export interface Subscription {
  tier: SubscriptionTier;
  expiresAt: Timestamp | null;
}

// ── Parent Profile ─────────────────────────────────────────────

export interface ParentProfile {
  name: string;
  email: string;
  createdAt: Timestamp;
}

// ── Value Filters ──────────────────────────────────────────────

export type ViolenceLevel = "none" | "mild" | "moderate";
export type LanguageLevel = "none" | "mild" | "anything";
export type PoliticalLevel = "block_all" | "allow_educational" | "allow_all";

export interface ValueFilters {
  violence: ViolenceLevel;
  language: LanguageLevel;
  sexualContent: "none"; // always none — not user-configurable
  religiousSensitivity: boolean;
  religion: string; // e.g. "Islamic values — avoid music, mixed gender content"
  political: PoliticalLevel;
  customRules: string; // free text injected into AI prompt
  ageGroup: number; // child's age in years
}

// ── Child Profile ──────────────────────────────────────────────

// mode is stored now so V2 can use it without migration
export type ChildMode = "young" | "older";

export interface ChildProfile {
  name: string;
  age: number;
  avatar: string;
  mode: ChildMode;
}

// ── Whitelisted Channel ────────────────────────────────────────

export type SeedingStatus = "pending" | "ready" | "error";

export interface WhitelistedChannel {
  channelId: string;
  name: string;
  thumbnail: string;
  addedAt: Timestamp;
  addedBy: "parent" | "ai_suggestion";
  seedingStatus: SeedingStatus;
  videoCount: number; // updated when seeding completes
}

// ── Watch History Session ──────────────────────────────────────

export interface WatchSession {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  durationSeconds: number | null;
  // COPPA: auto-deleted 90 days from startedAt
  expiresAt: Timestamp;
}

// ── Flagged Content ────────────────────────────────────────────
// Written during background batch analysis when a video is blocked.
// These videos never appear in the kid's feed.

export type Severity = "low" | "medium" | "high";

export interface FlaggedContent {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  timestamp: Timestamp;
  reason: string;
  flags: string[];
  severity: Severity;
  parentViewed: boolean;
}

// ── AI Channel Suggestion ──────────────────────────────────────

export type SuggestionResponse = "approved" | "denied" | "pending";

export interface ChannelSuggestion {
  channelId: string;
  channelName: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  description: string;
  reason: string;
  sampleVideoTitles: string[];
  generatedAt: Timestamp;
  parentResponse: SuggestionResponse;
}

// ── Video Analysis Cache ───────────────────────────────────────
// Path: videoAnalysisCache/{videoId}/results/{filterHash}
// Shared across all users — any parent benefits from prior analysis.

export interface VideoAnalysisResult {
  approved: boolean;
  confidence: number; // 0–100
  flags: string[];
  reason: string; // plain English for parent notification / digest
  severity: Severity | null;
  analyzedAt: Timestamp;
  expiresAt: Timestamp; // 30-day TTL
  // Pipeline metadata
  hadTranscript: boolean;
  metadataOnly: boolean;
  videoTitle: string;
  channelName: string;
  madeForKids: boolean | null;
}

// ── Channel Library Cache ──────────────────────────────────────
// Path: channelLibraryCache/{channelId}
// Global video metadata store — shared across all users.

export interface ChannelMetadata {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  description: string;
  lastRefreshed: Timestamp;
}

// Path: channelLibraryCache/{channelId}/videos/{videoId}
// `approved` and `analyzedAt` written by batch analysis for each parent.
// Kid's feed query: approved: true, filtered to channels in whitelist.

export interface CachedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: Timestamp;
  durationSeconds: number | null;
  lastSeenAt: Timestamp;
  // Set by analyzeAndTagVideo during seeding / refresh
  approved: boolean | null; // null = not yet analyzed
  analyzedAt: Timestamp | null;
}

// ── Cloud Function payloads ────────────────────────────────────

// resolveAndAddChannel — called by parent app
export interface ResolveChannelRequest {
  input: string; // URL, @handle, or raw channel ID
  parentId: string;
  childId: string;
}

export interface ResolveChannelResponse {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  description: string;
  alreadyWhitelisted: boolean;
}

// seedChannelLibrary — called internally after channel is whitelisted
export interface SeedChannelRequest {
  channelId: string;
  parentId: string;
  childId: string;
}

// suggestChannels — called by parent app
export interface SuggestChannelsRequest {
  parentId: string;
  childId: string;
  naturalLanguageQuery?: string;
}

// deleteChildData — called by parent app
export interface DeleteChildDataRequest {
  parentId: string;
  childId: string;
}
