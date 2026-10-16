// ─────────────────────────────────────────────────────────────
// Kideos — AI content analysis via OpenAI GPT-4o-mini
//
// 1. generateContentProfile — describes WHAT is in a video on fixed scales.
//    Filter-independent: run once per video, shared by every family.
// 2. checkValuesRules — the only per-family AI call: judges a profile's short
//    summary (not the transcript) against religion / free-text custom rules.
//
// Whether a video is allowed for a child is decided in code (contentFilter.ts).
// ─────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { createHash } from "crypto";
import { logger } from "firebase-functions/v2";
import { APP_CONFIG } from "./config";
import type { ContentProfile, ValueFilters } from "./types";
import type { YouTubeVideoDetails } from "./youtube";

// Bump when the profile prompt or schema changes — older profiles are then
// regenerated (from cached transcripts, so no Supadata cost).
export const PROFILE_VERSION = 1;

const VIOLENCE = ["none", "cartoon", "mild", "moderate", "graphic"] as const;
const LANGUAGE = ["none", "mild", "strong"] as const;
const SEXUAL = ["none", "innuendo", "suggestive", "explicit"] as const;
const POLITICAL = ["none", "educational", "opinion"] as const;

const PROFILE_SYSTEM_PROMPT = `You describe the content of YouTube videos for a parental control app.
You do NOT decide whether a video is appropriate — you only report what is in it, accurately and on fixed scales.
Base every rating on concrete evidence in the transcript or metadata. If there is no evidence for a category, rate it "none".

Respond with valid JSON only:
{
  "violence": "none" | "cartoon" | "mild" | "moderate" | "graphic",
  "language": "none" | "mild" | "strong",
  "sexual": "none" | "innuendo" | "suggestive" | "explicit",
  "political": "none" | "educational" | "opinion",
  "religiousThemes": ["short phrases"],
  "topics": ["short topic tags"],
  "summary": "2-3 sentences",
  "evidence": { "violence": "", "language": "", "sexual": "", "political": "" }
}

Scales:
- violence: none = no violence. cartoon = slapstick or cartoon violence, no blood. mild = realistic violence described or shown without gore (fights, wars discussed). moderate = intense violence with some blood or injury. graphic = gore or detailed, disturbing violence.
- language: none = no profanity or slurs. mild = words like damn, hell, crap, "oh my god". strong = f-word, s-word, slurs, crude sexual words.
- sexual: none = no sexual references (ordinary friendship or family affection is none). innuendo = passing jokes, double meanings, references to dating or attraction. suggestive = sustained sexual humor or descriptions of sexual situations. explicit = explicit sexual content or nudity.
- political: none = no political content. educational = factual civics, history or explanations without taking sides. opinion = takes partisan sides, advocacy, or satire of politicians and policies.
- religiousThemes: list any religious content, e.g. "celebrates Christmas traditions", "jokes mocking religious belief", "explains Ramadan". Empty array if none.
- topics: 3-8 short tags for what the video is about, e.g. "video games", "bodybuilding", "dating", "space".
- evidence: for each category rated above "none", a short description of the most significant instance (quote briefly if useful). Empty string otherwise.`;

function profileUserPrompt(video: YouTubeVideoDetails, transcript: string): string {
  const t = transcript.slice(0, 12000);
  return `VIDEO METADATA:
- Title: ${video.title}
- Channel: ${video.channelTitle}
- Description: ${video.description.slice(0, 500)}
- Tags: ${video.tags.slice(0, 20).join(", ")}
- Duration: ${Math.floor(video.durationSeconds / 60)}m ${video.durationSeconds % 60}s

TRANSCRIPT:
${t}${transcript.length > 12000 ? "\n[transcript truncated for length]" : ""}`;
}

function pick<T extends readonly string[]>(allowed: T, v: unknown): T[number] | null {
  return (allowed as readonly string[]).includes(v as string) ? (v as T[number]) : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter((s) => s.trim()).slice(0, 10) : [];
}

