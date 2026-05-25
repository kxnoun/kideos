// ─────────────────────────────────────────────────────────────
// Kideos — analyzeAndTagVideo (internal function, NOT a Cloud Function)
//
// Called by seedChannelLibrary and refreshChannelLibraries for
// every video in a whitelisted channel's library.
//
// Pipeline (cache-first):
//   1. Check videoAnalysisCache — if hit, use it immediately (0 cost)
//   2. Cache miss: fire Supadata + videos.list IN PARALLEL
//   3. Send to GPT-4o-mini with parent's value filters
//   4. Store result in shared cache (30-day TTL)
//   5. Write approved/analyzedAt to channelLibraryCache/{channelId}/videos/{videoId}
//   6. If flagged: log to flaggedContent + push FCM notification to parent
//
// The kid's feed is a Firestore query: approved == true.
// A child cannot encounter a video they are not allowed to watch.
// ─────────────────────────────────────────────────────────────

import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { APP_CONFIG } from "./config";
import { getVideoDetails } from "./youtube";
import { fetchTranscript } from "./supadata";
import { analyzeVideoContent, hashValueFilters } from "./aiAnalysis";
import type {
  ValueFilters,
  VideoAnalysisResult,
  FlaggedContent,
  CachedVideo,
} from "./types";

// ── Params passed in from batch callers ────────────────────────
// Loaded once per batch (not per video) for efficiency.

export interface AnalyzeAndTagParams {
  videoId: string;
  channelId: string;
  parentId: string;
  childId: string;
  childName: string;
  parentFcmToken: string | null;
  filters: ValueFilters;
  filterHash: string;
  youtubeApiKey: string;
  supadataApiKey: string;
  openAiApiKey: string;
}

export interface AnalyzeAndTagResult {
  approved: boolean;
  confidence: number;
  fromCache: boolean;
}

// ── Core function ──────────────────────────────────────────────

export async function analyzeAndTagVideo(
  params: AnalyzeAndTagParams
): Promise<AnalyzeAndTagResult> {
  const {
    videoId,
    channelId,
    parentId,
    childId,
    childName,
    parentFcmToken,
    filters,
    filterHash,
    youtubeApiKey,
    supadataApiKey,
    openAiApiKey,
  } = params;

  const db = getFirestore();

  // ── 1. Check shared AI cache ───────────────────────────────
  const cacheRef = db.doc(`videoAnalysisCache/${videoId}/results/${filterHash}`);
  const cacheSnap = await cacheRef.get();

  if (cacheSnap.exists) {
    const cached = cacheSnap.data() as VideoAnalysisResult;
    if (cached.expiresAt.toDate() > new Date()) {
      logger.info(`[analyzeAndTagVideo] Cache hit: ${videoId} approved=${cached.approved}`);

      // Write the approved status to the video doc (feed query reads this)
      await tagVideoInLibrary(db, channelId, videoId, cached.approved);

      // If previously flagged during another parent's analysis, also log here
      if (!cached.approved) {
        await handleFlagged(db, parentId, childId, childName, videoId, channelId, cached, parentFcmToken);
      }

      return { approved: cached.approved, confidence: cached.confidence, fromCache: true };
    }
  }

  // ── 2. Cache miss — fetch metadata + transcript in parallel ─
  logger.info(`[analyzeAndTagVideo] Cache miss: ${videoId} — running pipeline`);

  const [videoDetails, transcriptResult] = await Promise.all([
    getVideoDetails(videoId, youtubeApiKey),
    fetchTranscript(videoId, supadataApiKey),
  ]);

  if (!videoDetails) {
    // Video unavailable — mark as not approved, don't crash the batch
    logger.warn(`[analyzeAndTagVideo] Video ${videoId} not found — skipping`);
    await tagVideoInLibrary(db, channelId, videoId, false);
    return { approved: false, confidence: 0, fromCache: false };
  }

  // Auto-block private / age-restricted
  if (videoDetails.isPrivateOrRestricted) {
    logger.info(`[analyzeAndTagVideo] Auto-blocking private/restricted: ${videoId}`);
    await tagVideoInLibrary(db, channelId, videoId, false);
    return { approved: false, confidence: 100, fromCache: false };
  }

  // ── 3. Run AI analysis ──────────────────────────────────────
  const aiResult = await analyzeVideoContent(
    videoDetails,
    transcriptResult,
    filters,
    openAiApiKey
  );

  // ── 4. Store in shared cache ────────────────────────────────
  const now = Timestamp.now();
  const analysisDoc: VideoAnalysisResult = {
    approved: aiResult.approved,
    confidence: aiResult.confidence,
    flags: aiResult.flags,
    reason: aiResult.reason,
    severity: aiResult.severity,
    analyzedAt: now,
    expiresAt: Timestamp.fromDate(
      new Date(Date.now() + APP_CONFIG.VIDEO_ANALYSIS_CACHE_DAYS * 86400 * 1000)
    ),
    hadTranscript: aiResult.hadTranscript,
    metadataOnly: aiResult.metadataOnly,
    videoTitle: videoDetails.title,
    channelName: videoDetails.channelTitle,
    madeForKids: videoDetails.madeForKids,
  };

  await cacheRef.set(analysisDoc);

  // ── 5. Write approved status to video doc in channel library ─
  await tagVideoInLibrary(db, channelId, videoId, aiResult.approved);

  // ── 6. If flagged: log + notify parent ──────────────────────
  if (!aiResult.approved) {
    await handleFlagged(
      db, parentId, childId, childName, videoId, channelId, analysisDoc, parentFcmToken
    );
  }

  return { approved: aiResult.approved, confidence: aiResult.confidence, fromCache: false };
}

