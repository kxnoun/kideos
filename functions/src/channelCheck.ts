// ─────────────────────────────────────────────────────────────
// Kideos — channel check before a parent adds a channel
//
// checkChannel (callable): the parent types a channel → we resolve it and show a
// review BEFORE it's added (the app's "Add" then calls resolveAndAddChannel).
//
// ONE shared profile per CHANNEL, made once, used by every family
// (channelChecks/{channelId}); re-made only when CHECK_VERSION changes (e.g. a new
// rating dimension). It records everything a video profile records — every 0–4
// rating with evidence and where it came from, framing, faith, holidays, music,
// LGBTQ+, value flags, topics, purpose — so any filter, now or later, is answered
// from saved data. One Gemini Flash-Lite call:
//   - the latest ~50 thumbnails + titles (what the child sees in the feed)
//   - a Google Search for the channel's reputation (news, parents, Elsagate lists)
// Cost: low media resolution ≈ 16k tokens ≈ 0.5¢ (measured), plus one grounded search.
//
// Per child, in code (no AI): the channel profile goes through the SAME
// evaluateProfile as videos → conflicts in plain words, and a per-child badge.
// The per-video checks are unchanged; this only adds a review at add time.
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { APP_CONFIG, YOUTUBE_API_KEY, GEMINI_API_KEY } from "./config";
import { getChannelDetails, getChannelVideos } from "./youtube";
import { loadValueFiltersForChild } from "./analyzeVideo";
import { evaluateProfile } from "./contentFilter";
import {
  DIMS,
  HOLIDAYS,
  LEVEL_LABELS,
  VALUE_FLAGS,
  VALUE_FLAG_LABELS,
  type Dim,
  type Holiday,
  type ValueFlag,
  type ValueFilters,
} from "./prefs";
import type { ContentProfile, Framing } from "./types";

export const CHECK_VERSION = 3; // v3: full profile (everything a video profile has). Bump when the criteria change → re-checked on next add
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const THUMBNAILS = 50;

type Basis = "thumbnails" | "reputation" | "both" | "";

export interface ChannelProfile {
  purpose: ContentProfile["purpose"];
  dims: Record<Dim, { level: number | null; evidence: string; basis: Basis }>;
  violenceRealism: ContentProfile["violenceRealism"];
  framing: ContentProfile["framing"];
  religionTraditions: string[];
  religiousThemes: string[];
  holidays: ContentProfile["holidays"];
  music: ContentProfile["music"];
  lgbtq: ContentProfile["lgbtq"];
  flags: Record<ValueFlag, { present: boolean; evidence: string }>;
  topics: string[];
}

export interface ChannelReport {
  version: number;
  channelId: string;
  name: string;
  verdict: "good" | "caution" | "not_recommended"; // the AI's general opinion for kids (not per child)
  summary: string; // what the channel is
  reputation: string; // what people say ("" if nothing found)
  wellKnown: boolean; // false = small channel, little found about it
  audienceMinAge: number | null;
  audienceMaxAge: number | null;
  profile: ChannelProfile;
  sources: { title: string; uri: string }[];
  thumbnailsChecked: number;
  createdAt: Timestamp;
}

export interface CheckChannelResponse {
  channel: { channelId: string; name: string; handle: string; thumbnail: string; subscriberCount: number };
  alreadyAdded: boolean;
  report: Omit<ChannelReport, "createdAt"> | null; // null = the check failed (the parent can still add it)
  fit: "good" | "caution" | "not_fit" | null; // per child, from code
  conflicts: string[]; // what's past THIS child's settings, plain words
  findings: { what: string; basis: Basis }[]; // notable things found (level ≥ 2 or flags), for the review
  ageNote: string; // "" or e.g. "Made for ages 13+ — Simon is 6"
}

// ── The prompt ─────────────────────────────────────────────────

const ladders = DIMS.map((d) => `- ${d}: ${LEVEL_LABELS[d].map((l, i) => `${i} ${l}`).join(" · ")}`).join("\n");

