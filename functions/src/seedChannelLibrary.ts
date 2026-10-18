// ─────────────────────────────────────────────────────────────
// Kideos — channel functions (see docs/architecture.md → Flows)
//
// Flow when a parent adds a channel:
//   1. resolveAndAddChannel (callable) — channels.list (1 unit), creates the
//      whitelist doc with seedingStatus "pending", returns immediately
//   2. onChannelWhitelisted (trigger on that create) — seedVideoMetadata
//      (playlistItems.list, 1-5 units) + batchAnalyzeChannel (5 videos at a time,
//      analyzeAndTagVideo each) → seedingStatus "ready"
// Also here: onFiltersChanged (re-apply answers), refreshChannelLibraries
// (nightly new uploads), seedChannelLibrary (legacy callable, unused by the app).
//
// Each video gets a shared content profile; each child gets their own verdict in
// users/{p}/children/{c}/videoVerdicts (the kid feed reads approved == true there).
// Children never trigger a YouTube API call. Everything is pre-computed.
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import { YOUTUBE_API_KEY, SUPADATA_API_KEY, OPENAI_API_KEY } from "./config";
import { APP_CONFIG } from "./config";
import { getChannelDetails, getChannelVideos, verifyChannelHandles } from "./youtube";
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

async function seedVideoMetadata(
  channelId: string,
  uploadsPlaylistId: string,
  apiKey: string,
  db: FirebaseFirestore.Firestore
): Promise<string[]> {
  const videos = await getChannelVideos(
    uploadsPlaylistId,
    apiKey,
    APP_CONFIG.CHANNEL_SEED_MAX_VIDEOS,
    APP_CONFIG.CHANNEL_SEED_MAX_PAGES
  );

  // Write video metadata in batches of 400 (Firestore batch limit is 500)
  const BATCH_SIZE = 400;
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch: WriteBatch = db.batch();
    const chunk = videos.slice(i, i + BATCH_SIZE);

    for (const video of chunk) {
      const videoRef = db.doc(`channelLibraryCache/${channelId}/videos/${video.videoId}`);
      const cachedVideo: CachedVideo = {
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail,
        publishedAt: Timestamp.fromDate(new Date(video.publishedAt)),
        durationSeconds: null,
        lastSeenAt: Timestamp.now(),
        approved: null,    // not yet analyzed
        analyzedAt: null,  // not yet analyzed
      };
      batch.set(videoRef, cachedVideo, { merge: true });
    }

    await batch.commit();
  }

  logger.info(`[seedVideoMetadata] Seeded ${videos.length} video stubs for channel ${channelId}`);
  return videos.map((v) => v.videoId);
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
        const newVideos = currentVideos.filter((v) => !existingVideoIds.has(v.videoId));

        if (newVideos.length === 0) {
          logger.info(`[refreshChannelLibraries] No new videos for channel ${channelId}`);
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
