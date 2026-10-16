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
import type { ContentProfile, DimRating, Framing, ValueFilters } from "./types";
import { DIMS, type Dim } from "./prefs";
import type { YouTubeVideoDetails } from "./youtube";

// Bump when the profile prompt or schema changes — older profiles are then
// regenerated (from cached transcripts, so no Supadata cost).
export const PROFILE_VERSION = 2;

const PROFILE_SYSTEM_PROMPT = `You describe the content of YouTube videos for a parental control app.
You do NOT decide whether a video is appropriate — you only report what is in it, accurately, on fixed 0–4 ladders.
For each category, first write the evidence (what in the transcript/metadata supports the rating, quoting briefly), THEN the level.
If there is no evidence for a category, its level is 0 and evidence is "".
Use level null ONLY if the category depends on visuals and the transcript gives no way to tell.

Respond with valid JSON only, in this exact shape:
{
  "summary": "2-3 sentences: what the video is about",
  "topics": ["3-8 short tags, e.g. video games, bodybuilding, dating, space"],
  "purpose": "entertainment" | "educational" | "news" | "devotional" | "commercial",
  "violence":    { "evidence": "", "level": 0, "realism": "none" | "cartoon_fantasy" | "realistic_fiction" | "real_footage", "framing": "neutral" | "condemned" | "glorified" },
  "scary":       { "evidence": "", "level": 0 },
  "language":    { "evidence": "", "level": 0 },
  "romance":     { "evidence": "", "level": 0 },
  "sexual":      { "evidence": "", "level": 0 },
  "substances":  { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "dangerous":   { "evidence": "", "level": 0 },
  "selfHarm":    { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "meanness":    { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "consumerism": { "evidence": "", "level": 0 },
  "politics":    { "evidence": "", "level": 0 },
  "religion":    { "evidence": "", "level": 0, "traditions": [], "themes": [] },
  "gambling":    { "evidence": "", "present": false }
}

Ladders (0 = none in every category):
- violence: 1 slapstick/cartoon, no injury (Tom & Jerry). 2 game, fantasy or sports combat, no blood (Minecraft, superhero fights). 3 realistic fights, injury or death described, weapons used (war history, action recap). 4 graphic or gory detail, real deaths, torture.
- scary: 1 mild suspense. 2 spooky, monsters (Goosebumps-style). 3 horror themes, jump scares, creepypasta. 4 intense horror.
- language: 1 insults like "stupid", "shut up". 2 mild swearing: damn, hell, crap. 3 moderate: ass, bitch, dick, shit. 4 strong: f-word, slurs. ("Hell's Kitchen" or "hell" as a place is not swearing.)
- romance: 1 crushes, hand-holding. 2 dating relationships, kissing. 3 ongoing romantic or physical focus. 4 sexualized romance.
- sexual: 1 mild innuendo most kids would miss. 2 crude sexual jokes or references. 3 sexual discussion or suggestive content. 4 explicit. (Ordinary friendship or family affection is 0.)
- substances (alcohol, smoking/vaping, cannabis, drugs): 1 mentioned. 2 shown or discussed. 3 use shown. 4 detailed or glamorized use.
- dangerous (stunts/challenges kids might copy): 1 clearly professional or safe stunts. 2 risky stunts with warnings. 3 risky stunts without consequences or warnings. 4 dangerous how-to (weapons, fire, chemicals) or harmful challenges.
- selfHarm (suicide, self-harm, eating disorders): 1 only supportive, help-seeking discussion. 2 neutral discussion. 3 detailed or glamorized. 4 instructions or encouragement.
- meanness (pranks, bullying, disrespect): 1 gentle, good-natured pranks or teasing. 2 mean pranks or insults played for laughs, disrespect to parents/teachers. 3 sustained bullying or humiliation. 4 cruelty or harassment encouraged.
- consumerism: 1 brief sponsor mention. 2 extended sponsor segment or product promotion. 3 unboxing, hauls, "buy my merch". 4 constant selling or pressure to buy.
- politics: 1 factual civics or history without taking sides. 2 news reporting. 3 opinion, advocacy, or satire of politicians and policies. 4 extreme or hateful political content.
- religion: 1 descriptive or educational. 2 devotional or worship content. 3 trying to convert viewers. 4 mocking or disrespecting religion. "traditions": which religions appear. "themes": short phrases, e.g. "celebrates Christmas traditions", "explains Ramadan".
- gambling: present = true for casino, betting, loot boxes/gacha, gambling sponsors.
- framing: "glorified" = shown as cool, funny, rewarded or desirable; "condemned" = consequences shown or presented as wrong; otherwise "neutral".
- purpose: "educational" only if teaching is the clear main purpose (documentary, explainer, history).`;

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

