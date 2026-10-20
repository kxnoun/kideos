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
import { evaluateProfile, effectiveDims } from "./contentFilter";
import { loadValueFiltersForChild } from "./analyzeVideo";
import { CHECK_VERSION, applyVideoFloors, fitForChild, type ChannelReport } from "./channelCheck";
import { DIMS, LEVEL_LABELS, HOLIDAY_LABELS, VALUE_FLAG_LABELS, type Dim } from "./prefs";
import type { ContentProfile } from "./types";
import { assertMember } from "./access";

type Db = FirebaseFirestore.Firestore;

// The catalog's view of a channel: its latest long videos + a few Shorts (most creators'
// newest 50 uploads are ~90% Shorts, which said little about the channel)
const CATALOG_LONG = 40;
const CATALOG_SHORTS = 10;
const MAX_SUGGESTIONS = 25;
const BACKFILL_PER_CALL = 10;
// Bump to rewrite every overview (e.g. when the overview prompt changes)
const OVERVIEW_VERSION = 4; // v4: ages = who it suits (youngest age it's suitable & interesting for), not "made for" (SmarterEveryDay was 12+). v3: + audience ages
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
  "status" | "purpose" | "dims" | "violenceRealism" | "framing" | "religionTraditions" | "holidays" | "music" | "lgbtq" | "flags" | "madeForKids" | "isShort"
>;

export interface CatalogVideo {
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
    .limit(300)
    .get();
  if (stubs.empty) return;

  const allSnaps = await db.getAll(...stubs.docs.map((d) => db.doc(`videoProfiles/${d.id}`)));
  // Newest first: up to CATALOG_LONG long videos and CATALOG_SHORTS Shorts
  // (a Short = the profile's isShort, else the stub's kind from the Shorts playlist)
  const picked: number[] = [];
  let longs = 0;
  let shorts = 0;
  stubs.docs.forEach((stub, i) => {
    const isShort = (allSnaps[i].data()?.isShort as boolean | undefined) ?? stub.data().kind === "short";
    if (isShort ? shorts++ < CATALOG_SHORTS : longs++ < CATALOG_LONG) picked.push(i);
  });
  const pickedStubs = picked.map((i) => stubs.docs[i]);
  const profileSnaps = picked.map((i) => allSnaps[i]);
  const videos: CatalogVideo[] = [];
  const topicCounts = new Map<string, number>();
  const summaries: string[] = [];
  let educationalCount = 0;

