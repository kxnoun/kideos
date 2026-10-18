// ─────────────────────────────────────────────────────────────
// Kideos — suggested channels
//
// channelCatalog/{channelId} is one shared "channel profile", built from the
// channel's already-analyzed video profiles (videoProfiles) — no Supadata and no
// per-video AI. The only AI call is a short overview, once per channel.
// Every channel any family adds ends up here (built after seeding and after the
// nightly refresh), so the catalog grows by itself.
//
// getChannelSuggestions scores the catalog against one child's answers in code
// (evaluateProfile on each stored video) — free, however many families ask.
// Custom rules / religion text (the per-family AI check) are NOT applied here;
// they're applied once the parent adds the channel, like any other channel.
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import OpenAI from "openai";
import { APP_CONFIG, OPENAI_API_KEY } from "./config";
import { PROFILE_VERSION, MIN_USABLE_PROFILE_VERSION } from "./aiAnalysis";
import { evaluateProfile } from "./contentFilter";
import { loadValueFiltersForChild } from "./analyzeVideo";
import { DIMS, LEVEL_LABELS, HOLIDAY_LABELS, VALUE_FLAG_LABELS, type Dim } from "./prefs";
import type { ContentProfile } from "./types";

type Db = FirebaseFirestore.Firestore;

const VIDEOS_PER_CHANNEL = 50;
const MAX_SUGGESTIONS = 25;
const BACKFILL_PER_CALL = 10;
// Bump to rewrite every overview (e.g. when the overview prompt changes)
const OVERVIEW_VERSION = 3; // v3: + who the channel is made for (audience ages)
// A child is suggested channels made for their age, give or take this many years
const AGE_SLACK = 1;

// A suggestion means "this channel suits your child", not "some of its videos do"
// (a channel where only the mild Shorts pass is still not one to recommend):
//  - judged on CHECKED videos only: no-transcript videos are unknown, not bad
//  - severe is absolute (severeDims), not relative to how strict this child is, so a
//    science video on predators doesn't count, but liquor and strong swearing do;
//    1–2 severe videos are shown as a warning on the card, 3+ rule the channel out
const MIN_ANALYZED = 10; // too few checked videos to judge a channel
const MIN_FIT = 0.75; // share of checked videos that fit the child's answers
const MAX_SEVERE = 2;

// Just what evaluateProfile needs, so a channel's 50 videos fit in one doc
type CompactProfile = Pick<
  ContentProfile,
  "status" | "purpose" | "dims" | "violenceRealism" | "framing" | "religionTraditions" | "holidays" | "music" | "lgbtq" | "flags"
>;

interface CatalogVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: number; // ms
  p: CompactProfile;
}

export interface CatalogEntry {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  overview: string;
  overviewVersion: number;
  // Who the channel is made for (AI estimate). null max = "and up"; both null = all ages / unknown
  audienceMinAge: number | null;
  audienceMaxAge: number | null;
  topics: string[];
  analyzedCount: number; // videos with a profile we can score
  educationalCount: number;
  videos: CatalogVideo[];
  profileVersion: number;
  updatedAt: Timestamp;
}

// ── Build / refresh one channel's catalog entry ─────────────────
// Cheap: Firestore reads + (first time only) one small AI call.

