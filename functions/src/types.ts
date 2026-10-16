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
export type SexualLevel = "none" | "innuendo";

export interface ValueFilters {
  violence: ViolenceLevel;
  language: LanguageLevel;
  sexualContent: SexualLevel; // "innuendo" allows passing jokes; default by age
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

// ── Content Profile ────────────────────────────────────────────
// Path: videoProfiles/{videoId}
// What a video contains, on fixed scales. Filter-independent: generated once
// per video by AI and shared by every family. Server-only (rules deny clients).
// status "no_transcript" / "unavailable" are stored only when permanent.

export interface ContentProfile {
  version: number;
  status: "ok" | "no_transcript" | "unavailable";
  title: string;
  channelName: string;
  violence: "none" | "cartoon" | "mild" | "moderate" | "graphic";
  language: "none" | "mild" | "strong";
  sexual: "none" | "innuendo" | "suggestive" | "explicit";
  political: "none" | "educational" | "opinion";
  religiousThemes: string[];
  topics: string[];
  summary: string;
  evidence: { violence: string; language: string; sexual: string; political: string };
  createdAt: Timestamp;
}

// Path: videoProfiles/{videoId}/valuesChecks/{rulesHash}
// Cached religion / custom-rules check (AI on the summary, not the transcript).

// ── Per-child verdict ──────────────────────────────────────────
// Path: users/{parentId}/children/{childId}/videoVerdicts/{videoId}
// Computed from the profile + that child's filters. Kid feed reads approved == true.

export interface VideoVerdict {
  videoId: string;
  channelId: string;
  approved: boolean;
  reason: string; // empty when approved
  flags: string[];
  severity: Severity | null;
  title: string;
  thumbnail: string;
  publishedAt: Timestamp;
  durationSeconds: number | null;
  evaluatedAt: Timestamp;
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
// Shared metadata only. (`approved` is legacy and no longer written —
// approvals are per child, in videoVerdicts.)

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
