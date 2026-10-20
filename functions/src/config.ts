// ─────────────────────────────────────────────────────────────
// Kideos — Runtime configuration
// All secrets come from Firebase Secret Manager (never hardcoded)
// Set via: firebase functions:secrets:set SECRET_NAME
// ─────────────────────────────────────────────────────────────

import { defineSecret } from "firebase-functions/params";

// Secrets — provisioned via Firebase Secret Manager
// Run once to set:
//   firebase functions:secrets:set YOUTUBE_API_KEY
//   firebase functions:secrets:set SUPADATA_API_KEY
//   firebase functions:secrets:set OPENAI_API_KEY
export const YOUTUBE_API_KEY = defineSecret("YOUTUBE_API_KEY");
export const SUPADATA_API_KEY = defineSecret("SUPADATA_API_KEY");
export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
// Gemini — channel check at add time (channelCheck.ts)
//   firebase functions:secrets:set GEMINI_API_KEY   (key from aistudio.google.com)
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// App constants
export const APP_CONFIG = {
  // AI model — gpt-4o-mini for cost-efficiency (~$30/mo at 1k premium users)
  AI_MODEL: "gpt-4o-mini" as const,

  // Cache TTLs
  WATCH_HISTORY_RETENTION_DAYS: 90, // COPPA compliance

  // Pipeline targets (milliseconds)
  CACHE_HIT_TARGET_MS: 200,
  PIPELINE_TIMEOUT_MS: 4000,

  // Free tier limits
  FREE_TIER_MAX_CHANNELS: 10,

  // YouTube quota
  YOUTUBE_BASE_URL: "https://www.googleapis.com/youtube/v3",

  // Supadata API
  SUPADATA_BASE_URL: "https://api.supadata.ai/v1",

  // Channel seeding: max videos to pull per channel via playlistItems.list
  CHANNEL_SEED_MAX_VIDEOS: 50, // fallback (mixed uploads list) and nightly new-upload check
  CHANNEL_SEED_LONG: 40, // a new channel: its 40 latest long videos…
  CHANNEL_SEED_SHORTS: 10, // …and 10 latest Shorts
  // "Load more videos": the next 20 older long videos per tap; only offered while the child has
  // fewer than LOAD_MORE_BELOW videos shown from the channel; once per channel per day per child;
  // LOAD_MORE_PER_DAY taps per family per day. Videos another family already loaded cost nothing.
  LOAD_MORE_VIDEOS: 20,
  LOAD_MORE_BELOW: 20,
  LOAD_MORE_PER_DAY: 10,
  CHANNEL_SEED_MAX_PAGES: 5, // 5 pages × 1 unit = max 5 units per seed

  // Pre-analysis: number of feed videos to pre-analyze in background
  PRE_ANALYSIS_BATCH_SIZE: 5,

  // Functions region — all functions co-located for latency
  FUNCTIONS_REGION: "us-central1" as const,
} as const;