export async function buildCatalogEntry(db: Db, channelId: string, openAiApiKey: string): Promise<void> {
  const cacheSnap = await db.doc(`channelLibraryCache/${channelId}`).get();
  const meta = cacheSnap.data()?.metadata;
  if (!meta?.name) return;

  const stubs = await db
    .collection(`channelLibraryCache/${channelId}/videos`)
    .orderBy("publishedAt", "desc")
    .limit(VIDEOS_PER_CHANNEL)
    .get();
  if (stubs.empty) return;

  const profileSnaps = await db.getAll(...stubs.docs.map((d) => db.doc(`videoProfiles/${d.id}`)));
  const videos: CatalogVideo[] = [];
  const topicCounts = new Map<string, number>();
  const summaries: string[] = [];
  let educationalCount = 0;

  stubs.docs.forEach((stub, i) => {
    const snap = profileSnaps[i];
    if (!snap.exists) return;
    const prof = snap.data() as ContentProfile;
    if ((prof.version ?? 0) < MIN_USABLE_PROFILE_VERSION || prof.status === "unavailable") return;
    const s = stub.data();
    const dims = {} as ContentProfile["dims"];
    for (const dim of DIMS) {
      const d = prof.dims?.[dim] ?? { level: 0, evidence: "" };
      dims[dim] = { level: d.level, evidence: (d.evidence ?? "").slice(0, 80) };
    }
    videos.push({
      videoId: stub.id,
      title: s.title ?? prof.title ?? "",
      thumbnail: s.thumbnail ?? "",
      publishedAt: s.publishedAt?.toMillis?.() ?? 0,
      p: {
        status: prof.status,
        purpose: prof.purpose,
        dims,
        violenceRealism: prof.violenceRealism,
        framing: prof.framing,
        religionTraditions: prof.religionTraditions ?? [],
        holidays: prof.holidays ?? [],
        music: prof.music ?? { level: "none" },
        lgbtq: prof.lgbtq ?? "none",
        flags: prof.flags,
      },
    });
    if (prof.status === "ok") {
      if (prof.purpose === "educational") educationalCount++;
      for (const t of prof.topics ?? []) topicCounts.set(t.toLowerCase(), (topicCounts.get(t.toLowerCase()) ?? 0) + 1);
      if (prof.summary && summaries.length < 12) summaries.push(prof.summary.slice(0, 200));
    }
  });
  if (!videos.length) return;

  const ref = db.doc(`channelCatalog/${channelId}`);
  const existing = (await ref.get()).data() as Partial<CatalogEntry> | undefined;
  const fresh = existing?.overview && existing.overviewVersion === OVERVIEW_VERSION;
  const written = fresh
    ? { overview: existing!.overview!, minAge: existing!.audienceMinAge ?? null, maxAge: existing!.audienceMaxAge ?? null }
    : await writeOverview(meta.name, meta.description ?? "", summaries, contentSummary(videos), openAiApiKey);
  const overview = written?.overview || String(meta.description ?? "").slice(0, 240);

  const entry: CatalogEntry = {
    channelId,
    name: meta.name,
    handle: meta.handle ?? "",
    thumbnail: meta.thumbnail ?? "",
    subscriberCount: meta.subscriberCount ?? 0,
    overview,
    // No AI answer → keep the old version number so it's retried next time
    overviewVersion: written ? OVERVIEW_VERSION : existing?.overviewVersion ?? 0,
    audienceMinAge: written?.minAge ?? null,
    audienceMaxAge: written?.maxAge ?? null,
    topics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t),
    analyzedCount: videos.length,
    educationalCount,
    videos,
    profileVersion: PROFILE_VERSION,
    updatedAt: Timestamp.now(),
  };
  await ref.set(entry);
  logger.info(`[channelCatalog] Built ${meta.name} (${channelId}): ${videos.length} videos`);
}

// How much of the channel has stronger content, per category — so the overview
// can't call a channel "light-hearted" when half of it is liquor and swearing
function contentSummary(videos: CatalogVideo[]): string {
  const ok = videos.filter((v) => v.p.status === "ok");
  const lines: string[] = [];
  for (const dim of DIMS) {
    const strong = ok.filter((v) => (v.p.dims[dim]?.level ?? 0) >= 2).length;
    if (!strong) continue;
    const worst = Math.max(...ok.map((v) => v.p.dims[dim]?.level ?? 0));
    lines.push(`• ${DIM_WORDS[dim]}: ${strong} of ${ok.length} videos at "${LEVEL_LABELS[dim][2]}" or stronger (worst: "${LEVEL_LABELS[dim][worst]}")`);
  }
  return lines.length ? lines.join("\n") : `None of the ${ok.length} checked videos have more than mild content.`;
}