// ── Swear-word floor, counted in code ──────────────────────────
// Unambiguous words only; context-dependent ones (hell, damn) are left to the AI.
// YouTube captions often censor swearing as "[ __ ]" — counted as at least moderate.
const STRONG = /\b(f+u+c+k+\w*|motherf\w+)\b/gi;
const MODERATE = /\b(shit\w*|bitch\w*|asshole\w*|bastard\w*|dick(head)?s?)\b/gi;
const CENSORED = /\[\s*_+\s*\]/g;

export function swearFloor(transcript: string): { level: number; evidence: string } {
  const strong = transcript.match(STRONG)?.length ?? 0;
  const moderate = transcript.match(MODERATE)?.length ?? 0;
  const censored = transcript.match(CENSORED)?.length ?? 0;
  if (strong) return { level: 4, evidence: `f-word ×${strong} in transcript` };
  if (moderate || censored) {
    const parts = [moderate && `moderate swear words ×${moderate}`, censored && `censored swear words ×${censored}`].filter(Boolean);
    return { level: 3, evidence: `${parts.join(", ")} in transcript` };
  }
  return { level: 0, evidence: "" };
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter((s) => s.trim()).slice(0, 10) : [];
}

function levelOf(v: unknown): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(`Invalid level ${JSON.stringify(v)}`);
  return n;
}

function framingOf(v: unknown): Framing {
  return v === "glorified" || v === "condemned" ? v : "neutral";
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
      max_tokens: 1200,
      temperature: 0,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");
    const p = JSON.parse(raw);

    const dims = {} as Record<Dim, DimRating>;
    for (const dim of DIMS) {
      const d = p[dim] ?? {};
      const evidence = String(d.evidence ?? "").slice(0, 200);
      const level = dim === "gambling" ? (d.present ? 4 : 0) : levelOf(d.level);
      dims[dim] = { level, evidence };
    }
    // Code-counted swearing can only raise the AI's language level
    const floor = swearFloor(transcript);
    if (floor.level > (dims.language.level ?? 0)) dims.language = floor;

    const purposes = ["entertainment", "educational", "news", "devotional", "commercial"] as const;
    const realisms = ["none", "cartoon_fantasy", "realistic_fiction", "real_footage"] as const;
    const profile: Omit<ContentProfile, "createdAt"> = {
      version: PROFILE_VERSION,
      status: "ok",
      title: video.title,
      channelName: video.channelTitle,
      purpose: purposes.includes(p.purpose) ? p.purpose : "entertainment",
      dims,
      violenceRealism: realisms.includes(p.violence?.realism) ? p.violence.realism : "none",
      framing: {
        violence: framingOf(p.violence?.framing),
        substances: framingOf(p.substances?.framing),
        selfHarm: framingOf(p.selfHarm?.framing),
        meanness: framingOf(p.meanness?.framing),
      },
      religionTraditions: strList(p.religion?.traditions),
      religiousThemes: strList(p.religion?.themes),
      topics: strList(p.topics),
      summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : "",
    };
    logger.info(
      `[AI] Profile for "${video.title}": ${DIMS.map((d) => `${d}=${dims[d].level}`).join(" ")} purpose=${profile.purpose} topics=${JSON.stringify(profile.topics)}`
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
