// ─────────────────────────────────────────────────────────────
// Kideos — Cloud Functions entry point
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "firebase-admin/app";

initializeApp();

// ── Channel Management ─────────────────────────────────────────
// resolveAndAddChannel: parent adds channel by URL/handle
//   → channels.list lookup (1 unit) → whitelist → seed + batch analyze
// seedChannelLibrary: explicit seed trigger (also called internally)
// refreshChannelLibraries: nightly — detects new uploads, analyzes only new videos
export {
  resolveAndAddChannel,
  onChannelWhitelisted,
  onFiltersChanged,
  seedChannelLibrary,
  refreshChannelLibraries,
} from "./seedChannelLibrary";

// ── AI Channel Suggestions ─────────────────────────────────────
// suggestChannels: parent types natural language query
//   → GPT-4o-mini handles → channels.list verify (no search.list)
// weeklyChannelSuggestions: every Monday, generates for all Premium families
export { suggestChannels, weeklyChannelSuggestions } from "./suggestChannels";

export { parseCustomRules } from "./customRules";

// ── Scheduled Jobs + Triggers ──────────────────────────────────
// cleanupExpiredData: nightly — COPPA 90-day watch history + 30-day AI cache
// generateWeeklyDigest: Monday 8am — GPT-4o-mini weekly summary + FCM push
// handleParentCommand: Firestore trigger — remote pause/stop → kid app
// deleteChildData: COPPA hard delete — wipes all records for a child
export {
  cleanupExpiredData,
  generateWeeklyDigest,
  handleParentCommand,
  deleteChildData,
} from "./scheduledJobs";

// Note: analyzeAndTagVideo is an INTERNAL function — not a deployed Cloud Function.
// It is called by seedChannelLibrary and refreshChannelLibraries during batch analysis.
// The kid app never calls it directly — the kid app only reads Firestore.