async function writeOverview(
  name: string,
  description: string,
  summaries: string[],
  content: string,
  apiKey: string
): Promise<{ overview: string; minAge: number | null; maxAge: number | null } | null> {
  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write a 2–3 sentence overview of a YouTube channel for parents choosing channels for their kids. " +
            "Say what the channel's videos are about and what they're like. Plain, neutral words. No advice, no hype. " +
            "Only use what you're given. You also get a count of videos with stronger content: if a notable share of " +
            "videos have it (roughly 1 in 5 or more), or any are at the strongest level, say so plainly in the last " +
            "sentence (e.g. \"Many videos include heavy drinking and strong swearing.\"). Never describe a channel as " +
            "family-friendly or light-hearted if the counts say otherwise.\n" +
            "Also say who the channel is MADE FOR (its intended audience, not who it's safe for): e.g. Ms Rachel → 1–4, " +
            "Blippi → 2–6, SciShow Kids → 5–9, SciShow → 12 and up, a channel for adults → 18 and up. Use null for both " +
            "only if it's truly for all ages.\n" +
            'Respond with JSON only: {"overview": "…", "minAge": number | null, "maxAge": number | null (null = and up)}',
        },
        {
          role: "user",
          content: `CHANNEL: ${name}\nDescription: ${description.slice(0, 600)}\n\nRecent videos:\n${summaries.map((s) => `• ${s}`).join("\n")}\n\nStronger content across the checked videos:\n${content}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 220,
      temperature: 0.2,
    });
    const p = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const age = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 99 ? Math.round(v) : null);
    const overview = typeof p.overview === "string" ? p.overview.trim().slice(0, 500) : "";
    if (!overview) return null;
    let minAge = age(p.minAge);
    const maxAge = age(p.maxAge);
    if (minAge !== null && maxAge !== null && maxAge < minAge) minAge = maxAge;
    return { overview, minAge, maxAge };
  } catch (err) {
    logger.error(`[channelCatalog] Overview failed for ${name}:`, err);
    return null;
  }
}

// Never let catalog work break seeding or the nightly refresh
export async function buildCatalogEntrySafe(channelId: string, openAiApiKey: string): Promise<void> {
  try {
    await buildCatalogEntry(getFirestore(), channelId, openAiApiKey);
  } catch (err) {
    logger.error(`[channelCatalog] Build failed for ${channelId}:`, err);
  }
}

// ── Suggestions for one child ───────────────────────────────────

export interface ChannelSuggestion {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  overview: string;
  audienceMinAge: number | null;
  audienceMaxAge: number | null;
  topics: string[];
  analyzed: number; // checked videos (had a transcript)
  unchecked: number; // no transcript — left out of the fit share
  fitting: number; // checked videos that fit
  severe: number; // checked videos that are severe (severeDims) — any one rules the channel out
  severeExamples?: string[]; // for the logs only: "title — dim N (evidence)"
  severeLabels: { label: string; count: number }[]; // shown on the card as a warning (1–2 severe)
  educational: number;
  hiddenReasons: { label: string; count: number }[]; // why the other videos wouldn't show, top 3
  ratings: { dim: Dim; maxLevel: number; count: number }[]; // what's in the videos that WOULD show
  samples: { videoId: string; title: string; thumbnail: string }[];
}

const DIM_WORDS: Record<Dim, string> = {
  violence: "violence", scary: "scary content", language: "language", romance: "romance",
  sexual: "sexual references", substances: "substances", dangerous: "stunts", selfHarm: "self-harm",
  meanness: "meanness", consumerism: "selling", politics: "politics", religion: "religion",
  gambling: "gambling", crudeHumor: "crude humor", matureThemes: "mature themes",
  misinformation: "misinformation", nudity: "nudity",
};

// Turn evaluateProfile's flags into short labels a parent can scan
function flagLabel(flag: string): string {
  const [kind, value] = flag.split(":");
  if (kind === "no_transcript") return "No transcript, so we couldn't check";
  if (kind === "holiday") return HOLIDAY_LABELS[value as keyof typeof HOLIDAY_LABELS] ?? value;
  if (kind === "flag") return VALUE_FLAG_LABELS[value as keyof typeof VALUE_FLAG_LABELS] ?? value;
  if (kind === "music") return "Music";
  if (kind === "lgbtq") return "LGBTQ+ content";
  const dim = kind as Dim;
  if (!DIMS.includes(dim)) return flag;
  if (value === "unknown") return `Couldn't tell the ${DIM_WORDS[dim]} level`;
  if (value === "glorified") return `${DIM_WORDS[dim][0].toUpperCase()}${DIM_WORDS[dim].slice(1)} made to look cool`;
  return LEVEL_LABELS[dim][Number(value)] ?? flag;
}