const SYSTEM = `You build a content profile of a YouTube CHANNEL for a parental control app, before a parent adds it to their child's list.
You get the channel's details and its latest video thumbnails with titles. You can also search Google.

1. Search Google for the channel's reputation: news articles, Common Sense Media, parent discussions (Reddit etc.), lists of "Elsagate" / disturbing fake kids' channels, controversies. Use what you find; don't invent.
2. Look at EVERY thumbnail — they are part of what the child sees. Look for sexualized or suggestive images (including cartoons), revealing outfits, gore, creepy or disturbing imagery, horror, knock-off characters in weird situations (Elsagate), clickbait, dangerous stunts, and a style too intense for young kids.

Rate the channel on EVERY ladder below: the highest level that shows up in the thumbnails/titles or that people report about the channel (not a one-off from years ago). 0 if there's no sign of it. null only if you truly can't tell.
${ladders}

Respond with ONLY a JSON object, no other text:
{
  "verdict": "good" | "caution" | "not_recommended",
  "summary": "1-2 sentences: what the channel makes",
  "reputation": "1-3 sentences: what parents, press or reviewers say about it for kids. Empty string if you found nothing.",
  "wellKnown": true | false,
  "audienceMinAge": number | null,
  "audienceMaxAge": number | null,
  "purpose": "entertainment" | "educational" | "news" | "devotional" | "commercial",
  "topics": ["3-8 short tags"],
  "dims": { "<every ladder name>": { "level": 0, "evidence": "short plain words, '' if 0", "basis": "thumbnails" | "reputation" | "both" | "" } },
  "violenceRealism": "none" | "cartoon_fantasy" | "realistic_fiction" | "real_footage",
  "framing": { "violence": "neutral" | "condemned" | "glorified", "substances": "...", "selfHarm": "...", "meanness": "..." },
  "religionTraditions": [ONLY from "islam", "judaism", "christianity", "hinduism", "sikhism", "buddhism", "other"],
  "religiousThemes": ["short phrases"],
  "holidays": [ { "name": ONLY from ${HOLIDAYS.map((h) => `"${h}"`).join(", ")}, "prominence": "theme" | "incidental" } ],
  "music": "none" | "background" | "prominent" | "music_video",
  "lgbtq": "none" | "incidental" | "discussion" | "advocacy",
  "flags": { "<every flag name>": { "present": false, "evidence": "" } }
}
Flags: ${VALUE_FLAGS.map((f) => `${f} = ${VALUE_FLAG_LABELS[f]}`).join("; ")}.
- verdict (your general opinion for kids): "not_recommended" = clearly not for kids (sexualized, disturbing, Elsagate, adult content dressed as kids' content). "caution" = fine for some ages or has some concerns. "good" = a normal, well-regarded channel for its audience.
- wellKnown: false if you found little or nothing about it online (small channel) — then judge from thumbnails only and say so in "reputation".
- audienceMinAge / audienceMaxAge: who the channel is made for (null max = and up; both null = all ages).
- Thumbnails can only raise a rating, never excuse one. holidays / music / lgbtq / religion: what the channel regularly features.`;

// ── Gemini call ────────────────────────────────────────────────

async function fetchThumb(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}

async function askGemini(
  apiKey: string,
  parts: unknown[],
  withSearch: boolean
): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts }],
      ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
      // Low resolution: ~280 tokens per thumbnail instead of ~1,100 (thumbnails are only 320×180)
      generationConfig: { temperature: 0, maxOutputTokens: 4000, mediaResolution: "MEDIA_RESOLUTION_LOW" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error(`Gemini returned nothing (finishReason ${cand?.finishReason}, block ${data.promptFeedback?.blockReason})`);
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c: { web?: { title?: string; uri?: string } }) => c.web)
    .filter((w: { uri?: string } | undefined): w is { title?: string; uri: string } => Boolean(w?.uri))
    .slice(0, 6)
    .map((w: { title?: string; uri: string }) => ({ title: w.title ?? w.uri, uri: w.uri }));
  const u = data.usageMetadata ?? {};
  logger.info(`[checkChannel] Gemini tokens in=${u.promptTokenCount ?? "?"} out=${u.candidatesTokenCount ?? "?"} search=${withSearch}`);
  return { text, sources };
}

// ── Parse into a full profile ──────────────────────────────────

function parseJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`No JSON in Gemini reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function ageOrNull(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : Math.max(0, Math.min(18, Math.round(n)));
}

function levelOrNull(v: unknown): number | null {
  if (v === null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 0;
}

const strList = (v: unknown, max = 10) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()).slice(0, max) : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
const framingOf = (v: unknown): Framing => oneOf(v, ["neutral", "condemned", "glorified"] as const, "neutral");

function parseProfile(p: any): ChannelProfile {
  const dims = {} as ChannelProfile["dims"];
  for (const dim of DIMS) {
    const d = p.dims?.[dim] ?? {};
    dims[dim] = {
      level: levelOrNull(d.level ?? 0),
      evidence: String(d.evidence ?? "").slice(0, 200),
      basis: oneOf(d.basis, ["thumbnails", "reputation", "both", ""] as const, ""),
    };
  }
  const flags = {} as ChannelProfile["flags"];
  for (const f of VALUE_FLAGS) {
    const v = p.flags?.[f];
    flags[f] = { present: Boolean(v?.present ?? v), evidence: String(v?.evidence ?? "").slice(0, 200) };
  }
  return {
    purpose: oneOf(p.purpose, ["entertainment", "educational", "news", "devotional", "commercial"] as const, "entertainment"),
    dims,
    violenceRealism: oneOf(p.violenceRealism, ["none", "cartoon_fantasy", "realistic_fiction", "real_footage"] as const, "none"),
    framing: {
      violence: framingOf(p.framing?.violence),
      substances: framingOf(p.framing?.substances),
      selfHarm: framingOf(p.framing?.selfHarm),
      meanness: framingOf(p.framing?.meanness),
    },
    religionTraditions: strList(p.religionTraditions).map((t) => t.toLowerCase()),
    religiousThemes: strList(p.religiousThemes),
    holidays: (Array.isArray(p.holidays) ? p.holidays : [])
      .filter((h: { name?: string }) => (HOLIDAYS as readonly string[]).includes(String(h?.name)))
      .map((h: { name: string; prominence?: string }) => ({
        name: h.name as Holiday,
        prominence: h.prominence === "theme" ? ("theme" as const) : ("incidental" as const),
      })),
    music: { level: oneOf(p.music, ["none", "background", "prominent", "music_video"] as const, "none") },
    lgbtq: oneOf(p.lgbtq, ["none", "incidental", "discussion", "advocacy"] as const, "none"),
    flags,
    topics: strList(p.topics),
  };
}

async function makeReport(
  details: { channelId: string; name: string; handle: string; description: string; subscriberCount: number; uploadsPlaylistId: string },
  youtubeKey: string,
  geminiKey: string
): Promise<Omit<ChannelReport, "createdAt">> {
  const videos = (await getChannelVideos(details.uploadsPlaylistId, youtubeKey, THUMBNAILS, 1)).slice(0, THUMBNAILS);
  const thumbs = await Promise.all(videos.map((v) => fetchThumb(v.videoId)));
  const parts: unknown[] = [
    {
      text: `CHANNEL: ${details.name} (@${details.handle.replace(/^@/, "")})
Subscribers: ${details.subscriberCount.toLocaleString("en-US")}
Description: ${details.description.slice(0, 800)}

