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
import { PROFILE_VERSION } from "./aiAnalysis";
import { evaluateProfile } from "./contentFilter";
import { loadValueFiltersForChild } from "./analyzeVideo";
import { DIMS, LEVEL_LABELS, HOLIDAY_LABELS, VALUE_FLAG_LABELS, type Dim } from "./prefs";
import type { ContentProfile } from "./types";

type Db = FirebaseFirestore.Firestore;

const VIDEOS_PER_CHANNEL = 50;
const MAX_SUGGESTIONS = 25;
const BACKFILL_PER_CALL = 10;

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
    if (prof.version !== PROFILE_VERSION || prof.status === "unavailable") return;
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
  const overview =
    existing?.overview ||
    (await writeOverview(meta.name, meta.description ?? "", summaries, openAiApiKey)) ||
    String(meta.description ?? "").slice(0, 240);

  const entry: CatalogEntry = {
    channelId,
    name: meta.name,
    handle: meta.handle ?? "",
    thumbnail: meta.thumbnail ?? "",
    subscriberCount: meta.subscriberCount ?? 0,
    overview,
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

async function writeOverview(name: string, description: string, summaries: string[], apiKey: string): Promise<string | null> {
  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write a 2–3 sentence overview of a YouTube channel for parents choosing channels for their kids. " +
            "Say what the channel's videos are about and what they're like. Plain, neutral words. No ratings, no advice, no hype. " +
            "Only use what the description and video summaries say.",
        },
        {
          role: "user",
          content: `CHANNEL: ${name}\nDescription: ${description.slice(0, 600)}\n\nRecent videos:\n${summaries.map((s) => `• ${s}`).join("\n")}`,
        },
      ],
      max_tokens: 160,
      temperature: 0.2,
    });
    return completion.choices[0]?.message?.content?.trim().slice(0, 500) || null;
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
  topics: string[];
  analyzed: number;
  fitting: number;
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

export function scoreChannel(entry: CatalogEntry, prefs: Parameters<typeof evaluateProfile>[1]): ChannelSuggestion {
  let fitting = 0;
  const reasonCounts = new Map<string, number>();
  const ratings = new Map<Dim, { maxLevel: number; count: number }>();
  const samples: ChannelSuggestion["samples"] = [];

  for (const v of entry.videos) {
    const decision = evaluateProfile(v.p as ContentProfile, prefs);
    if (decision.status === "approved") {
      fitting++;
      if (samples.length < 6) samples.push({ videoId: v.videoId, title: v.title, thumbnail: v.thumbnail });
      if (v.p.status === "ok") {
        for (const dim of DIMS) {
          const lvl = v.p.dims[dim]?.level;
          if (lvl && lvl > 0) {
            const r = ratings.get(dim) ?? { maxLevel: 0, count: 0 };
            ratings.set(dim, { maxLevel: Math.max(r.maxLevel, lvl), count: r.count + 1 });
          }
        }
      }
    } else {
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
    topics: entry.topics,
    analyzed: entry.videos.length,
    fitting,
    educational: entry.educationalCount,
    hiddenReasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, count]) => ({ label, count })),
    ratings: [...ratings.entries()].sort((a, b) => b[1].count - a[1].count).map(([dim, r]) => ({ dim, ...r })),
    samples,
  };
}

// Build entries for channels families already added that aren't in the catalog
// yet (channels added before this feature). Reads ids only.
async function backfillCatalog(db: Db, openAiApiKey: string): Promise<void> {
  const [cache, catalog] = await Promise.all([
    db.collection("channelLibraryCache").select().get(),
    db.collection("channelCatalog").select().get(),
  ]);
  const have = new Set(catalog.docs.map((d) => d.id));
  const missing = cache.docs.map((d) => d.id).filter((id) => !have.has(id)).slice(0, BACKFILL_PER_CALL);
  for (const id of missing) await buildCatalogEntrySafe(id, openAiApiKey);
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
    const [prefs, whitelisted, dismissed, catalog] = await Promise.all([
      loadValueFiltersForChild(parentId, childId),
      db.collection(`${childPath}/whitelistedChannels`).select().get(),
      db.collection(`${childPath}/dismissedSuggestions`).select().get(),
      db.collection("channelCatalog").get(),
    ]);
    const skip = new Set([...whitelisted.docs, ...dismissed.docs].map((d) => d.id));

    const suggestions = catalog.docs
      .filter((d) => !skip.has(d.id))
      .map((d) => scoreChannel(d.data() as CatalogEntry, prefs))
      .filter((s) => s.fitting > 0)
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
