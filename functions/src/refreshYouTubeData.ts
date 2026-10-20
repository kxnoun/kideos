// ─────────────────────────────────────────────────────────────
// Kideos — refreshYouTubeData (nightly)
//
// YouTube's API policy (Developer Policies III.E.4): data we got from the API (titles,
// thumbnails, dates, lengths, channel names, subscriber counts) may be stored for at
// most 30 days — then it must be refreshed or deleted, and stored data should match
// what YouTube shows now. This job re-fetches, channel by channel, everything we keep
// about a channel's videos once every REFRESH_DAYS, and writes it everywhere it's kept:
//   channelLibraryCache/{ch} (+ /videos/{v}) · users/*/children/*/whitelistedChannels/{ch}
//   users/*/children/*/videoVerdicts/{v} (every family, incl. channels they removed)
//   videoProfiles/{v} (title, channel name, made-for-kids) · channelCatalog/{ch} · channelChecks/{ch}
// A video that's gone (deleted, private, embedding turned off) is hidden for every child
// ("No longer available on YouTube") and marked `ytGone` in the cache.
//
// Cost: YouTube quota only — channels.list (1 unit) + videos.list per 50 videos (1 unit)
// per channel per ~25 days. 500 channels × ~3 units ≈ 1,500 units a month. No AI, no Supadata.
// Our own analysis (ratings, summaries, verdicts) isn't YouTube data and is kept.
// ─────────────────────────────────────────────────────────────

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { APP_CONFIG, YOUTUBE_API_KEY } from "./config";
import { getChannelDetails, getVideosBatch, type YouTubeVideoDetails } from "./youtube";

const REFRESH_DAYS = 25; // < 30, so a missed night or two still stays inside the limit
const TIME_BUDGET_MS = 7.5 * 60 * 1000; // the function has 9 minutes
const GONE_REASON = "No longer available on YouTube";

type Writes = Array<{ ref: DocumentReference; data: Record<string, unknown> }>;

async function commitAll(db: Firestore, writes: Writes): Promise<void> {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.update(w.ref, w.data);
    await batch.commit();
  }
}

const videoFields = (v: YouTubeVideoDetails) => ({
  title: v.title,
  thumbnail: v.thumbnail,
  publishedAt: Timestamp.fromDate(new Date(v.publishedAt)),
  durationSeconds: v.durationSeconds,
});

