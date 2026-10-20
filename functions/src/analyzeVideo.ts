// ─────────────────────────────────────────────────────────────
// Kideos — per-video pipeline (internal, NOT a Cloud Function)
//
// Called by onChannelWhitelisted / refreshChannelLibraries for every video in
// a whitelisted channel, once per child:
//   1. Get the video's content profile (videoProfiles/{videoId}) — shared by
//      every family. Only on a miss: YouTube details → cached transcript →
//      one AI call. Each video is profiled once, ever (per PROFILE_VERSION).
//   2. Apply this child's filters in code (+ cached religion/custom-rules check).
//   3. Write the child's verdict to users/{p}/children/{c}/videoVerdicts/{videoId}
//      (approved / hidden + reason + the video's ratings). The kid feed reads
//      approved == true; the parent app's Videos screen shows Shown / Hidden.
//      A parentDecision ("Show anyway") always wins and is never overwritten.
//
// reapplyFiltersForChild re-runs steps 2–3 for all of a child's videos when
// their filters change — no transcripts, no profile AI calls.
// ─────────────────────────────────────────────────────────────

import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getVideoDetails } from "./youtube";
import { fetchTranscript, type TranscriptResult } from "./supadata";
import {
  PROFILE_VERSION,
  MIN_USABLE_PROFILE_VERSION,
  generateContentProfile,
  needsValuesCheck,
  hashValuesRules,
  checkValuesRules,
} from "./aiAnalysis";
import { evaluateProfile, effectiveDims, type FilterDecision } from "./contentFilter";
import { DIMS, VALUE_FLAGS, normalizePrefs } from "./prefs";
import type { ValueFilters, ContentProfile, VideoVerdict } from "./types";

type Db = FirebaseFirestore.Firestore;

export interface AnalyzeAndTagParams {
  videoId: string;
  channelId: string;
  parentId: string;
  childId: string;
  filters: ValueFilters;
  youtubeApiKey: string;
  supadataApiKey: string;
  openAiApiKey: string;
}

export interface AnalyzeAndTagResult {
  approved: boolean;
}


// ── Core function ──────────────────────────────────────────────

export async function analyzeAndTagVideo(params: AnalyzeAndTagParams): Promise<AnalyzeAndTagResult> {
  const { videoId, channelId, parentId, childId, filters } = params;
  const db = getFirestore();

  const profile = await getOrCreateProfile(db, videoId, params);
  const decision: FilterDecision = profile
    ? await decideForChild(db, videoId, profile, filters, params.openAiApiKey)
    : {
        status: "hidden",
        reason: "Couldn't analyze this video yet — it will be retried.",
        flags: ["analysis_pending"],
        severity: "low",
      };

  const stub = (await db.doc(`channelLibraryCache/${channelId}/videos/${videoId}`).get()).data() ?? {};
  const verdictRef = db.doc(`users/${parentId}/children/${childId}/videoVerdicts/${videoId}`);
  const parentDecision = (await verdictRef.get()).data()?.parentDecision;
  const batch = db.batch();
  const approved = writeVerdict(db, parentId, childId, channelId, videoId, stub, profile, decision, parentDecision, batch);
  await batch.commit();
  return { approved };
}

// ── Content profile (shared, cached) ───────────────────────────
// Returns null only on a transient failure (rate limit, AI error) — nothing is
// stored then, so a later run retries.

// cachedTranscriptsOnly: never call Supadata — a video without a cached transcript is
// left as it is (used by reprofileOutdated)
export async function getOrCreateProfile(
  db: Db,
  videoId: string,
  keys: Pick<AnalyzeAndTagParams, "youtubeApiKey" | "supadataApiKey" | "openAiApiKey">,
  opts: { cachedTranscriptsOnly?: boolean } = {}
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
    return placeholderProfile("unavailable", video?.title ?? "", video?.channelTitle ?? "", video?.madeForKids);
  }

  if (opts.cachedTranscriptsOnly && !(await db.doc(`transcriptCache/${videoId}`).get()).exists) return null;
  const transcript = await getTranscriptCached(db, videoId, keys.supadataApiKey);
  if ((!transcript.available || !transcript.transcript) && !transcript.definitive) return null; // transient — retry later

  // No captions (definitive): rated from title, description, tags and images instead
  const generated = await generateContentProfile(video, transcript.transcript ?? "", keys.openAiApiKey);
  if (!generated) return null;
  const profile: ContentProfile = { ...generated, createdAt: Timestamp.now() };
  // Parents' "Too hyper" reports survive re-profiling (counted by onPaceReport)
  const reports = snap.exists ? snap.data()!.tooHyperReports : undefined;
  if (reports) profile.tooHyperReports = reports;
  await ref.set(profile);
  return profile;
}

