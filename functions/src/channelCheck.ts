// ─────────────────────────────────────────────────────────────
// Kideos — channel check before a parent adds a channel
//
// checkChannel (callable): the parent types a channel → we resolve it and show a
// review BEFORE it's added (the app's "Add anyway" then calls resolveAndAddChannel).
//
// The report is per CHANNEL, shared by every family, made once
// (channelChecks/{channelId}). Re-made only when CHECK_VERSION changes (e.g. a new
// rating dimension). One Gemini Flash-Lite call:
//   - the latest ~50 thumbnails + titles (what the child will see in the feed)
//   - a Google Search for the channel's reputation (news, parents, Elsagate lists)
// Cost: low media resolution ≈ 50 × ~280 image tokens + text ≈ 0.5¢ (default resolution
// measured 57.7k tokens ≈ 1.8¢), plus one grounded search.
//
// Conflicts with a child's settings are worked out in code from the shared
// report's concerns (same 0–4 ladders as video profiles) — no AI per family.
// The per-video checks are unchanged; this only adds a warning at add time.
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { APP_CONFIG, YOUTUBE_API_KEY, GEMINI_API_KEY } from "./config";
import { getChannelDetails, getChannelVideos } from "./youtube";
import { loadValueFiltersForChild } from "./analyzeVideo";
import { DIMS, LEVEL_LABELS, VALUE_FLAGS, VALUE_FLAG_LABELS, type Dim, type ValueFlag } from "./prefs";

export const CHECK_VERSION = 2; // v2: low-resolution thumbnails (cost) — bump when the criteria change (new dimension etc.) → channels re-checked on next add
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const THUMBNAILS = 50;

export interface ChannelConcern {
  dim: Dim | null; // one of our 0–4 ladders…
  flag: ValueFlag | null; // …or a faith & family value flag
  level: number; // 0–4 on that ladder (flags: 1)
  what: string; // plain words for the parent
  basis: "thumbnails" | "reputation";
}

export interface ChannelReport {
  version: number;
  channelId: string;
  name: string;
  verdict: "good" | "caution" | "not_recommended" | "unchecked";
  summary: string; // what the channel is
  reputation: string; // what people say ("" if nothing found)
  wellKnown: boolean; // false = small channel, little found about it
  audienceMinAge: number | null;
  audienceMaxAge: number | null;
  concerns: ChannelConcern[];
  sources: { title: string; uri: string }[];
  thumbnailsChecked: number;
  createdAt: Timestamp;
}

export interface CheckChannelResponse {
  channel: { channelId: string; name: string; handle: string; thumbnail: string; subscriberCount: number };
  alreadyAdded: boolean;
  report: Omit<ChannelReport, "createdAt"> | null; // null = the check failed (the parent can still add it)
  conflicts: string[]; // concerns above THIS child's limits, plain words
  ageNote: string; // "" or e.g. "Made for ages 13+ — Simon is 6"
}

// ── The prompt ─────────────────────────────────────────────────

function ladderText(): string {
  return DIMS.map((d) => `- ${d}: ${LEVEL_LABELS[d].map((l, i) => `${i} ${l}`).join(" · ")}`).join("\n");
}

const SYSTEM = `You check a YouTube channel for a parental control app, before a parent adds it to their child's list.
You get the channel's details and its latest video thumbnails with titles. You can also search Google.

1. Search Google for the channel's reputation: news articles, Common Sense Media, parent discussions (Reddit etc.), lists of "Elsagate" / disturbing fake kids' channels, controversies. Use what you find; don't invent.
2. Look at EVERY thumbnail. Thumbnails are part of what the child sees. Look for: sexualized or suggestive images (including cartoons), revealing outfits, gore, creepy or disturbing imagery, horror, knock-off characters in weird situations (Elsagate), clickbait, dangerous stunts, and a style too intense for young kids.

Report what you find on these 0–4 ladders (the same ones the app uses for single videos):
${ladderText()}

and these yes/no value flags: ${VALUE_FLAGS.map((f) => `${f} (${VALUE_FLAG_LABELS[f]})`).join("; ")}.

Respond with ONLY a JSON object, no other text:
{
  "verdict": "good" | "caution" | "not_recommended",
  "summary": "1-2 sentences: what the channel makes",
  "reputation": "1-3 sentences: what parents, press or reviewers say about it for kids. Empty string if you found nothing.",
  "wellKnown": true | false,
  "audienceMinAge": number | null,
  "audienceMaxAge": number | null,
  "concerns": [ { "dim": "<a ladder name or null>", "flag": "<a flag name or null>", "level": 0-4, "what": "short plain words, e.g. 'several thumbnails show sexualized cartoon women'", "basis": "thumbnails" | "reputation" } ]
}
- verdict: "not_recommended" = clearly not for kids (sexualized, disturbing, Elsagate, adult content dressed as kids' content). "caution" = fine for some ages or has some concerns. "good" = a normal, well-regarded channel for its audience.
- wellKnown: false if you found little or nothing about it online (small channel) — then judge from thumbnails only and say so in "reputation".
- audienceMinAge / audienceMaxAge: who the channel is made for (null max = and up; both null = all ages).
- concerns: only real ones, each with the ladder level it reaches. Empty array if none. Thumbnails can only add concerns, never excuse them.`;

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