// ── Write approved status to channelLibraryCache video doc ────

async function tagVideoInLibrary(
  db: FirebaseFirestore.Firestore,
  channelId: string,
  videoId: string,
  approved: boolean
): Promise<void> {
  const videoRef = db.doc(`channelLibraryCache/${channelId}/videos/${videoId}`);
  const update: Partial<CachedVideo> = {
    approved,
    analyzedAt: Timestamp.now(),
  };
  // merge: true preserves title, thumbnail, publishedAt etc.
  await videoRef.set(update, { merge: true });
}

// ── Log flagged content + push FCM to parent ───────────────────

async function handleFlagged(
  db: FirebaseFirestore.Firestore,
  parentId: string,
  childId: string,
  childName: string,
  videoId: string,
  channelId: string,
  analysis: VideoAnalysisResult,
  fcmToken: string | null
): Promise<void> {
  // Log to flaggedContent for parent to review in app
  const flaggedDoc: FlaggedContent = {
    videoId,
    title: analysis.videoTitle,
    channel: analysis.channelName,
    channelId,
    timestamp: Timestamp.now(),
    reason: analysis.reason,
    flags: analysis.flags,
    severity: analysis.severity ?? "low",
    parentViewed: false,
  };

  await db
    .collection(`users/${parentId}/children/${childId}/flaggedContent`)
    .add(flaggedDoc);

  // Push notification to parent
  if (!fcmToken) return;

  try {
    await getMessaging().send({
      token: fcmToken,
      notification: {
        title: "⚠️ Heads up",
        body: `A video was blocked from ${childName}'s feed. Tap to see why.`,
      },
      data: {
        type: "video_flagged",
        videoId,
        videoTitle: analysis.videoTitle.slice(0, 100),
        reason: analysis.reason.slice(0, 200),
        childId,
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    });
  } catch (err) {
    logger.error(`[analyzeAndTagVideo] FCM notification failed for parent ${parentId}:`, err);
  }
}

// ── Exported helper: load value filters for a child ───────────
// Used by both seedChannelLibrary and refreshChannelLibraries.

export async function loadValueFiltersForChild(
  parentId: string,
  childId: string
): Promise<{ filters: ValueFilters; filterHash: string }> {
  const db = getFirestore();
  const snap = await db
    .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
    .get();

  const filters: ValueFilters = snap.exists
    ? (snap.data() as ValueFilters)
    : {
        violence: "none",
        language: "none",
        sexualContent: "none",
        religiousSensitivity: false,
        religion: "",
        political: "block_all",
        customRules: "",
        ageGroup: 7,
      };

  return { filters, filterHash: hashValueFilters(filters) };
}

// ── Re-export hashValueFilters for external use ────────────────
export { hashValueFilters } from "./aiAnalysis";
