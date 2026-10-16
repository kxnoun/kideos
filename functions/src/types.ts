// ─────────────────────────────────────────────────────────────
// Kideos — Shared TypeScript types
// Mirrors the Firestore data model — see docs/architecture.md → Firestore data model
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

// Defined with the questionnaire logic in prefs.ts
export type { ValueFilters, Dim, DimRule, OverAction } from "./prefs";
import type { Dim, Holiday, ValueFlag } from "./prefs";

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
  status: "hidden" | "pending_review"; // pending_review = hidden until the parent approves
  parentViewed: boolean;
  resolution?: "approved" | "hidden"; // set by the parent app when reviewed
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

export interface DimRating {
  level: number | null; // 0–4 ladder (prefs.ts LEVEL_LABELS); null = can't tell from the transcript
  evidence: string;
}

export type Framing = "neutral" | "condemned" | "glorified";

export interface ContentProfile {
  version: number;
  status: "ok" | "no_transcript" | "unavailable";
  title: string;
  channelName: string;
  purpose: "entertainment" | "educational" | "news" | "devotional" | "commercial";
  dims: Record<Dim, DimRating>;
  violenceRealism: "none" | "cartoon_fantasy" | "realistic_fiction" | "real_footage";
  framing: { violence: Framing; substances: Framing; selfHarm: Framing; meanness: Framing };
  religionTraditions: string[]; // islam | judaism | christianity | hinduism | sikhism | buddhism | other
  religiousThemes: string[];
  holidays: { name: Holiday; prominence: "theme" | "incidental" }[];
  music: { level: "none" | "background" | "prominent" | "music_video" }; // from captions/lyrics only — best effort
  lgbtq: "none" | "incidental" | "discussion" | "advocacy";
  flags: Record<ValueFlag, boolean>;
  topics: string[];
  summary: string;
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
  approved: boolean; // what the kid feed reads: status === "approved", or the parent approved it
  status: "approved" | "hidden" | "pending_review";
  parentDecision?: "approved" | "hidden"; // set by the parent app; always wins
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
