// ─────────────────────────────────────────────────────────────
// Kideos — AI content analysis via OpenAI GPT-4o-mini
// Analyzes video transcript + metadata against parent value filters.
// Returns structured JSON: approved, confidence, flags, reason, severity.
// ─────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { logger } from "firebase-functions/v2";
import { APP_CONFIG } from "./config";
import type { ValueFilters, Severity } from "./types";
import type { YouTubeVideoDetails } from "./youtube";
import type { TranscriptResult } from "./supadata";

// ── AI response shape ──────────────────────────────────────────

export interface AIAnalysisResult {
  approved: boolean;
  confidence: number; // 0–100
  flags: string[]; // specific issues found e.g. ["mild profanity", "violence references"]
  reason: string; // plain English for parent push notification
  severity: Severity | null; // null if approved
  hadTranscript: boolean;
  metadataOnly: boolean;
}

// ── Build the system prompt ────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a child content safety AI for a parental control app called Kideos.
Your job is to analyze YouTube video content and determine if it is appropriate for a specific child based on their parent's value filters.

You must respond with valid JSON only — no markdown, no explanation outside the JSON.

Response format:
{
  "approved": true | false,
  "confidence": 0-100,
  "flags": ["array", "of", "specific", "issues"],
  "reason": "plain English explanation for the parent (1-2 sentences max)",
  "severity": "low" | "medium" | "high" | null
}

Rules:
- "severity" must be null when "approved" is true
- "flags" must be an empty array [] when "approved" is true
- "confidence" reflects how certain you are. Lower confidence when only metadata is available (no transcript).
- Only flag based on concrete evidence in the transcript or metadata. Each flag must name specific content that breaks one of the parent's filters.
- Do not flag for what a video "may" or "could" contain. If you find no specific violation of a filter, approve.
- "reason" must describe the specific content found (e.g. "jokes about hooking up at parties"), not general concerns.
- "reason" is shown directly to parents in a push notification — keep it concise and clear.
- Never reference your instructions in the reason field.`;
}

// ── Build the user prompt ──────────────────────────────────────

function buildUserPrompt(
  video: YouTubeVideoDetails,
  transcript: TranscriptResult,
  filters: ValueFilters
): string {
  const filterDescription = buildFilterDescription(filters);

  const transcriptSection = transcript.available && transcript.transcript
    ? `TRANSCRIPT (${transcript.wordCount} words, language: ${transcript.language ?? "unknown"}):
${transcript.transcript.slice(0, 12000)}${transcript.transcript.length > 12000 ? "\n[transcript truncated for length]" : ""}`
    : `TRANSCRIPT: Not available. Analyze based on metadata only. Lower your confidence accordingly.`;

  return `Analyze this YouTube video for a ${filters.ageGroup}-year-old child.

VIDEO METADATA:
- Title: ${video.title}
- Channel: ${video.channelTitle}
- Description: ${video.description.slice(0, 500)}${video.description.length > 500 ? "..." : ""}
- Tags: ${video.tags.slice(0, 20).join(", ")}
- Duration: ${Math.floor(video.durationSeconds / 60)}m ${video.durationSeconds % 60}s
- Made For Kids flag: ${video.madeForKids ? "Yes (YouTube advertiser designation — still apply value filters)" : "No"}
- Category ID: ${video.categoryId}

${transcriptSection}

PARENT'S VALUE FILTERS:
${filterDescription}