export async function refreshChannel(
  db: Firestore,
  channelId: string,
  apiKey: string,
  whitelistRefs: DocumentReference[]
): Promise<{ videos: number; gone: number } | null> {
  const now = Timestamp.now();
  const writes: Writes = [];

  // ── The channel ──
  const channel = await getChannelDetails(channelId, apiKey);
  const cacheRef = db.doc(`channelLibraryCache/${channelId}`);
  if (channel) {
    writes.push({
      ref: cacheRef,
      data: {
        "metadata.name": channel.name,
        "metadata.handle": channel.handle,
        "metadata.thumbnail": channel.thumbnail,
        "metadata.subscriberCount": channel.subscriberCount,
        "metadata.description": channel.description,
      },
    });
    for (const ref of whitelistRefs) writes.push({ ref, data: { name: channel.name, thumbnail: channel.thumbnail } });
    const [catalog, check] = await db.getAll(db.doc(`channelCatalog/${channelId}`), db.doc(`channelChecks/${channelId}`));
    if (catalog.exists) {
      writes.push({
        ref: catalog.ref,
        data: { name: channel.name, handle: channel.handle, thumbnail: channel.thumbnail, subscriberCount: channel.subscriberCount },
      });
    }
    if (check.exists) writes.push({ ref: check.ref, data: { name: channel.name } });
  }

  // ── Its videos: everything in the cache + every family's verdicts for it ──
  const [cached, verdicts] = await Promise.all([
    db.collection(`channelLibraryCache/${channelId}/videos`).select().get(),
    db.collectionGroup("videoVerdicts").where("channelId", "==", channelId).get(),
  ]);
  const ids = [...new Set([...cached.docs.map((d) => d.id), ...verdicts.docs.map((d) => d.id)])];
  const fresh = await getVideosBatch(ids, apiKey);
  if (!fresh) return null; // YouTube call failed — try again another night, change nothing
  const isGone = (id: string) => {
    const v = fresh.get(id);
    return !v || v.isPrivateOrRestricted;
  };

  for (const doc of cached.docs) {
    const v = fresh.get(doc.id);
    writes.push({ ref: doc.ref, data: isGone(doc.id) || !v ? { ytGone: true } : { ...videoFields(v), ytGone: false } });
  }
  for (const doc of verdicts.docs) {
    const v = fresh.get(doc.id);
    writes.push({
      ref: doc.ref,
      data:
        isGone(doc.id) || !v
          ? { approved: false, status: "hidden", reason: GONE_REASON, unavailable: true }
          : videoFields(v),
    });
  }

  // Shared profiles: refresh the YouTube fields they keep (title, channel name, made for kids)
  const profileRefs = ids.map((id) => db.doc(`videoProfiles/${id}`));
  for (let i = 0; i < profileRefs.length; i += 100) {
    const snaps = await db.getAll(...profileRefs.slice(i, i + 100));
    for (const snap of snaps) {
      const v = fresh.get(snap.id);
      if (!snap.exists || !v) continue;
      writes.push({ ref: snap.ref, data: { title: v.title, channelName: v.channelTitle, madeForKids: v.madeForKids } });
    }
  }

  // The catalog's sample videos
  const catalogSnap = await db.doc(`channelCatalog/${channelId}`).get();
  const catalogVideos = catalogSnap.data()?.videos as Array<{ videoId: string; title: string; thumbnail: string }> | undefined;
  if (catalogSnap.exists && Array.isArray(catalogVideos)) {
    writes.push({
      ref: catalogSnap.ref,
      data: {
        videos: catalogVideos
          .filter((cv) => !isGone(cv.videoId))
          .map((cv) => ({ ...cv, title: fresh.get(cv.videoId)!.title, thumbnail: fresh.get(cv.videoId)!.thumbnail })),
      },
    });
  }

  writes.push({ ref: cacheRef, data: { ytRefreshedAt: now, ...(channel ? {} : { ytChannelGone: true }) } });
  await commitAll(db, writes);
  return { videos: ids.length, gone: ids.filter(isGone).length };
}

export const refreshYouTubeData = onSchedule(
  {
    schedule: "30 4 * * *", // 4:30am UTC daily (after refreshChannelLibraries and reprofileOutdated)
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const started = Date.now();
    const apiKey = YOUTUBE_API_KEY.value();
    const cutoff = Date.now() - REFRESH_DAYS * 24 * 60 * 60 * 1000;

    // Channels due (never refreshed first, then the oldest)
    const channels = await db.collection("channelLibraryCache").select("ytRefreshedAt").get();
    const due = channels.docs
      .map((d) => ({ id: d.id, at: (d.get("ytRefreshedAt") as Timestamp | undefined)?.toMillis() ?? 0 }))
      .filter((c) => c.at < cutoff)
      .sort((a, b) => a.at - b.at);

    // Which children have each channel (to refresh their whitelist docs)
    const whitelists = await db.collectionGroup("whitelistedChannels").select().get();
    const byChannel = new Map<string, DocumentReference[]>();
    for (const d of whitelists.docs) byChannel.set(d.id, [...(byChannel.get(d.id) ?? []), d.ref]);

    let done = 0;
    let gone = 0;
    for (const c of due) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        const r = await refreshChannel(db, c.id, apiKey, byChannel.get(c.id) ?? []);
        if (!r) continue;
        done++;
        gone += r.gone;
        logger.info(`[refreshYouTubeData] ${c.id}: ${r.videos} videos refreshed, ${r.gone} gone`);
      } catch (err) {
        logger.error(`[refreshYouTubeData] ${c.id} failed:`, err);
      }
    }
    logger.info(
      `[refreshYouTubeData] ${done}/${due.length} due channels refreshed, ${gone} videos gone — ` +
        (done < due.length ? "the rest tomorrow" : "all up to date")
    );
  }
);
