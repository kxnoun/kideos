// ─────────────────────────────────────────────────────────────
// Kideos — Supadata API client
// Fetches full transcripts for YouTube videos by video ID.
// Falls back gracefully when transcript is unavailable.
// ─────────────────────────────────────────────────────────────

import { logger } from "firebase-functions/v2";
import { APP_CONFIG } from "./config";

export interface TranscriptResult {
  available: boolean;
  transcript: string | null; // null if unavailable
  language: string | null;
  wordCount: number;
}

interface SupadataTranscriptResponse {
  content: string;
  lang?: string;
  availableLanguages?: string[];
}

// ── Fetch transcript by video ID ───────────────────────────────
// Returns the full transcript text, or null if unavailable.
// Called in parallel with videos.list on cache miss — see analyzeVideo.ts

export async function fetchTranscript(
  videoId: string,
  apiKey: string
): Promise<TranscriptResult> {
  logger.info(`[Supadata] Fetching transcript for ${videoId}`);

  try {
    const url = `${APP_CONFIG.SUPADATA_BASE_URL}/youtube/transcript`;

    // text=true → content is a plain string (default is an array of timed segments)
    const urlWithParams = `${url}?videoId=${encodeURIComponent(videoId)}&text=true`;
    const res2 = await fetch(urlWithParams, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (res2.status === 404 || res2.status === 204) {
      // No transcript available — will fall back to metadata-only analysis
      logger.info(`[Supadata] No transcript for ${videoId} (${res2.status})`);
      return { available: false, transcript: null, language: null, wordCount: 0 };
    }

    if (!res2.ok) {
      logger.warn(`[Supadata] Unexpected status ${res2.status} for ${videoId}`);
      return { available: false, transcript: null, language: null, wordCount: 0 };
    }

    const data = await res2.json() as SupadataTranscriptResponse;

    if (!data.content || data.content.trim().length === 0) {
      return { available: false, transcript: null, language: null, wordCount: 0 };
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
