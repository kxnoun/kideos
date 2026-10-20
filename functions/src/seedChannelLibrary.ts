// ─────────────────────────────────────────────────────────────
// Kideos — channel functions (see docs/architecture.md → Flows)
//
// Flow when a parent adds a channel:
//   1. resolveAndAddChannel (callable) — channels.list (1 unit), creates the
//      whitelist doc with seedingStatus "pending", returns immediately
//   2. onChannelWhitelisted (trigger on that create) — seedVideoMetadata
//      (40 latest long videos + 10 latest Shorts, 2 units) + batchAnalyzeChannel
//      (5 videos at a time, analyzeAndTagVideo each) → seedingStatus "ready"
// Also here: onFiltersChanged (re-apply answers), refreshChannelLibraries
// (nightly new uploads + a one-time long-video top-up for channels added before
// Oct 20), loadMoreVideos + onMoreVideosRequested ("Load more videos": the next 50
// older long videos for one child), seedChannelLibrary (legacy callable, unused).
//
// Each video gets a shared content profile; each child gets their own verdict in
// users/{p}/children/{c}/videoVerdicts (the kid feed reads approved == true there).
// Children never trigger a YouTube API call. Everything is pre-computed.
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentWritten, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import { YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY } from "./config";
import { APP_CONFIG } from "./config";
import {
  getChannelDetails,
  getChannelVideos,
  getPlaylistPage,
  longVideosPlaylist,
  shortsPlaylist,
  verifyChannelHandles,
  type YouTubePlaylistItem,
} from "./youtube";
import {
  analyzeAndTagVideo,
  loadValueFiltersForChild,
  reapplyFiltersForChild,
  type AnalyzeAndTagParams,
} from "./analyzeVideo";
import { buildCatalogEntrySafe } from "./channelCatalog";
import type {
  SeedChannelRequest,
  ResolveChannelRequest,
  ResolveChannelResponse,
  WhitelistedChannel,
  ChannelMetadata,
  CachedVideo,
} from "./types";

// ── Seed video metadata into channelLibraryCache ───────────────
// Does NOT run analysis — that's done by batchAnalyzeChannel.
// A channel's newest 50 uploads are ~90% Shorts for most creators, so we seed its
// CHANNEL_SEED_LONG latest long videos + CHANNEL_SEED_SHORTS latest Shorts from YouTube's
// per-type playlists (2 units). If YouTube doesn't know those playlists, fall back to
// the 50 latest uploads. The long-videos page token is kept for "Load more videos".

type Db = FirebaseFirestore.Firestore;

async function writeStubs(
  db: Db,
  channelId: string,
  videos: YouTubePlaylistItem[],
  kind?: "long" | "short"
): Promise<void> {
  for (let i = 0; i < videos.length; i += 400) {
    const batch: WriteBatch = db.batch();
    for (const video of videos.slice(i, i + 400)) {
      const cachedVideo: CachedVideo = {
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail,
        publishedAt: Timestamp.fromDate(new Date(video.publishedAt)),
        durationSeconds: null,
        lastSeenAt: Timestamp.now(),
        ...(kind ? { kind } : {}),
        approved: null, // not yet analyzed
        analyzedAt: null, // not yet analyzed
      };
      batch.set(db.doc(`channelLibraryCache/${channelId}/videos/${video.videoId}`), cachedVideo, { merge: true });
    }
    await batch.commit();
  }
}

// Long videos + Shorts (or the mixed fallback). Returns the IDs to analyze.
export async function seedLongAndShorts(
  db: Db,
  channelId: string,
  uploadsPlaylistId: string,
  apiKey: string,
  opts: { long?: number; shorts?: number } = {}
): Promise<string[]> {
  const longN = opts.long ?? APP_CONFIG.CHANNEL_SEED_LONG;
  const shortsN = opts.shorts ?? APP_CONFIG.CHANNEL_SEED_SHORTS;
  const [long, shorts] = await Promise.all([
    getPlaylistPage(longVideosPlaylist(uploadsPlaylistId), apiKey, longN),
    shortsN ? getPlaylistPage(shortsPlaylist(uploadsPlaylistId), apiKey, shortsN) : Promise.resolve(null),
  ]);
  const cacheRef = db.doc(`channelLibraryCache/${channelId}`);

  if (!long.ok && !shorts?.ok) {
    logger.warn(`[seedVideoMetadata] No long/Shorts playlists for ${channelId} — using the mixed uploads list`);
    const videos = await getChannelVideos(
      uploadsPlaylistId,
      apiKey,
      APP_CONFIG.CHANNEL_SEED_MAX_VIDEOS,
      APP_CONFIG.CHANNEL_SEED_MAX_PAGES
    );
    await writeStubs(db, channelId, videos);
    return videos.map((v) => v.videoId);
  }

  await writeStubs(db, channelId, long.videos, "long");
  if (shorts?.ok) await writeStubs(db, channelId, shorts.videos, "short");
  await cacheRef.set(
    { longSeededAt: Timestamp.now(), longPageToken: long.nextPageToken ?? null, longExhausted: !long.nextPageToken },
    { merge: true }
  );
  logger.info(
    `[seedVideoMetadata] ${channelId}: ${long.videos.length} long videos + ${shorts?.videos.length ?? 0} Shorts`
  );
  return [...long.videos, ...(shorts?.videos ?? [])].map((v) => v.videoId);
}