LATEST VIDEOS (thumbnail follows each title):`,
    },
  ];
  let thumbnailsChecked = 0;
  videos.forEach((v, i) => {
    parts.push({ text: `${i + 1}. ${v.title}` });
    if (thumbs[i]) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: thumbs[i] } });
      thumbnailsChecked++;
    }
  });

  let reply;
  try {
    reply = await askGemini(geminiKey, parts, true);
  } catch (err) {
    logger.warn(`[checkChannel] With Google Search failed for ${details.name}, retrying thumbnails only:`, err);
    reply = await askGemini(geminiKey, parts, false);
  }
  const p = parseJson(reply.text);
  return {
    version: CHECK_VERSION,
    channelId: details.channelId,
    name: details.name,
    verdict: oneOf(p.verdict, ["good", "caution", "not_recommended"] as const, "caution"),
    summary: String(p.summary ?? "").slice(0, 400),
    reputation: String(p.reputation ?? "").slice(0, 600),
    wellKnown: Boolean(p.wellKnown),
    audienceMinAge: ageOrNull(p.audienceMinAge),
    audienceMaxAge: ageOrNull(p.audienceMaxAge),
    profile: parseProfile(p),
    sources: reply.sources,
    thumbnailsChecked,
  };
}

// ── Per child, in code (no AI) ─────────────────────────────────

const BASIS_WORDS: Record<Basis, string> = { thumbnails: "thumbnails", reputation: "what people say", both: "thumbnails + what people say", "": "" };

// The channel profile as a ContentProfile, so the SAME filter code as videos applies
function asContentProfile(r: Omit<ChannelReport, "createdAt">): ContentProfile {
  const p = r.profile;
  const dims = {} as ContentProfile["dims"];
  for (const dim of DIMS) {
    const d = p.dims[dim];
    const where = BASIS_WORDS[d.basis];
    dims[dim] = { level: d.level, evidence: [where, d.evidence].filter(Boolean).join(": ") };
  }
  return {
    version: 0,
    status: "ok",
    title: r.name,
    channelName: r.name,
    purpose: p.purpose,
    dims,
    violenceRealism: p.violenceRealism,
    framing: p.framing,
    religionTraditions: p.religionTraditions,
    religiousThemes: p.religiousThemes,
    holidays: p.holidays,
    music: p.music,
    lgbtq: p.lgbtq,
    flags: Object.fromEntries(VALUE_FLAGS.map((f) => [f, p.flags[f].present])) as ContentProfile["flags"],
    topics: p.topics,
    summary: r.summary,
    createdAt: Timestamp.now(),
  };
}

export function fitForChild(r: Omit<ChannelReport, "createdAt">, prefs: ValueFilters) {
  // Video-only switches (made-for-kids label, Shorts) don't apply to a whole channel;
  // "can't tell" ratings don't count against a channel
  const decision = evaluateProfile(asContentProfile(r), { ...prefs, madeForKidsOnly: false, hideShorts: false, unknown: "allow" });
  // Reasons come from the video filter — reworded for a channel
  const conflicts = decision.reason ? decision.reason.split("; ").map((c) => c.replace(/\bthe video\b/g, "the channel")) : [];
  const junk = r.profile.dims.junk.level ?? 0;
  const serious = decision.severity === "high" || decision.severity === "medium" || (junk >= 3 && junk > prefs.rules.junk.max);
  const fit: "good" | "caution" | "not_fit" = serious ? "not_fit" : conflicts.length ? "caution" : "good";
  const findings: { what: string; basis: Basis }[] = [];
  for (const dim of DIMS) {
    const d = r.profile.dims[dim];
    if ((d.level ?? 0) >= 2 && d.evidence) findings.push({ what: `${LEVEL_LABELS[dim][d.level ?? 0]}: ${d.evidence}`, basis: d.basis });
  }
  for (const f of VALUE_FLAGS) {
    const v = r.profile.flags[f];
    if (v.present) findings.push({ what: `${VALUE_FLAG_LABELS[f]}${v.evidence ? `: ${v.evidence}` : ""}`, basis: "" });
  }
  return { fit, conflicts, findings };
}

// ── Callable ───────────────────────────────────────────────────

export const checkChannel = onCall(
  { region: APP_CONFIG.FUNCTIONS_REGION, secrets: [YOUTUBE_API_KEY, GEMINI_API_KEY], timeoutSeconds: 120, memory: "512MiB" },
  async (request): Promise<CheckChannelResponse> => {
    const { input, parentId, childId } = request.data as { input?: string; parentId?: string; childId?: string };
    if (!input || !parentId || !childId) throw new HttpsError("invalid-argument", "input, parentId, childId are required");
    if (request.auth?.uid !== parentId) throw new HttpsError("permission-denied", "Not authorized");

    const db = getFirestore();
    const details = await getChannelDetails(input, YOUTUBE_API_KEY.value());
    if (!details) throw new HttpsError("not-found", `Could not find a YouTube channel for: "${input}"`);
    const channel = {
      channelId: details.channelId,
      name: details.name,
      handle: details.handle,
      thumbnail: details.thumbnail,
      subscriberCount: details.subscriberCount,
    };
    const alreadyAdded = (await db.doc(`users/${parentId}/children/${childId}/whitelistedChannels/${details.channelId}`).get()).exists;

    // Shared profile: made once per channel (per CHECK_VERSION)
    const ref = db.doc(`channelChecks/${details.channelId}`);
    const snap = await ref.get();
    let report: Omit<ChannelReport, "createdAt"> | null = null;
    if (snap.exists && snap.data()!.version === CHECK_VERSION) {
      const { createdAt: _c, ...rest } = snap.data() as ChannelReport;
      report = rest;
      logger.info(`[checkChannel] Cached: ${details.name}`);
    } else {
      try {
        report = await makeReport(details, YOUTUBE_API_KEY.value(), GEMINI_API_KEY.value());
        await ref.set({ ...report, createdAt: Timestamp.now() });
        const d = report.profile.dims;
        logger.info(
          `[checkChannel] ${details.name}: ${report.verdict} wellKnown=${report.wellKnown} thumbs=${report.thumbnailsChecked} ` +
            DIMS.filter((x) => (d[x].level ?? 0) > 0).map((x) => `${x}=${d[x].level}`).join(" ")
        );
      } catch (err) {
        logger.error(`[checkChannel] Check failed for ${details.name}:`, err);
      }
    }

    if (!report) return { channel, alreadyAdded, report: null, fit: null, conflicts: [], findings: [], ageNote: "" };

    const prefs = await loadValueFiltersForChild(parentId, childId);
    const { fit, conflicts, findings } = fitForChild(report, prefs);
    const child = (await db.doc(`users/${parentId}/children/${childId}`).get()).data();
    const age = Number(child?.age ?? child?.profile?.age ?? prefs.ageGroup);
    const name = String(child?.name ?? child?.profile?.name ?? "your child");
    let ageNote = "";
    if (report.audienceMinAge !== null && age < report.audienceMinAge) {
      ageNote = `Made for ages ${report.audienceMinAge}+ — ${name} is ${age}`;
    } else if (report.audienceMaxAge !== null && age > report.audienceMaxAge + 1) {
      ageNote = `Made for ages up to ${report.audienceMaxAge} — ${name} is ${age}`;
    }
    return { channel, alreadyAdded, report, fit: fit === "good" && ageNote ? "caution" : fit, conflicts, findings, ageNote };
  }
);