  pickedStubs.forEach((stub, i) => {
    const snap = profileSnaps[i];
    if (!snap.exists) return;
    const prof = snap.data() as ContentProfile;
    if ((prof.version ?? 0) < MIN_USABLE_PROFILE_VERSION || prof.status === "unavailable") return;
    const s = stub.data();
    const dims = {} as ContentProfile["dims"];
    const full = effectiveDims(prof); // missing dims as 0, "Too hyper" reports applied
    for (const dim of DIMS) {
      const d = full[dim];
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
        ...(prof.madeForKids === undefined ? {} : { madeForKids: prof.madeForKids }),
        ...(prof.isShort === undefined ? {} : { isShort: prof.isShort }),
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
"Also give the AGE RANGE it suits: minAge = the youngest age its videos are suitable for AND interesting to; " +
            "maxAge = the oldest age it still appeals to (set it only for clearly little-kid channels). Judge the AUDIENCE, not " +
            "how strict a parent might be — the app checks each video's content against the parent's settings separately. A " +
            "general-audience channel that's fine for kids gets the age kids start enjoying it, not 12 or 18. Examples: Ms " +
            "Rachel → 1–5, Blippi → 2–7, SciShow Kids → 5–10, a general science or engineering channel → around 8 and up, a " +
            "channel only adults should watch (drinking, sexual content) → 18 and up. Use null for both only if it truly " +
            "suits every age.\n" +
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
  // From the channel's saved channel check, if anyone has checked it (thumbnails + what people say)
  check?: { fit: "good" | "caution"; thingsToKnow: string[]; overall: ChannelReport["verdict"] };
  longOnly: boolean; // true = fitting/analyzed count long videos only (Shorts below)
  shorts?: { fitting: number; analyzed: number }; // the channel's Shorts, on their own (absent if "No Shorts")
  samples: { videoId: string; title: string; thumbnail: string }[];
}

const DIM_WORDS: Record<Dim, string> = {
  violence: "violence", scary: "scary content", language: "language", romance: "romance",
  sexual: "sexual references", substances: "substances", dangerous: "stunts", selfHarm: "self-harm",
  meanness: "meanness", consumerism: "selling", politics: "politics", religion: "religion",
  gambling: "gambling", crudeHumor: "crude humor", matureThemes: "mature themes",
  misinformation: "misinformation", nudity: "nudity", stimulation: "overstimulation", junk: "junk content",
};

// Turn evaluateProfile's flags into short labels a parent can scan
function flagLabel(flag: string): string {
  const [kind, value] = flag.split(":");
  if (kind === "no_transcript") return "No transcript, so we couldn't check";
  if (kind === "holiday") return HOLIDAY_LABELS[value as keyof typeof HOLIDAY_LABELS] ?? value;
  if (kind === "flag") return VALUE_FLAG_LABELS[value as keyof typeof VALUE_FLAG_LABELS] ?? value;
  if (kind === "music") return "Music";
  if (kind === "lgbtq") return "LGBTQ+ content";
  if (kind === "not_made_for_kids") return "Not made for kids";
  if (kind === "short") return "Shorts";
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
  const why = s.hiddenReasons.map((r) => `${r.label} (${r.count})`).join(", ");
  return (
    `fit ${s.fitting}/${s.analyzed}${s.longOnly ? " long videos" : ""} (${Math.round((100 * s.fitting) / s.analyzed)}%) < ${MIN_FIT * 100}%` +
    (why ? ` — hidden for: ${why}` : "")
  );
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
  // Long videos decide whether a channel is suggested; Shorts are counted on their own line
  // (and not at all if the child has "No Shorts" — a format, not a reason the channel doesn't fit).
  // Channels with too few checked long videos are scored on everything instead.
  const ok = entry.videos.filter((v) => v.p.status === "ok");
  const longs = ok.filter((v) => !v.p.isShort);
  const shortsOk = ok.filter((v) => v.p.isShort);
  const mainSet = longs.length >= MIN_ANALYZED || prefs.hideShorts ? longs : ok;
  const shortsSet = mainSet === longs && !prefs.hideShorts ? shortsOk : [];

  let fitting = 0;
  let severe = 0;
  const severeExamples: string[] = [];
  const severeCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  const ratings = new Map<Dim, { maxLevel: number; count: number }>();
  const samples: ChannelSuggestion["samples"] = [];

  for (const v of mainSet) {
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
  const shortsFitting = shortsSet.filter((v) => evaluateProfile(v.p as ContentProfile, prefs).status === "approved").length;

  return {
    channelId: entry.channelId,
    name: entry.name,
    handle: entry.handle,
    thumbnail: entry.thumbnail,
    overview: entry.overview,
    audienceMinAge: entry.audienceMinAge ?? null,
    audienceMaxAge: entry.audienceMaxAge ?? null,
    topics: entry.topics,
    analyzed: mainSet.length,
    unchecked: entry.videos.length - ok.length,
    fitting,
    severe,
    severeExamples,
    severeLabels: [...severeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    educational: entry.educationalCount,
    hiddenReasons: [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, count]) => ({ label, count })),
    ratings: [...ratings.entries()].sort((a, b) => b[1].count - a[1].count).map(([dim, r]) => ({ dim, ...r })),
    samples,
    longOnly: mainSet === longs,
    ...(shortsSet.length ? { shorts: { fitting: shortsFitting, analyzed: shortsSet.length } } : {}),
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
    await assertMember(request.auth);
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

    const entries = new Map(catalog.docs.map((d) => [d.id, d.data() as CatalogEntry]));
    const candidates = catalog.docs.filter((d) => !skip.has(d.id));
    // Saved channel checks (only ones someone already made — no AI here)
    const checkSnaps = candidates.length ? await db.getAll(...candidates.map((d) => db.doc(`channelChecks/${d.id}`))) : [];
    const savedChecks = new Map<string, Omit<ChannelReport, "createdAt">>();
    checkSnaps.forEach((snap) => {
      if (!snap.exists || snap.data()!.version !== CHECK_VERSION) return;
      const { createdAt: _c, ...saved } = snap.data() as ChannelReport;
      savedChecks.set(snap.id, saved);
    });
    const scored = candidates.map((d) => {
      const s = scoreChannel(d.data() as CatalogEntry, prefs);
      // The channel check's ages are backed by a Google search — prefer them
      const c = savedChecks.get(d.id);
      return c ? { ...s, audienceMinAge: c.audienceMinAge, audienceMaxAge: c.audienceMaxAge } : s;
    });
    const ok = (x: ChannelSuggestion) => fitsAge(x, age) && isSuggestable(x);
    for (const s of scored.filter((x) => !ok(x))) {
      const why = fitsAge(s, age)
        ? whyNot(s)
        : `suits ages ${s.audienceMinAge ?? 0}–${s.audienceMaxAge ?? "up"}, child is ${age}`;
      logger.info(`[getChannelSuggestions] Not suggested: ${s.name} — ${why}`);
    }

    // Saved channel checks (only ones someone already made — no AI here): a channel that's
    // "not a fit" for this child isn't suggested; otherwise its things-to-know go on the card
    const passing = scored.filter(ok);
    const withChecks: ChannelSuggestion[] = [];
    passing.forEach((s) => {
      const saved = savedChecks.get(s.channelId);
      if (!saved) {
        withChecks.push(s);
        return;
      }
      const report = applyVideoFloors(saved, entries.get(s.channelId)?.videos ?? []);
      const { fit, conflicts } = fitForChild(report, prefs);
      if (fit === "not_fit") {
        logger.info(`[getChannelSuggestions] Not suggested: ${s.name} — channel check: not a fit (${conflicts.join(" | ")})`);
        return;
      }
      withChecks.push({ ...s, check: { fit, thingsToKnow: conflicts, overall: report.verdict } });
    });

    const suggestions = withChecks
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