async function askGemini(apiKey: string, parts: unknown[], withSearch: boolean): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts }],
      ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
      // Low resolution: ~280 tokens per thumbnail instead of ~1,100 (thumbnails are only 320×180)
      generationConfig: { temperature: 0, maxOutputTokens: 2000, mediaResolution: "MEDIA_RESOLUTION_LOW" },
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

function parseReport(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`No JSON in Gemini reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function ageOrNull(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : Math.max(0, Math.min(18, Math.round(n)));
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
  const p = parseReport(reply.text);

  const concerns: ChannelConcern[] = (Array.isArray(p.concerns) ? p.concerns : [])
    .map((c: any) => ({
      dim: (DIMS as readonly string[]).includes(c?.dim) ? (c.dim as Dim) : null,
      flag: (VALUE_FLAGS as readonly string[]).includes(c?.flag) ? (c.flag as ValueFlag) : null,
      level: Math.max(0, Math.min(4, Math.round(Number(c?.level) || 0))),
      what: String(c?.what ?? "").slice(0, 200),
      basis: c?.basis === "reputation" ? ("reputation" as const) : ("thumbnails" as const),
    }))
    .filter((c: ChannelConcern) => c.what && (c.dim || c.flag))
    .slice(0, 12);
  const verdicts = ["good", "caution", "not_recommended"] as const;
  return {
    version: CHECK_VERSION,
    channelId: details.channelId,
    name: details.name,
    verdict: verdicts.includes(p.verdict) ? p.verdict : "caution",
    summary: String(p.summary ?? "").slice(0, 400),
    reputation: String(p.reputation ?? "").slice(0, 600),
    wellKnown: Boolean(p.wellKnown),
    audienceMinAge: ageOrNull(p.audienceMinAge),
    audienceMaxAge: ageOrNull(p.audienceMaxAge),
    concerns,
    sources: reply.sources,
    thumbnailsChecked,
  };
}

// ── This child's conflicts (code, no AI) ───────────────────────

function conflictsFor(report: Omit<ChannelReport, "createdAt">, prefs: Awaited<ReturnType<typeof loadValueFiltersForChild>>): string[] {
  const out: string[] = [];
  for (const c of report.concerns) {
    const where = c.basis === "thumbnails" ? "in its thumbnails" : "people say";
    if (c.dim) {
      const max = prefs.rules[c.dim].max;
      if (c.level > max) {
        out.push(`${c.what} (${where}) — ${LEVEL_LABELS[c.dim][c.level]}; your limit: ${LEVEL_LABELS[c.dim][max]}`);
      }
    } else if (c.flag && prefs.flags[c.flag] === "hide") {
      out.push(`${c.what} (${where}) — you chose to hide ${VALUE_FLAG_LABELS[c.flag].toLowerCase()}`);
    }
  }
  return out;
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

    // Shared report: made once per channel (per CHECK_VERSION)
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
        logger.info(
          `[checkChannel] ${details.name}: ${report.verdict} wellKnown=${report.wellKnown} thumbs=${report.thumbnailsChecked} ` +
            `concerns=${JSON.stringify(report.concerns.map((c) => `${c.dim ?? c.flag}=${c.level}`))}`
        );
      } catch (err) {
        logger.error(`[checkChannel] Check failed for ${details.name}:`, err);
      }
    }

    let conflicts: string[] = [];
    let ageNote = "";
    if (report) {
      const prefs = await loadValueFiltersForChild(parentId, childId);
      conflicts = conflictsFor(report, prefs);
      const child = (await db.doc(`users/${parentId}/children/${childId}`).get()).data();
      const age = Number(child?.profile?.age ?? child?.age ?? prefs.ageGroup);
      const name = String(child?.profile?.name ?? child?.name ?? "your child");
      if (report.audienceMinAge !== null && age < report.audienceMinAge) {
        ageNote = `Made for ages ${report.audienceMinAge}+ — ${name} is ${age}`;
      } else if (report.audienceMaxAge !== null && age > report.audienceMaxAge + 1) {
        ageNote = `Made for ages up to ${report.audienceMaxAge} — ${name} is ${age}`;
      }
    }
    return { channel, alreadyAdded, report, conflicts, ageNote };
  }
);