async function seedVideoMetadata(channelId: string, uploadsPlaylistId: string, apiKey: string, db: Db): Promise<string[]> {
  return seedLongAndShorts(db, channelId, uploadsPlaylistId, apiKey);
}

// ── Batch analyze all videos in a channel ─────────────────────
// Runs in concurrent batches of 5 to respect API rate limits.
// Returns { approved, blocked } counts.

async function batchAnalyzeChannel({
  channelId,
  videoIds,
  parentId,
  childId,
  youtubeApiKey,
  supadataApiKey,
  openAiApiKey,
}: {
  channelId: string;
  videoIds: string[];
  parentId: string;
  childId: string;
  youtubeApiKey: string;
  supadataApiKey: string;
  openAiApiKey: string;
}): Promise<{ approved: number; blocked: number }> {

  // Load value filters and child info once — not per video
  const filters = await loadValueFiltersForChild(parentId, childId);

  const baseParams: Omit<AnalyzeAndTagParams, "videoId"> = {
    channelId,
    parentId,
    childId,
    filters,
    youtubeApiKey,
    supadataApiKey,
    openAiApiKey,
  };

  let approved = 0;
  let blocked = 0;

  // Process in concurrent batches of 5
  const CONCURRENT = 5;
  for (let i = 0; i < videoIds.length; i += CONCURRENT) {
    const batch = videoIds.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(
      batch.map((videoId) =>
        analyzeAndTagVideo({ ...baseParams, videoId })
      )
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        result.value.approved ? approved++ : blocked++;
      } else {
        logger.error("[batchAnalyzeChannel] Video analysis failed:", result.reason);
        blocked++;
      }
    }

    logger.info(
      `[batchAnalyzeChannel] Progress: ${Math.min(i + CONCURRENT, videoIds.length)}/${videoIds.length} videos analyzed`
    );
  }

  return { approved, blocked };
}

// ── onCall: seed a specific channel (called after whitelisting) ─

export const seedChannelLibrary = onCall(
  {
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540, // 9 min — may need to analyze 50 videos
    memory: "512MiB",
  },
  async (request): Promise<{ success: boolean; approved: number; blocked: number }> => {
    const { channelId, parentId, childId } = request.data as SeedChannelRequest;

    if (!channelId || !parentId || !childId) {
      throw new HttpsError("invalid-argument", "channelId, parentId, childId are required");
    }

    if (request.auth?.uid !== parentId) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const db = getFirestore();

    // Mark channel as seeding
    const channelRef = db.doc(
      `users/${parentId}/children/${childId}/whitelistedChannels/${channelId}`
    );
    await channelRef.set({ seedingStatus: "pending" }, { merge: true });

    try {
      // 1. Get channel details (channels.list — 1 unit)
      const channelDetails = await getChannelDetails(channelId, YOUTUBE_API_KEY.value());
      if (!channelDetails) {
        throw new Error(`Channel ${channelId} not found`);
      }

      // 2. Write channel metadata to global cache
      const channelMeta: ChannelMetadata = {
        channelId,
        name: channelDetails.name,
        handle: channelDetails.handle,
        thumbnail: channelDetails.thumbnail,
        subscriberCount: channelDetails.subscriberCount,
        description: channelDetails.description,
        lastRefreshed: Timestamp.now(),
      };
      await db
        .doc(`channelLibraryCache/${channelId}`)
        .set({ metadata: channelMeta }, { merge: true });

      // 3. Seed video metadata (playlistItems.list — 1-5 units)
      const videoIds = await seedVideoMetadata(
        channelId,
        channelDetails.uploadsPlaylistId,
        YOUTUBE_API_KEY.value(),
        db
      );

      // 4. Batch analyze every video
      const { approved, blocked } = await batchAnalyzeChannel({
        channelId,
        videoIds,
        parentId,
        childId,
        youtubeApiKey: YOUTUBE_API_KEY.value(),
        supadataApiKey: SUPADATA_API_KEY.value(),
        openAiApiKey: OPENAI_API_KEY.value(),
      });

      // 5. Mark channel as ready
      await channelRef.set(
        {
          seedingStatus: "ready",
          videoCount: approved, // count of approved videos shown to parent
        },
        { merge: true }
      );

      logger.info(
        `[seedChannelLibrary] Done: channel=${channelId} approved=${approved} blocked=${blocked}`
      );
      return { success: true, approved, blocked };
    } catch (err) {
      logger.error(`[seedChannelLibrary] Failed for ${channelId}:`, err);
      await channelRef.set({ seedingStatus: "error" }, { merge: true });
      throw new HttpsError("internal", "Failed to seed channel library");
    }
  }
);