// Made for this child's age (± AGE_SLACK)? Ms Rachel isn't a suggestion for a 14-year-old.
export function fitsAge(s: Pick<ChannelSuggestion, "audienceMinAge" | "audienceMaxAge">, age: number): boolean {
  if (s.audienceMinAge !== null && age < s.audienceMinAge - AGE_SLACK) return false;
  if (s.audienceMaxAge !== null && age > s.audienceMaxAge + AGE_SLACK) return false;
  return true;
}

export function isSuggestable(s: ChannelSuggestion): boolean {
  return s.analyzed >= MIN_ANALYZED && s.fitting / s.analyzed >= MIN_FIT && s.severe <= MAX_SEVERE;
}

// Why a channel wasn't suggested (for the logs)
export function whyNot(s: ChannelSuggestion): string {
  if (s.analyzed < MIN_ANALYZED) return `only ${s.analyzed} checked videos`;
  if (s.severe > MAX_SEVERE) return `${s.severe} severe video(s): ${(s.severeExamples ?? []).join(" | ")}`;
  return `fit ${s.fitting}/${s.analyzed} (${Math.round((100 * s.fitting) / s.analyzed)}%) < ${MIN_FIT * 100}%`;
}

// The worst of the worst, whatever the child's settings: the top of a ladder the
// child hasn't allowed (strong swearing, graphic violence, glamorized drug use,
// gambling promoted…) or an always-hidden level (self-harm, explicit sexual content).
function severeDims(p: CompactProfile, prefs: Parameters<typeof evaluateProfile>[1]): Dim[] {
  return DIMS.filter((dim) => {
    const lvl = p.dims[dim]?.level;
    if (lvl === null || lvl === undefined) return false;
    if (dim === "selfHarm" && lvl >= 3) return true;
    return lvl === 4 && prefs.rules[dim].max < 4;
  });
}

export function scoreChannel(entry: CatalogEntry, prefs: Parameters<typeof evaluateProfile>[1]): ChannelSuggestion {
  let fitting = 0;
  let severe = 0;
  let checked = 0;
  const severeExamples: string[] = [];
  const severeCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  const ratings = new Map<Dim, { maxLevel: number; count: number }>();
  const samples: ChannelSuggestion["samples"] = [];

  for (const v of entry.videos) {
    if (v.p.status !== "ok") continue; // no transcript — unknown, not counted either way
    checked++;
    const decision = evaluateProfile(v.p as ContentProfile, prefs);
    if (decision.status === "approved") {
      fitting++;
      if (samples.length < 6) samples.push({ videoId: v.videoId, title: v.title, thumbnail: v.thumbnail });
      for (const dim of DIMS) {
        const lvl = v.p.dims[dim]?.level;
        if (lvl && lvl > 0) {
          const r = ratings.get(dim) ?? { maxLevel: 0, count: 0 };
          ratings.set(dim, { maxLevel: Math.max(r.maxLevel, lvl), count: r.count + 1 });
        }
      }
    } else {
      const sd = severeDims(v.p, prefs);
      if (sd.length) {
        severe++;
        for (const d of sd) {
          const label = LEVEL_LABELS[d][v.p.dims[d].level ?? 4];
          severeCounts.set(label, (severeCounts.get(label) ?? 0) + 1);
        }
        if (severeExamples.length < 3) {
          severeExamples.push(`"${v.title}" — ${sd.map((d) => `${d} ${v.p.dims[d].level} (${v.p.dims[d].evidence})`).join(", ")}`);
        }
      }
      for (const label of new Set(decision.flags.map(flagLabel))) {
        reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
      }
    }
  }

  return {
    channelId: entry.channelId,
    name: entry.name,
    handle: entry.handle,
    thumbnail: entry.thumbnail,
    overview: entry.overview,
    audienceMinAge: entry.audienceMinAge ?? null,
    audienceMaxAge: entry.audienceMaxAge ?? null,
    topics: entry.topics,
    analyzed: checked,
    unchecked: entry.videos.length - checked,
    fitting,
    severe,
    severeExamples,
    severeLabels: [...severeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    educational: entry.educationalCount,
    hiddenReasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, count]) => ({ label, count })),
    ratings: [...ratings.entries()].sort((a, b) => b[1].count - a[1].count).map(([dim, r]) => ({ dim, ...r })),
    samples,
  };
}