function placeholderProfile(
  status: "no_transcript" | "unavailable",
  title: string,
  channelName: string,
  madeForKids?: boolean
): ContentProfile {
  const dims = {} as ContentProfile["dims"];
  for (const dim of DIMS) dims[dim] = { level: 0, evidence: "" };
  return {
    version: PROFILE_VERSION,
    status,
    title,
    channelName,
    purpose: "entertainment",
    dims,
    violenceRealism: "none",
    framing: { violence: "neutral", substances: "neutral", selfHarm: "neutral", meanness: "neutral" },
    religionTraditions: [],
    religiousThemes: [],
    holidays: [],
    music: { level: "none" },
    lgbtq: "none",
    flags: Object.fromEntries(VALUE_FLAGS.map((f) => [f, false])) as ContentProfile["flags"],
    topics: [],
    summary: "",
    ...(madeForKids === undefined ? {} : { madeForKids }),
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
  // Values check only matters if the video isn't already hidden
  if (base.status === "hidden" || profile.status !== "ok" || !needsValuesCheck(filters)) return base;

  const ref = db.doc(`videoProfiles/${videoId}/valuesChecks/${hashValuesRules(filters)}`);
  const snap = await ref.get();
  let check = snap.exists ? (snap.data() as { violates: boolean; reason: string }) : null;
  if (!check) {
    check = await checkValuesRules(profile, filters, openAiApiKey);
    if (!check) {
      return {
        status: "hidden",
        reason: "Couldn't check this video against your religion/custom rules yet — it will be retried.",
        flags: ["values_check_failed"],
        severity: "low",
      };
    }
    await ref.set({ ...check, createdAt: Timestamp.now() });
  }
  return evaluateProfile(profile, filters, check.violates ? check.reason : null);
}

// Returns whether the video is in the kid feed. Never overwrites parentDecision.
function writeVerdict(
  db: Db,
  parentId: string,
  childId: string,
  channelId: string,
  videoId: string,
  stub: FirebaseFirestore.DocumentData,
  profile: ContentProfile | null,
  decision: FilterDecision,
  parentDecision: "approved" | "hidden" | undefined,
  batch: FirebaseFirestore.WriteBatch
): boolean {
  // Deleted / private / embedding off on YouTube (refreshYouTubeData marks the cache) —
  // hidden for everyone, even "Show anyway", whatever the answers say
  const gone = stub.ytGone === true;
  if (gone) decision = { ...decision, status: "hidden", reason: "No longer available on YouTube", flags: ["unavailable"], severity: "low" };
  const approved = gone ? false : parentDecision ? parentDecision === "approved" : decision.status === "approved";
  const verdict: Omit<VideoVerdict, "parentDecision"> = {
    videoId,
    channelId,
    approved,
    status: decision.status,
    reason: decision.reason,
    flags: decision.flags,
    severity: decision.severity,
    // What the video contains (non-zero ladders only), so the parent app can show
    // why without reading server-only profiles
    ratings: profile && profile.status === "ok" ? summarizeRatings(profile) : {},
    summary: profile && profile.status === "ok" ? (profile.summary ?? "").slice(0, 300) : "",
    ...(profile?.madeForKids === undefined ? {} : { madeForKids: profile.madeForKids }),
    ...(profile?.basis ? { basis: profile.basis } : {}),
    ...(profile?.isShort === undefined ? {} : { isShort: profile.isShort }),
    channelName: profile?.channelName ?? "",
    title: stub.title ?? "",
    thumbnail: stub.thumbnail ?? "",
    publishedAt: stub.publishedAt ?? Timestamp.now(),
    durationSeconds: stub.durationSeconds ?? null,
    evaluatedAt: Timestamp.now(),
  };
  batch.set(db.doc(`users/${parentId}/children/${childId}/videoVerdicts/${videoId}`), verdict, { merge: true });
  return approved;
}

function summarizeRatings(profile: ContentProfile): VideoVerdict["ratings"] {
  const out: VideoVerdict["ratings"] = {};
  const dims = effectiveDims(profile);
  for (const dim of DIMS) {
    const { level, evidence } = dims[dim];
    if (level === null || level > 0) out[dim] = { level, evidence };
  }
  return out;
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
      const verdictSnaps = await db.getAll(
        ...chunk.map((v) => db.doc(`users/${parentId}/children/${childId}/videoVerdicts/${v.id}`))
      );
      const batch = db.batch();
      // Values checks may call the AI — run in small parallel groups
      for (let j = 0; j < chunk.length; j += 5) {
        await Promise.all(
          chunk.slice(j, j + 5).map(async (videoDoc, k) => {
            const snap = profileSnaps[j + k];
            // not analyzed yet — leave as is (older-but-usable profiles are upgraded by reprofileOutdated)
            if (!snap.exists || (snap.data()!.version ?? 0) < MIN_USABLE_PROFILE_VERSION) return;
            const profile = snap.data() as ContentProfile;
            const decision = await decideForChild(db, videoDoc.id, profile, filters, openAiApiKey);
            const parentDecision = verdictSnaps[j + k].data()?.parentDecision;
            const ok = writeVerdict(db, parentId, childId, channelId, videoDoc.id, videoDoc.data(), profile, decision, parentDecision, batch);
            if (ok) channelApproved++;
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

// ── Load value filters for a child ─────────────────────────────

export async function loadValueFiltersForChild(parentId: string, childId: string): Promise<ValueFilters> {
  const snap = await getFirestore().doc(`users/${parentId}/children/${childId}/valueFilters/current`).get();
  return normalizePrefs(snap.data());
}