// ── onCall: resolve handle/URL → whitelist + trigger seeding ───
// Called by parent app when adding a channel by URL or @handle.
// Uses channels.list (1 unit). NEVER calls search.list.

export const resolveAndAddChannel = onCall(
  {
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request): Promise<ResolveChannelResponse> => {
    const { input, parentId, childId } = request.data as ResolveChannelRequest;

    if (!input || !parentId || !childId) {
      throw new HttpsError("invalid-argument", "input, parentId, childId are required");
    }

    if (request.auth?.uid !== parentId) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const db = getFirestore();

    // Resolve channel (channels.list — 1 unit)
    const details = await getChannelDetails(input, YOUTUBE_API_KEY.value());
    if (!details) {
      throw new HttpsError(
        "not-found",
        `Could not find a YouTube channel for: "${input}"`
      );
    }

    // Check if already whitelisted
    const whitelistRef = db.doc(
      `users/${parentId}/children/${childId}/whitelistedChannels/${details.channelId}`
    );
    const existing = await whitelistRef.get();

    if (existing.exists) {
      return {
        channelId: details.channelId,
        name: details.name,
        handle: details.handle,
        thumbnail: details.thumbnail,
        subscriberCount: details.subscriberCount,
        description: details.description,
        alreadyWhitelisted: true,
      };
    }

    // Write whitelist entry with seedingStatus: "pending"
    const whitelistEntry: WhitelistedChannel = {
      channelId: details.channelId,
      name: details.name,
      thumbnail: details.thumbnail,
      addedAt: Timestamp.now(),
      addedBy: "parent",
      seedingStatus: "pending",
      videoCount: 0,
    };
    await whitelistRef.set(whitelistEntry);

    // Seeding + analysis runs in onChannelWhitelisted (triggered by this create),
    // not here — work left running after an onCall returns gets throttled CPU.

    logger.info(
      `[resolveAndAddChannel] Added "${details.name}" (${details.channelId}) for parent ${parentId}`
    );

    return {
      channelId: details.channelId,
      name: details.name,
      handle: details.handle,
      thumbnail: details.thumbnail,
      subscriberCount: details.subscriberCount,
      description: details.description,
      alreadyWhitelisted: false,
    };
  }
);

// ── Firestore trigger: seed + analyze when a channel is whitelisted ─
// Runs as its own invocation so it gets full CPU and a 9-minute budget.

export const onChannelWhitelisted = onDocumentCreated(
  {
    document: "users/{parentId}/children/{childId}/whitelistedChannels/{channelId}",
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    const { parentId, childId, channelId } = event.params;
    // Firestore triggers are at-least-once: claim this event ID so a duplicate
    // delivery doesn't run the whole (paid) pipeline a second time.
    try {
      await getFirestore().doc(`triggerEvents/${event.id}`).create({ at: Timestamp.now() });
    } catch {
      logger.info(`[onChannelWhitelisted] Duplicate event ${event.id} — skipping`);
      return;
    }
    await seedAndAnalyzeInBackground(channelId, parentId, childId);
  }
);

// ── Firestore trigger: re-apply a child's filters when they change ─
// Profiles are reused, so this is fast and makes no Supadata / profile AI calls.

