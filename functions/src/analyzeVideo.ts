// ─────────────────────────────────────────────────────────────
// Kideos — per-video pipeline (internal, NOT a Cloud Function)
//
// Called by onChannelWhitelisted / refreshChannelLibraries for every video in
// a whitelisted channel, once per child:
//   1. Get the video's content profile (videoProfiles/{videoId}) — shared by
//      every family. Only on a miss: YouTube details → cached transcript →
//      one AI call. Each video is profiled once, ever (per PROFILE_VERSION).
//   2. Apply this child's filters in code (+ cached religion/custom-rules check).
//   3. Write the child's verdict to users/{p}/children/{c}/videoVerdicts/{videoId}.
//      The kid feed reads approved == true from there.
//   4. If blocked for content: log to flaggedContent + push to parent.
//
// reapplyFiltersForChild re-runs steps 2–3 for all of a child's videos when
// their filters change — no transcripts, no profile AI calls.
// ─────────────────────────────────────────────────────────────

import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getVideoDetails } from "./youtube";
import { fetchTranscript, type TranscriptResult } from "./supadata";
import {
  PROFILE_VERSION,
  generateContentProfile,
  needsValuesCheck,
  hashValuesRules,
  checkValuesRules,
} from "./aiAnalysis";
import { evaluateProfile, type FilterDecision } from "./contentFilter";
import type { ValueFilters, FlaggedContent, ContentProfile, VideoVerdict } from "./types";

type Db = FirebaseFirestore.Firestore;

export interface AnalyzeAndTagParams {
  videoId: string;
  channelId: string;
  parentId: string;
  childId: string;
  childName: string;
  parentFcmToken: string | null;
  filters: ValueFilters;
  youtubeApiKey: string;
  supadataApiKey: string;
  openAiApiKey: string;
}

export interface AnalyzeAndTagResult {
  approved: boolean;
}

// Blocks that aren't about content — not logged as flagged content / no push
const NON_CONTENT_FLAGS = new Set(["no_transcript", "unavailable", "analysis_pending", "values_check_failed"]);

// ── Core function ──────────────────────────────────────────────

export async function analyzeAndTagVideo(params: AnalyzeAndTagParams): Promise<AnalyzeAndTagResult> {
  const { videoId, channelId, parentId, childId, childName, parentFcmToken, filters } = params;
  const db = getFirestore();

  const profile = await getOrCreateProfile(db, videoId, params);
  const decision: FilterDecision = profile
    ? await decideForChild(db, videoId, profile, filters, params.openAiApiKey)
    : {
        approved: false,
        reason: "Couldn't analyze this video yet — it will be retried.",
        flags: ["analysis_pending"],
        severity: "low",
      };

  const stub = (await db.doc(`channelLibraryCache/${channelId}/videos/${videoId}`).get()).data() ?? {};
  await writeVerdict(db, parentId, childId, channelId, videoId, stub, decision);

  if (!decision.approved && !decision.flags.some((f) => NON_CONTENT_FLAGS.has(f))) {
    await handleFlagged(db, parentId, childId, childName, videoId, channelId, profile!, decision, parentFcmToken);
  }
  return { approved: decision.approved };
}

// ── Content profile (shared, cached) ───────────────────────────
// Returns null only on a transient failure (rate limit, AI error) — nothing is
// stored then, so a later run retries.

