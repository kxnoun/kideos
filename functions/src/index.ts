// ─────────────────────────────────────────────────────────────
// Kideos — Cloud Functions entry point
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "firebase-admin/app";

initializeApp();

// Full overview: docs/architecture.md
//
// ── Channels & analysis ────────────────────────────────────────
// resolveAndAddChannel: parent adds channel by URL/handle → channels.list (1 unit) → whitelist doc
// onChannelWhitelisted: trigger on that doc → seed 40 long videos + 10 Shorts → profile + verdict per video
// onFiltersChanged: trigger on questionnaire save → re-apply answers to all the child's videos
// loadMoreVideos + onMoreVideosRequested: "Load more videos" → the next 50 older long videos for one child
// seedChannelLibrary: legacy callable, unused by the app
// refreshChannelLibraries: nightly — new uploads (+ one-time long-video top-up for older channels)
export {
  resolveAndAddChannel,
  onChannelWhitelisted,
  onFiltersChanged,
  loadMoreVideos,
  onMoreVideosRequested,
  seedChannelLibrary,
  refreshChannelLibraries,
} from "./seedChannelLibrary";

// ── AI Channel Suggestions ─────────────────────────────────────
// suggestChannels: parent types natural language query
//   → GPT-4o-mini handles → channels.list verify (no search.list)
// weeklyChannelSuggestions: every Monday, generates for all Premium families
export { suggestChannels, weeklyChannelSuggestions } from "./suggestChannels";

export { getChannelSuggestions } from "./channelCatalog";

// checkChannel: before a parent adds a channel — thumbnails + reputation search (Gemini),
// one shared report per channel, conflicts with the child's settings worked out in code
export { checkChannel, getChannelFits } from "./channelCheck";

export { reprofileOutdated } from "./reprofile";

// onPaceReport: parent taps "Too hyper" → count reports on the video's profile
export { onPaceReport } from "./paceReports";

// parseCustomRules: questionnaire free text → concrete settings (parent confirms)
export { parseCustomRules } from "./customRules";

// ── Scheduled Jobs + Triggers ──────────────────────────────────
// cleanupExpiredData: nightly — COPPA 90-day watch history (+ legacy analysis cache)
// generateWeeklyDigest: Monday 8am — GPT-4o-mini weekly summary + FCM push
// handleParentCommand: Firestore trigger — remote pause/stop → kid app
// deleteChildData: COPPA hard delete — wipes all records for a child
export {
  cleanupExpiredData,
  generateWeeklyDigest,
  handleParentCommand,
  deleteChildData,
} from "./scheduledJobs";

// Note: analyzeAndTagVideo (analyzeVideo.ts) is INTERNAL — not a deployed Cloud Function.
// It runs inside onChannelWhitelisted / refreshChannelLibraries. The kid app only reads Firestore.