export const onFiltersChanged = onDocumentWritten(
  {
    document: "users/{parentId}/children/{childId}/valueFilters/current",
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    const { parentId, childId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || JSON.stringify(before) === JSON.stringify(after)) return;
    try {
      await getFirestore().doc(`triggerEvents/${event.id}`).create({ at: Timestamp.now() });
    } catch {
      logger.info(`[onFiltersChanged] Duplicate event ${event.id} — skipping`);
      return;
    }
    await reapplyFiltersForChild(parentId, childId, OPENAI_API_KEY.value());
  }
);

// ── Internal: seed + analyze (used by onChannelWhitelisted) ───

async function seedAndAnalyzeInBackground(
  channelId: string,
  parentId: string,
  childId: string
): Promise<void> {
  const db = getFirestore();
  const channelRef = db.doc(
    `users/${parentId}/children/${childId}/whitelistedChannels/${channelId}`
  );

  try {
    const channelDetails = await getChannelDetails(channelId, YOUTUBE_API_KEY.value());
    if (!channelDetails) throw new Error(`Channel ${channelId} not found`);

    const channelMeta: ChannelMetadata = {
      channelId,
      name: channelDetails.name,
      handle: channelDetails.handle,
      thumbnail: channelDetails.thumbnail,
      subscriberCount: channelDetails.subscriberCount,
      description: channelDetails.description,
      lastRefreshed: Timestamp.now(),
    };
    await db.doc(`channelLibraryCache/${channelId}`).set({ metadata: channelMeta }, { merge: true });

    const videoIds = await seedVideoMetadata(
      channelId,
      channelDetails.uploadsPlaylistId,
      YOUTUBE_API_KEY.value(),
      db
    );

    const { approved, blocked } = await batchAnalyzeChannel({
      channelId,
      videoIds,
      parentId,
      childId,
      youtubeApiKey: YOUTUBE_API_KEY.value(),
      supadataApiKey: SUPADATA_API_KEY.value(),
      openAiApiKey: OPENAI_API_KEY.value(),
    });

    await channelRef.set(
      { seedingStatus: "ready", videoCount: approved },
      { merge: true }
    );

    // Shared channel profile for suggestions (reuses the profiles just made)
    await buildCatalogEntrySafe(channelId, OPENAI_API_KEY.value());

    logger.info(
      `[seedAndAnalyzeInBackground] Done: ${channelId} approved=${approved} blocked=${blocked}`
    );
  } catch (err) {
    logger.error(`[seedAndAnalyzeInBackground] Failed for ${channelId}:`, err);
    await channelRef.set({ seedingStatus: "error" }, { merge: true });
  }
}

// ── "Load more videos" ──────────────────────────────────────────
// Parent taps "Load more videos" on a channel → loadMoreVideos (callable) marks the
// child's whitelist doc → onMoreVideosRequested (trigger, full CPU, 9 min) seeds the
// next LOAD_MORE_VIDEOS older long videos (continuing YouTube's page token) and
// analyzes them for that child. Paid per new video (Supadata + OpenAI), shared after.

export const loadMoreVideos = onCall(
  { region: APP_CONFIG.FUNCTIONS_REGION, timeoutSeconds: 30, memory: "256MiB" },
  async (request): Promise<{ queued: boolean; reason?: string }> => {
    const { parentId, childId, channelId } = request.data as { parentId?: string; childId?: string; channelId?: string };
    if (!parentId || !childId || !channelId) throw new HttpsError("invalid-argument", "parentId, childId, channelId are required");
    if (request.auth?.uid !== parentId) throw new HttpsError("permission-denied", "Not authorized");
    const db = getFirestore();
    const ref = db.doc(`users/${parentId}/children/${childId}/whitelistedChannels/${channelId}`);
    const wl = await ref.get();
    if (!wl.exists) throw new HttpsError("not-found", "That channel isn't on this child's list");
    if (wl.data()!.seedingStatus === "pending") return { queued: false, reason: "busy" };
    const cache = (await db.doc(`channelLibraryCache/${channelId}`).get()).data();
    if (cache?.longSeededAt && cache.longExhausted) return { queued: false, reason: "no_more" };
    await ref.set({ seedingStatus: "pending", moreRequestedAt: Timestamp.now() }, { merge: true });
    return { queued: true };
  }
);