async function getOrCreateProfile(
  db: Db,
  videoId: string,
  keys: Pick<AnalyzeAndTagParams, "youtubeApiKey" | "supadataApiKey" | "openAiApiKey">
): Promise<ContentProfile | null> {
  const ref = db.doc(`videoProfiles/${videoId}`);
  const snap = await ref.get();
  if (snap.exists && snap.data()!.version === PROFILE_VERSION) {
    logger.info(`[videoProfiles] Hit: ${videoId}`);
    return snap.data() as ContentProfile;
  }

  // YouTube details first (free quota) — only fetch the transcript (Supadata,
  // paid) once we know the video exists and isn't auto-blocked.
  const video = await getVideoDetails(videoId, keys.youtubeApiKey);
  if (!video || video.isPrivateOrRestricted) {
    if (!video) logger.warn(`[analyzeAndTagVideo] Video ${videoId} not found`);
    // Not cached: a missing video may be a transient API error, and a private one may go public
    return placeholderProfile("unavailable", video?.title ?? "", video?.channelTitle ?? "");
  }

  const transcript = await getTranscriptCached(db, videoId, keys.supadataApiKey);
  if (!transcript.available || !transcript.transcript) {
    if (!transcript.definitive) return null; // transient — retry later
    const p = placeholderProfile("no_transcript", video.title, video.channelTitle);
    await ref.set(p);
    return p;
  }

  const generated = await generateContentProfile(video, transcript.transcript, keys.openAiApiKey);
  if (!generated) return null;
  const profile: ContentProfile = { ...generated, createdAt: Timestamp.now() };
  await ref.set(profile);
  return profile;
}

function placeholderProfile(
  status: "no_transcript" | "unavailable",
  title: string,
  channelName: string
): ContentProfile {
  return {
    version: PROFILE_VERSION,
    status,
    title,
    channelName,
    violence: "none",
    language: "none",
    sexual: "none",
    political: "none",
    religiousThemes: [],
    topics: [],
    summary: "",
    evidence: { violence: "", language: "", sexual: "", political: "" },
    createdAt: Timestamp.now(),
  };
}

// ── Apply one child's filters ──────────────────────────────────

async function decideForChild(
  db: Db,
  videoId: string,
  profile: ContentProfile,
  filters: ValueFilters,
  openAiApiKey: string
): Promise<FilterDecision> {
  const base = evaluateProfile(profile, filters);
  // Values check only matters if the video otherwise passes
  if (!base.approved || profile.status !== "ok" || !needsValuesCheck(filters)) return base;

  const ref = db.doc(`videoProfiles/${videoId}/valuesChecks/${hashValuesRules(filters)}`);
  const snap = await ref.get();
  let check = snap.exists ? (snap.data() as { violates: boolean; reason: string }) : null;
  if (!check) {
    check = await checkValuesRules(profile, filters, openAiApiKey);
    if (!check) {
      return {
        approved: false,
        reason: "Couldn't check this video against your religion/custom rules yet — it will be retried.",
        flags: ["values_check_failed"],
        severity: "low",
      };
    }
    await ref.set({ ...check, createdAt: Timestamp.now() });
  }
  return evaluateProfile(profile, filters, check.violates ? check.reason : null);
}

async function writeVerdict(
  db: Db,
  parentId: string,
  childId: string,
  channelId: string,
  videoId: string,
  stub: FirebaseFirestore.DocumentData,
  decision: FilterDecision,
  batch?: FirebaseFirestore.WriteBatch
): Promise<void> {
  const verdict: VideoVerdict = {
    videoId,
    channelId,
    approved: decision.approved,
    reason: decision.reason,
    flags: decision.flags,
    severity: decision.severity,
    title: stub.title ?? "",
    thumbnail: stub.thumbnail ?? "",
    publishedAt: stub.publishedAt ?? Timestamp.now(),
    durationSeconds: stub.durationSeconds ?? null,
    evaluatedAt: Timestamp.now(),
  };
  const ref = db.doc(`users/${parentId}/children/${childId}/videoVerdicts/${videoId}`);
  if (batch) batch.set(ref, verdict);
  else await ref.set(verdict);
}

// ── Re-apply filters after a change ────────────────────────────
// Profiles are reused: no Supadata, no profile AI calls. Only religion /
// custom-rules checks for rule sets not seen before call the AI (on summaries).

