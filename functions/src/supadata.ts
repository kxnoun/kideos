// ─────────────────────────────────────────────────────────────
// Kideos — Supadata API client
// Fetches full transcripts for YouTube videos by video ID.
// Falls back gracefully when transcript is unavailable.
// ─────────────────────────────────────────────────────────────

import { logger } from "firebase-functions/v2";
import { APP_CONFIG } from "./config";

// Supadata rate-limits bursts, so run transcript requests one at a time with a
// short gap between them (module-level queue, shared by the whole batch).
const SUPADATA_GAP_MS = 1100;
let supadataQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = supadataQueue.then(fn, fn);
  const gap = () => new Promise((r) => setTimeout(r, SUPADATA_GAP_MS));
  supadataQueue = run.then(gap, gap);
  return run;
}

export interface TranscriptResult {
  available: boolean;
  transcript: string | null; // null if unavailable
  language: string | null;
  wordCount: number;
  // true when Supadata confirmed this video has no transcript (safe to cache);
  // false/undefined for transient failures (rate limit, network) — retry later
  definitive?: boolean;
}

interface SupadataTranscriptResponse {
  content: string;
  lang?: string;
  availableLanguages?: string[];
}

// ── Fetch transcript by video ID ───────────────────────────────
// Returns the full transcript text, or null if unavailable.
// Every call costs Supadata credits — only call via getTranscriptCached (analyzeVideo.ts).

export async function fetchTranscript(
  videoId: string,
  apiKey: string
): Promise<TranscriptResult> {
  logger.info(`[Supadata] Fetching transcript for ${videoId}`);

  try {
    const url = `${APP_CONFIG.SUPADATA_BASE_URL}/youtube/transcript`;

    // text=true → content is a plain string (default is an array of timed segments)
    // lang=en → prefer English captions (Supadata falls back to the first available)
    const urlWithParams = `${url}?videoId=${encodeURIComponent(videoId)}&text=true&lang=en`;

    // Exactly one request per call, queued one-at-a-time. No retries: a 429 means
    // rate limit or out of credits — either way, retrying just spends more requests.
    // The video stays uncached and is retried on a later run.
    const res2 = await queued(() => fetch(urlWithParams, { headers: { "x-api-key": apiKey } }));

    if (res2.status === 404 || res2.status === 204 || res2.status === 206) {
      // Supadata confirmed: no transcript for this video
      logger.info(`[Supadata] No transcript for ${videoId} (${res2.status})`);
      return { available: false, transcript: null, language: null, wordCount: 0, definitive: true };
    }

    if (!res2.ok) {
      logger.warn(`[Supadata] Unexpected status ${res2.status} for ${videoId}: ${(await res2.text()).slice(0, 200)}`);
      return { available: false, transcript: null, language: null, wordCount: 0 };
    }

    const data = await res2.json() as SupadataTranscriptResponse;

    if (!data.content || data.content.trim().length === 0) {
      // Successful response with no speech — also definitive
      return { available: false, transcript: null, language: null, wordCount: 0, definitive: true };
    }

    const transcript = data.content.trim();
    const wordCount = transcript.split(/\s+/).length;

    logger.info(`[Supadata] Got transcript for ${videoId}: ${wordCount} words, lang=${data.lang}`);

    return {
      available: true,
      transcript,
      language: data.lang ?? null,
      wordCount,
    };
  } catch (err) {
    // Network error — don't crash the pipeline, fall back to metadata
    logger.error(`[Supadata] Error fetching transcript for ${videoId}:`, err);
    return { available: false, transcript: null, language: null, wordCount: 0 };
  }
}