// Build entries for channels families already added that aren't in the catalog
// yet (channels added before this feature), and rewrite outdated overviews.
async function backfillCatalog(db: Db, openAiApiKey: string): Promise<void> {
  const [cache, catalog] = await Promise.all([
    db.collection("channelLibraryCache").select().get(),
    db.collection("channelCatalog").select("overviewVersion").get(),
  ]);
  const have = new Set(catalog.docs.map((d) => d.id));
  const missing = cache.docs.map((d) => d.id).filter((id) => !have.has(id));
  const stale = catalog.docs.filter((d) => d.get("overviewVersion") !== OVERVIEW_VERSION).map((d) => d.id);
  for (const id of [...missing, ...stale].slice(0, BACKFILL_PER_CALL)) await buildCatalogEntrySafe(id, openAiApiKey);
}

export const getChannelSuggestions = onCall(
  {
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request): Promise<{ suggestions: ChannelSuggestion[] }> => {
    const { parentId, childId } = request.data as { parentId?: string; childId?: string };
    if (!parentId || !childId) throw new HttpsError("invalid-argument", "parentId and childId are required");
    if (request.auth?.uid !== parentId) throw new HttpsError("permission-denied", "Not authorized");

    const db = getFirestore();
    await backfillCatalog(db, OPENAI_API_KEY.value());

    const childPath = `users/${parentId}/children/${childId}`;
    const [prefs, childSnap, whitelisted, dismissed, catalog] = await Promise.all([
      loadValueFiltersForChild(parentId, childId),
      db.doc(childPath).get(),
      db.collection(`${childPath}/whitelistedChannels`).select().get(),
      db.collection(`${childPath}/dismissedSuggestions`).select().get(),
      db.collection("channelCatalog").get(),
    ]);
    const skip = new Set([...whitelisted.docs, ...dismissed.docs].map((d) => d.id));
    const age = Number(childSnap.data()?.age) || prefs.ageGroup;

    const scored = catalog.docs
      .filter((d) => !skip.has(d.id))
      .map((d) => scoreChannel(d.data() as CatalogEntry, prefs));
    const ok = (x: ChannelSuggestion) => fitsAge(x, age) && isSuggestable(x);
    for (const s of scored.filter((x) => !ok(x))) {
      const why = fitsAge(s, age)
        ? whyNot(s)
        : `made for ages ${s.audienceMinAge ?? 0}–${s.audienceMaxAge ?? "up"}, child is ${age}`;
      logger.info(`[getChannelSuggestions] Not suggested: ${s.name} — ${why}`);
    }
    const suggestions = scored
      .filter(ok)
      .map(({ severeExamples: _drop, ...s }) => s)
      .sort((a, b) => {
        const fit = b.fitting / b.analyzed - a.fitting / a.analyzed;
        if (Math.abs(fit) > 0.001) return fit;
        if (prefs.educationalBoost) {
          const edu = b.educational / b.analyzed - a.educational / a.analyzed;
          if (Math.abs(edu) > 0.001) return edu;
        }
        return b.fitting - a.fitting;
      })
      .slice(0, MAX_SUGGESTIONS);

    logger.info(`[getChannelSuggestions] ${parentId}/${childId}: ${suggestions.length} of ${catalog.size} catalog channels`);
    return { suggestions };
  }
);