export const onMoreVideosRequested = onDocumentUpdated(
  {
    document: "users/{parentId}/children/{childId}/whitelistedChannels/{channelId}",
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after?.moreRequestedAt || before?.moreRequestedAt?.isEqual?.(after.moreRequestedAt)) return;
    try {
      await getFirestore().doc(`triggerEvents/${event.id}`).create({ at: Timestamp.now() });
    } catch {
      return; // duplicate delivery
    }
    const { parentId, childId, channelId } = event.params;
    const db = getFirestore();
    const ref = event.data!.after.ref;
    try {
      const details = await getChannelDetails(channelId, YOUTUBE_API_KEY.value());
      if (!details) throw new Error(`Channel ${channelId} not found`);
      const cacheRef = db.doc(`channelLibraryCache/${channelId}`);
      const cache = (await cacheRef.get()).data() ?? {};
      const existing = new Set((await db.collection(`channelLibraryCache/${channelId}/videos`).select().get()).docs.map((d) => d.id));

      // Continue after the long videos we already have; channels seeded before this
      // feature start from the newest long videos (skipping ones we already have)
      const page = await getPlaylistPage(
        longVideosPlaylist(details.uploadsPlaylistId),
        YOUTUBE_API_KEY.value(),
        APP_CONFIG.LOAD_MORE_VIDEOS,
        cache.longSeededAt ? cache.longPageToken ?? undefined : undefined
      );
      const fresh = page.videos.filter((v) => !existing.has(v.videoId));
      await writeStubs(db, channelId, fresh, "long");
      await cacheRef.set(
        { longSeededAt: Timestamp.now(), longPageToken: page.nextPageToken ?? null, longExhausted: !page.nextPageToken },
        { merge: true }
      );
      const { approved } = fresh.length
        ? await batchAnalyzeChannel({
            channelId,
            videoIds: fresh.map((v) => v.videoId),
            parentId,
            childId,
            youtubeApiKey: YOUTUBE_API_KEY.value(),
            supadataApiKey: SUPADATA_API_KEY.value(),
            openAiApiKey: OPENAI_API_KEY.value(),
          })
        : { approved: 0 };
      await ref.set(
        { seedingStatus: "ready", videoCount: (Number(after.videoCount) || 0) + approved, moreAddedCount: approved },
        { merge: true }
      );
      // The suggestions catalog picks the latest long videos — refresh it with the new ones
      if (fresh.length) await buildCatalogEntrySafe(channelId, OPENAI_API_KEY.value());
      logger.info(`[onMoreVideosRequested] ${channelId} for ${parentId}/${childId}: ${fresh.length} more long videos, ${approved} fit`);
    } catch (err) {
      logger.error(`[onMoreVideosRequested] Failed for ${channelId}:`, err);
      await ref.set({ seedingStatus: "ready" }, { merge: true });
    }
  }
);

// ── Scheduled: nightly channel library refresh ─────────────────
// Runs every night at 3am UTC.
// Detects NEW videos from whitelisted channels (not yet in Firestore).
// Analyzes only new videos — existing analyzed videos are untouched.
// Channels are processed back to back (YouTube cost ~2 units per channel).