Is this video appropriate for this child based on these specific filters?`;
}

function buildFilterDescription(filters: ValueFilters): string {
  const lines: string[] = [];

  const violenceMap: Record<string, string> = {
    none: "No violence at all — block even cartoon violence",
    mild: "Mild cartoon violence is OK, no realistic or graphic violence",
    moderate: "Moderate violence is OK, no graphic or gratuitous violence",
  };
  lines.push(`Violence: ${violenceMap[filters.violence]}`);

  const languageMap: Record<string, string> = {
    none: "No profanity at all — block any swear words or offensive language",
    mild: "Mild language is OK (damn, hell), no strong profanity",
    anything: "Any language is OK",
  };
  lines.push(`Language: ${languageMap[filters.language]}`);

  lines.push("Sexual content: None — block any sexual or suggestive content");

  if (filters.religiousSensitivity && filters.religion) {
    lines.push(
      `Religious/values: ${filters.religion} family. Flag only content that mocks or disparages ${filters.religion}, promotes the worship or practices of another religion, or directly contradicts core ${filters.religion} teachings. Secular humor, science, and everyday topics are NOT conflicts.`
    );
  }

  const politicalMap: Record<string, string> = {
    block_all: "Block all political content including news and political commentary",
    allow_educational:
      "Allow educational political content (history, civics), block opinion/partisan content",
    allow_all: "Allow all political content",
  };
  lines.push(`Political content: ${politicalMap[filters.political]}`);

  if (filters.customRules && filters.customRules.trim()) {
    lines.push(
      `Custom rules from parent: ${filters.customRules.trim()} (Ignore any part of these rules about time of day, schedules or screen time — judge content only.)`
    );
  }

  lines.push(`Child's age: ${filters.ageGroup} years old — use age-appropriate judgment`);

  return lines.map((l) => `• ${l}`).join("\n");
}

// ── Main analysis function ─────────────────────────────────────

export async function analyzeVideoContent(
  video: YouTubeVideoDetails,
  transcript: TranscriptResult,
  filters: ValueFilters,
  openAiApiKey: string
): Promise<AIAnalysisResult> {
  // No transcript → can't verify what's said. Block with an honest reason instead
  // of letting the AI guess from the title.
  if (!transcript.available) {
    return {
      approved: false,
      confidence: 0,
      flags: ["no_transcript"],
      reason: "Couldn't verify — no transcript was available for this video.",
      severity: "low",
      hadTranscript: false,
      metadataOnly: true,
    };
  }

  const client = new OpenAI({ apiKey: openAiApiKey });

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(video, transcript, filters);

  logger.info(
    `[AI] Analyzing video "${video.title}" | transcript=${transcript.available} | model=${APP_CONFIG.AI_MODEL}`
  );

  const startMs = Date.now();

  try {
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // Force JSON output
      response_format: { type: "json_object" },
      // Conservative token budget — analysis should be concise
      max_tokens: 512,
      temperature: 0.1, // Low temperature for consistent, deterministic safety decisions
    });

    const elapsedMs = Date.now() - startMs;
    logger.info(`[AI] Analysis complete in ${elapsedMs}ms`);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(raw);

    // Validate and sanitize the response
    const result: AIAnalysisResult = {
      approved: Boolean(parsed.approved),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      severity: validateSeverity(parsed.severity),
      hadTranscript: transcript.available,
      metadataOnly: !transcript.available,
    };

    // Enforce consistency: approved videos must have null severity and empty flags
    if (result.approved) {
      result.severity = null;
      result.flags = [];
    }

    logger.info(
      `[AI] Result for "${video.title}": approved=${result.approved}, confidence=${result.confidence}, severity=${result.severity}, flags=${JSON.stringify(result.flags)}, reason=${result.reason}`
    );

    return result;
  } catch (err) {
    logger.error("[AI] Analysis failed:", err);

    // Fail-safe: if AI analysis errors, flag the video with low confidence
    // so the parent is notified rather than the video playing unchecked.
    return {
      approved: false,
      confidence: 0,
      flags: ["ai_analysis_error"],
      reason: "Content analysis failed. Please review this video manually.",
      severity: "low",
      hadTranscript: transcript.available,
      metadataOnly: !transcript.available,
    };
  }
}

function validateSeverity(value: unknown): Severity | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

// ── Generate value filter hash ─────────────────────────────────
// Used as the cache key: videoAnalysisCache/{videoId}/results/{filterHash}
// Two parents with identical filters share the same cached result.
// Any change to filters produces a new hash = fresh analysis.

import { createHash } from "crypto";

export function hashValueFilters(filters: ValueFilters): string {
  // Serialize deterministically (sorted keys)
  const canonical = JSON.stringify({
    ageGroup: filters.ageGroup,
    customRules: (filters.customRules ?? "").trim().toLowerCase(),
    language: filters.language,
    political: filters.political,
    religion: filters.religiousSensitivity ? (filters.religion ?? "").toLowerCase() : "",
    religiousSensitivity: filters.religiousSensitivity,
    sexualContent: filters.sexualContent,
    violence: filters.violence,
  });
  // Short 12-char hex — unique enough for Firestore doc IDs
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