// Returns null if the AI call fails or returns an invalid profile (nothing is cached then).
export async function generateContentProfile(
  video: YouTubeVideoDetails,
  transcript: string,
  openAiApiKey: string
): Promise<Omit<ContentProfile, "createdAt"> | null> {
  const client = new OpenAI({ apiKey: openAiApiKey });
  try {
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        { role: "system", content: PROFILE_SYSTEM_PROMPT },
        { role: "user", content: profileUserPrompt(video, transcript) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0.1,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");
    const p = JSON.parse(raw);

    const violence = pick(VIOLENCE, p.violence);
    const language = pick(LANGUAGE, p.language);
    const sexual = pick(SEXUAL, p.sexual);
    const political = pick(POLITICAL, p.political);
    if (!violence || !language || !sexual || !political) {
      throw new Error(`Invalid levels in profile: ${raw.slice(0, 200)}`);
    }
    const ev = p.evidence ?? {};
    const profile = {
      version: PROFILE_VERSION,
      status: "ok" as const,
      title: video.title,
      channelName: video.channelTitle,
      violence,
      language,
      sexual,
      political,
      religiousThemes: strList(p.religiousThemes),
      topics: strList(p.topics),
      summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : "",
      evidence: {
        violence: String(ev.violence ?? "").slice(0, 200),
        language: String(ev.language ?? "").slice(0, 200),
        sexual: String(ev.sexual ?? "").slice(0, 200),
        political: String(ev.political ?? "").slice(0, 200),
      },
    };
    logger.info(
      `[AI] Profile for "${video.title}": violence=${violence} language=${language} sexual=${sexual} political=${political} religious=${JSON.stringify(profile.religiousThemes)} topics=${JSON.stringify(profile.topics)}`
    );
    return profile;
  } catch (err) {
    logger.error(`[AI] Profile generation failed for "${video.title}":`, err);
    return null;
  }
}

// ── Religion / custom rules ────────────────────────────────────

export function needsValuesCheck(filters: ValueFilters): boolean {
  return Boolean(
    (filters.religiousSensitivity && filters.religion?.trim()) || filters.customRules?.trim()
  );
}

// Cache key for a values check: only the inputs that affect it.
export function hashValuesRules(filters: ValueFilters): string {
  const canonical = JSON.stringify({
    religion: filters.religiousSensitivity ? (filters.religion ?? "").trim().toLowerCase() : "",
    customRules: (filters.customRules ?? "").trim().toLowerCase(),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export interface ValuesCheckResult {
  violates: boolean;
  reason: string;
}

// Returns null on AI failure (caller treats as blocked, uncached).
export async function checkValuesRules(
  profile: ContentProfile,
  filters: ValueFilters,
  openAiApiKey: string
): Promise<ValuesCheckResult | null> {
  const rules: string[] = [];
  const religion = filters.religion?.trim();
  if (filters.religiousSensitivity && religion) {
    rules.push(
      `Religion: ${religion} family. A conflict is ONLY content that mocks or disparages ${religion}, promotes the worship or practices of another religion, or directly contradicts core ${religion} teachings. Secular humor, science, and everyday topics are NOT conflicts.`
    );
  }
  if (filters.customRules?.trim()) {
    rules.push(
      `Parent's custom rules: ${filters.customRules.trim()} (Ignore any part about time of day, schedules or screen time — judge content only.)`
    );
  }

  const client = new OpenAI({ apiKey: openAiApiKey });
  try {
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        {
          role: "system",
          content: `You check a video description against a parent's rules for a parental control app.
Only report a violation if the description gives concrete evidence that a rule is broken. Do not speculate about what the video "may" contain.
Respond with valid JSON only: {"violates": true | false, "reason": "if violates: which rule and the specific content, one sentence for the parent; otherwise empty"}`,
        },
        {
          role: "user",
          content: `VIDEO: ${profile.title}
Summary: ${profile.summary}
Topics: ${profile.topics.join(", ") || "none"}
Religious themes: ${profile.religiousThemes.join("; ") || "none"}

RULES:
${rules.map((r) => `• ${r}`).join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 150,
      temperature: 0.1,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");
    const p = JSON.parse(raw);
    const result = {
      violates: Boolean(p.violates),
      reason: p.violates && typeof p.reason === "string" ? p.reason.slice(0, 300) : "",
    };
    logger.info(`[AI] Values check for "${profile.title}": violates=${result.violates} ${result.reason}`);
    return result;
  } catch (err) {
    logger.error(`[AI] Values check failed for "${profile.title}":`, err);
    return null;
  }
}