export async function reapplyFiltersForChild(
  parentId: string,
  childId: string,
  openAiApiKey: string
): Promise<{ approved: number; blocked: number }> {
  const db = getFirestore();
  const filters = await loadValueFiltersForChild(parentId, childId);
  const channels = await db
    .collection(`users/${parentId}/children/${childId}/whitelistedChannels`)
    .where("seedingStatus", "==", "ready")
    .get();

  let approved = 0;
  let blocked = 0;
  for (const channelDoc of channels.docs) {
    const channelId = channelDoc.id;
    const videos = await db.collection(`channelLibraryCache/${channelId}/videos`).get();
    let channelApproved = 0;

    for (let i = 0; i < videos.docs.length; i += 100) {
      const chunk = videos.docs.slice(i, i + 100);
      const profileSnaps = await db.getAll(...chunk.map((v) => db.doc(`videoProfiles/${v.id}`)));
      const batch = db.batch();
      // Values checks may call the AI — run in small parallel groups
      for (let j = 0; j < chunk.length; j += 5) {
        await Promise.all(
          chunk.slice(j, j + 5).map(async (videoDoc, k) => {
            const snap = profileSnaps[j + k];
            if (!snap.exists || snap.data()!.version !== PROFILE_VERSION) return; // not analyzed yet — leave as is
            const decision = await decideForChild(db, videoDoc.id, snap.data() as ContentProfile, filters, openAiApiKey);
            await writeVerdict(db, parentId, childId, channelId, videoDoc.id, videoDoc.data(), decision, batch);
            if (decision.approved) channelApproved++;
            else blocked++;
          })
        );
      }
      await batch.commit();
    }
    approved += channelApproved;
    await channelDoc.ref.set({ videoCount: channelApproved }, { merge: true });
  }
  logger.info(`[reapplyFilters] ${parentId}/${childId}: approved=${approved} blocked=${blocked}`);
  return { approved, blocked };
}

// ── Transcript cache ───────────────────────────────────────────
// Transcripts don't change and don't depend on filters, so each video's
// transcript is fetched from Supadata (paid, per request) at most once.
// Stores transcripts AND confirmed "no transcript" results (Supadata still bills
// those). Only transient failures (rate limit, network) are left uncached.

async function getTranscriptCached(db: Db, videoId: string, supadataApiKey: string): Promise<TranscriptResult> {
  const ref = db.doc(`transcriptCache/${videoId}`);
  const snap = await ref.get();
  if (snap.exists) {
    logger.info(`[transcriptCache] Hit: ${videoId}`);
    const d = snap.data()!;
    if (d.available === false) {
      return { available: false, transcript: null, language: null, wordCount: 0, definitive: true };
    }
    return { available: true, transcript: d.transcript, language: d.language, wordCount: d.wordCount };
  }

  const result = await fetchTranscript(videoId, supadataApiKey);
  if (result.definitive) {
    await ref.set({ available: false, fetchedAt: Timestamp.now() });
  } else if (result.available && result.transcript) {
    await ref.set({
      // Firestore docs cap at 1 MiB; the AI only reads the first 12k chars anyway
      transcript: result.transcript.slice(0, 200000),
      language: result.language,
      wordCount: result.wordCount,
      fetchedAt: Timestamp.now(),
    });
  }
  return result;
}

// ── Log flagged content + push FCM to parent ───────────────────

async function handleFlagged(
  db: Db,
  parentId: string,
  childId: string,
  childName: string,
  videoId: string,
  channelId: string,
  profile: ContentProfile,
  decision: FilterDecision,
  fcmToken: string | null
): Promise<void> {
  const flaggedDoc: FlaggedContent = {
    videoId,
    title: profile.title,
    channel: profile.channelName,
    channelId,
    timestamp: Timestamp.now(),
    reason: decision.reason,
    flags: decision.flags,
    severity: decision.severity ?? "low",
    parentViewed: false,
  };

  await db.collection(`users/${parentId}/children/${childId}/flaggedContent`).add(flaggedDoc);

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
        videoTitle: profile.title.slice(0, 100),
        reason: decision.reason.slice(0, 200),
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

// ── Load value filters for a child ─────────────────────────────

export async function loadValueFiltersForChild(parentId: string, childId: string): Promise<ValueFilters> {
  const snap = await getFirestore().doc(`users/${parentId}/children/${childId}/valueFilters/current`).get();
  return snap.exists
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
}