export const refreshChannelLibraries = onSchedule(
  {
    schedule: "0 3 * * *", // 3am UTC daily
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const started = Date.now();
    const TOPUPS_PER_NIGHT = 2;
    let topUps = 0;
    logger.info("[refreshChannelLibraries] Starting nightly refresh");

    // Get all unique whitelisted channel IDs across all parents/children
    // via collectionGroup query on whitelistedChannels
    const whitelistSnap = await db.collectionGroup("whitelistedChannels").get();

    // Build map: channelId → Set of { parentId, childId } pairs
    const channelParents = new Map<string, Array<{ parentId: string; childId: string }>>();

    for (const doc of whitelistSnap.docs) {
      // Path: users/{parentId}/children/{childId}/whitelistedChannels/{channelId}
      const pathParts = doc.ref.path.split("/");
      const parentId = pathParts[1];
      const childId = pathParts[3];
      const channelId = pathParts[5];

      if (!channelParents.has(channelId)) {
        channelParents.set(channelId, []);
      }
      channelParents.get(channelId)!.push({ parentId, childId });
    }

    logger.info(`[refreshChannelLibraries] Refreshing ${channelParents.size} unique channels`);

    let successCount = 0;
    let failCount = 0;

    for (const [channelId, parents] of channelParents.entries()) {
      try {
        // Get existing video IDs in Firestore for this channel
        const existingSnap = await db
          .collection(`channelLibraryCache/${channelId}/videos`)
          .select() // only need IDs, not full docs
          .get();
        const existingVideoIds = new Set(existingSnap.docs.map((d) => d.id));

        // Fetch current videos from YouTube (playlistItems.list — 1-5 units)
        const channelDetails = await getChannelDetails(channelId, YOUTUBE_API_KEY.value());
        if (!channelDetails) {
          logger.warn(`[refreshChannelLibraries] Channel ${channelId} not found — skipping`);
          continue;
        }

        const currentVideos = await getChannelVideos(
          channelDetails.uploadsPlaylistId,
          YOUTUBE_API_KEY.value(),
          APP_CONFIG.CHANNEL_SEED_MAX_VIDEOS,
          APP_CONFIG.CHANNEL_SEED_MAX_PAGES
        );

        // Find only NEW videos (not yet in Firestore)
        const newVideos: YouTubePlaylistItem[] = currentVideos.filter((v) => !existingVideoIds.has(v.videoId));

        // One-time top-up for channels added before Oct 20 (their 50 videos were
        // mostly Shorts): add their latest long videos too. At most TOPUPS_PER_NIGHT
        // channels a night, early in the run; the flag is set only after analysis, so a
        // run that times out just redoes it next night (profiles already made are reused).
        let topUpDone: (() => Promise<void>) | null = null;
        const cacheDoc = (await db.doc(`channelLibraryCache/${channelId}`).get()).data();
        if (!cacheDoc?.longSeededAt && topUps < TOPUPS_PER_NIGHT && Date.now() - started < 4 * 60 * 1000) {
          topUps++;
          const page = await getPlaylistPage(
            longVideosPlaylist(channelDetails.uploadsPlaylistId),
            YOUTUBE_API_KEY.value(),
            APP_CONFIG.CHANNEL_SEED_LONG
          );
          if (page.ok) {
            const seen = new Set(newVideos.map((v) => v.videoId));
            const topUp = page.videos.filter((v) => !seen.has(v.videoId));
            await writeStubs(db, channelId, topUp, "long");
            newVideos.push(...topUp);
            logger.info(`[refreshChannelLibraries] Long-video top-up for ${channelId}: ${topUp.length}`);
          }
          topUpDone = () =>
            db.doc(`channelLibraryCache/${channelId}`).set(
              {
                longSeededAt: Timestamp.now(),
                longPageToken: page.ok ? page.nextPageToken ?? null : null,
                longExhausted: page.ok ? !page.nextPageToken : true,
              },
              { merge: true }
            ).then(() => undefined);
        }

        if (newVideos.length === 0) {
          logger.info(`[refreshChannelLibraries] No new videos for channel ${channelId}`);
          if (topUpDone) await topUpDone();
          successCount++;
          continue;
        }

        logger.info(
          `[refreshChannelLibraries] ${newVideos.length} new videos in channel ${channelId}`
        );

        // Seed new video metadata stubs
        const batch: WriteBatch = db.batch();
        for (const video of newVideos) {
          const videoRef = db.doc(`channelLibraryCache/${channelId}/videos/${video.videoId}`);
          const cachedVideo: CachedVideo = {
            videoId: video.videoId,
            title: video.title,
            thumbnail: video.thumbnail,
            publishedAt: Timestamp.fromDate(new Date(video.publishedAt)),
            durationSeconds: null,
            lastSeenAt: Timestamp.now(),
            approved: null,
            analyzedAt: null,
          };
          batch.set(videoRef, cachedVideo, { merge: true });
        }
        await batch.commit();

        // Update channel metadata
        await db.doc(`channelLibraryCache/${channelId}`).set(
          { metadata: { lastRefreshed: Timestamp.now() } },
          { merge: true }
        );

        // Analyze new videos for EACH parent who has this channel whitelisted
        // (different parents may have different value filters)
        for (const { parentId, childId } of parents) {
          await batchAnalyzeChannel({
            channelId,
            videoIds: newVideos.map((v) => v.videoId),
            parentId,
            childId,
            youtubeApiKey: YOUTUBE_API_KEY.value(),
            supadataApiKey: SUPADATA_API_KEY.value(),
            openAiApiKey: OPENAI_API_KEY.value(),
          });
        }
        await buildCatalogEntrySafe(channelId, OPENAI_API_KEY.value());
        if (topUpDone) await topUpDone();

        successCount++;
        // (No stagger: sleeping between channels inside a 9-minute function made the
        // job time out after the first channel. Quota use is tiny — ~2 units/channel.)
      } catch (err) {
        failCount++;
        logger.error(`[refreshChannelLibraries] Failed for channel ${channelId}:`, err);
      }
    }

    logger.info(
      `[refreshChannelLibraries] Done: ${successCount} succeeded, ${failCount} failed`
    );
  }
);

// Re-export verifyChannelHandles for use in suggestChannels
export { verifyChannelHandles };
