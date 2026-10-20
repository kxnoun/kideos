// ─────────────────────────────────────────────────────────────
// Kideos — YouTube Data API v3 helpers
// QUOTA RULES (enforced here):
//   - search.list is NEVER called (100 units — banned)
//   - videos.list: 1 unit — cache misses only
//   - channels.list: 1 unit — channel lookups + verification
//   - playlistItems.list: 1–5 units — channel library seeding
// ─────────────────────────────────────────────────────────────

import { APP_CONFIG } from "./config";
import { logger } from "firebase-functions/v2";

// ── Raw API response types ─────────────────────────────────────

interface YouTubeVideoSnippet {
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  tags?: string[];
  categoryId?: string;
  publishedAt: string;
  thumbnails: { default?: { url: string }; medium?: { url: string }; high?: { url: string } };
}

interface YouTubeVideoContentDetails {
  duration: string; // ISO 8601 e.g. "PT4M13S"
}

interface YouTubeVideoStatus {
  madeForKids: boolean;
  privacyStatus: "public" | "private" | "unlisted";
  embeddable?: boolean; // false = the owner blocks playback in other apps/sites (common for label music videos)
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  tags: string[];
  categoryId: string;
  publishedAt: string;
  thumbnail: string;
  durationSeconds: number;
  madeForKids: boolean;
  isPrivateOrRestricted: boolean;
}

interface YouTubeChannelSnippet {
  title: string;
  description: string;
  customUrl?: string; // handle without @
  thumbnails: { default?: { url: string }; medium?: { url: string }; high?: { url: string } };
}

interface YouTubeChannelStatistics {
  subscriberCount?: string;
  videoCount?: string;
  hiddenSubscriberCount: boolean;
}

export interface YouTubeChannelDetails {
  channelId: string;
  name: string;
  handle: string;
  thumbnail: string;
  subscriberCount: number;
  description: string;
  uploadsPlaylistId: string;
}

export interface YouTubePlaylistItem {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

// ── ISO 8601 duration parser ───────────────────────────────────

function parseDurationSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// ── Normalize channel input to a lookup parameter ─────────────
// Accepts: full URL, @handle, bare handle, or raw channel ID

export function parseChannelInput(input: string): {
  type: "id" | "handle" | "forHandle" | "forUsername";
  value: string;
} {
  const trimmed = input.trim();

  // Full URL — extract the meaningful part
  const urlMatch = trimmed.match(
    /youtube\.com\/(?:channel\/(UC[\w-]+)|@([\w.-]+)|c\/([\w-]+)|user\/([\w-]+))/
  );
  if (urlMatch) {
    if (urlMatch[1]) return { type: "id", value: urlMatch[1] };
    if (urlMatch[2]) return { type: "handle", value: `@${urlMatch[2]}` };
    if (urlMatch[3]) return { type: "forUsername", value: urlMatch[3] };
    if (urlMatch[4]) return { type: "forUsername", value: urlMatch[4] };
  }

  // @handle
  if (trimmed.startsWith("@")) return { type: "handle", value: trimmed };

  // Raw channel ID (starts with UC, 24 chars)
  if (/^UC[\w-]{22}$/.test(trimmed)) return { type: "id", value: trimmed };

  // Fallback: treat as forHandle (without @)
  return { type: "handle", value: `@${trimmed}` };
}

// ── videos.list — 1 unit per call ─────────────────────────────

export async function getVideoDetails(
  videoId: string,
  apiKey: string
): Promise<YouTubeVideoDetails | null> {
  logger.info(`[YouTube] videos.list for ${videoId} (1 unit)`);

  const url = new URL(`${APP_CONFIG.YOUTUBE_BASE_URL}/videos`);
  url.searchParams.set("part", "snippet,contentDetails,status");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    logger.error(`[YouTube] videos.list failed: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json() as { items?: Array<{ snippet: YouTubeVideoSnippet; contentDetails: YouTubeVideoContentDetails; status: YouTubeVideoStatus }> };
  const item = data.items?.[0];
  if (!item) return null;

  const snippet: YouTubeVideoSnippet = item.snippet;
  const contentDetails: YouTubeVideoContentDetails = item.contentDetails;
  const status: YouTubeVideoStatus = item.status;

  // Auto-block private/unlisted/age-restricted, and videos whose owner disabled
  // embedding (they'd only show "Video unavailable" in the kid player)
  const isPrivateOrRestricted = status.privacyStatus !== "public" || status.embeddable === false;

  return {
    videoId,
    title: snippet.title,
    description: snippet.description,
    channelId: snippet.channelId,
    channelTitle: snippet.channelTitle,
    tags: snippet.tags ?? [],
    categoryId: snippet.categoryId ?? "",
    publishedAt: snippet.publishedAt,
    thumbnail:
      snippet.thumbnails.high?.url ??
      snippet.thumbnails.medium?.url ??
      snippet.thumbnails.default?.url ??
      "",
    durationSeconds: parseDurationSeconds(contentDetails.duration),
    madeForKids: status.madeForKids ?? false,
    isPrivateOrRestricted,
  };
}

// ── videos.list for up to 50 videos — still 1 unit per call ────
// Used by the 30-day refresh (refreshYouTubeData). Missing from the result = deleted,
// or not visible to the API any more.

export async function getVideosBatch(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, YouTubeVideoDetails> | null> {
  const out = new Map<string, YouTubeVideoDetails>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const url = new URL(`${APP_CONFIG.YOUTUBE_BASE_URL}/videos`);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.error(`[YouTube] videos.list (batch of ${chunk.length}) failed: ${res.status} ${res.statusText}`);
      return null; // don't treat a failed call as "everything was deleted"
    }
    const data = (await res.json()) as {
      items?: Array<{ id: string; snippet: YouTubeVideoSnippet; contentDetails: YouTubeVideoContentDetails; status: YouTubeVideoStatus }>;
    };
    for (const item of data.items ?? []) {
      const { snippet, contentDetails, status } = item;
      out.set(item.id, {
        videoId: item.id,
        title: snippet.title,
        description: snippet.description,
        channelId: snippet.channelId,
        channelTitle: snippet.channelTitle,
        tags: snippet.tags ?? [],
        categoryId: snippet.categoryId ?? "",
        publishedAt: snippet.publishedAt,
        thumbnail:
          snippet.thumbnails.high?.url ?? snippet.thumbnails.medium?.url ?? snippet.thumbnails.default?.url ?? "",
        durationSeconds: parseDurationSeconds(contentDetails.duration),
        madeForKids: status.madeForKids ?? false,
        isPrivateOrRestricted: status.privacyStatus !== "public" || status.embeddable === false,
      });
    }
  }
  return out;
}

// ── Is it a Short? ─────────────────────────────────────────────
// The Data API doesn't say. youtube.com/shorts/{id} answers 200 for a Short and
// redirects to the normal watch page otherwise. Only videos ≤ 3 min can be Shorts.
// If YouTube doesn't answer clearly: ≤ 60s or "#shorts" in the title/description.
export async function checkIsShort(video: YouTubeVideoDetails): Promise<boolean> {
  if (video.durationSeconds > 180) return false;
  const guess = video.durationSeconds <= 60 || /#shorts?\b/i.test(`${video.title} ${video.description}`);
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${video.videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 200) return true;
    if (res.status >= 300 && res.status < 400) return false;
    return guess;
  } catch {
    return guess;
  }
}

// ── channels.list — 1 unit per call ───────────────────────────

export async function getChannelDetails(
  input: string,
  apiKey: string
): Promise<YouTubeChannelDetails | null> {
  logger.info(`[YouTube] channels.list for "${input}" (1 unit)`);

  const parsed = parseChannelInput(input);
  const url = new URL(`${APP_CONFIG.YOUTUBE_BASE_URL}/channels`);
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("key", apiKey);

  switch (parsed.type) {
    case "id":
      url.searchParams.set("id", parsed.value);
      break;
    case "handle":
      // YouTube API accepts @handle via forHandle param
      url.searchParams.set("forHandle", parsed.value);
      break;
    case "forHandle":
      url.searchParams.set("forHandle", parsed.value);
      break;
    case "forUsername":
      url.searchParams.set("forUsername", parsed.value);
      break;
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    logger.error(`[YouTube] channels.list failed: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json() as { items?: Array<{ id: string; snippet: YouTubeChannelSnippet; statistics: YouTubeChannelStatistics; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
  const item = data.items?.[0];
  if (!item) return null;

  const snippet: YouTubeChannelSnippet = item.snippet;
  const stats: YouTubeChannelStatistics = item.statistics;
  const uploadsPlaylistId: string =
    item.contentDetails?.relatedPlaylists?.uploads ?? "";

  return {
    channelId: item.id,
    name: snippet.title,
    handle: snippet.customUrl ? `@${snippet.customUrl}` : "",
    thumbnail:
      snippet.thumbnails.high?.url ??
      snippet.thumbnails.medium?.url ??
      snippet.thumbnails.default?.url ??
      "",
    subscriberCount: stats.hiddenSubscriberCount
      ? 0
      : parseInt(stats.subscriberCount ?? "0", 10),
    description: snippet.description,
    uploadsPlaylistId,
  };
}

// ── channels.list — batch verification (for AI suggestions) ───
// Verifies multiple handles, returns only those that exist.
// 1 unit per channel — used instead of search.list (100 units).

export async function verifyChannelHandles(
  handles: string[],
  apiKey: string
): Promise<YouTubeChannelDetails[]> {
  // YouTube channels.list accepts up to 50 IDs at once but handles must be
  // queried one at a time (forHandle param is singular). Run in parallel.
  logger.info(`[YouTube] Verifying ${handles.length} channel handles (${handles.length} units)`);

  const results = await Promise.allSettled(
    handles.map((h) => getChannelDetails(h, apiKey))
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<YouTubeChannelDetails> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}

// ── playlistItems.list — 1 unit per page ──────────────────────
// Pulls up to CHANNEL_SEED_MAX_VIDEOS videos from a channel's
// uploads playlist. Max CHANNEL_SEED_MAX_PAGES pages (max 5 units).

export async function getChannelVideos(
  uploadsPlaylistId: string,
  apiKey: string,
  maxVideos: number = APP_CONFIG.CHANNEL_SEED_MAX_VIDEOS,
  maxPages: number = APP_CONFIG.CHANNEL_SEED_MAX_PAGES
): Promise<YouTubePlaylistItem[]> {
  logger.info(`[YouTube] playlistItems.list for playlist ${uploadsPlaylistId}`);

  const videos: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  let pagesConsumed = 0;

  while (videos.length < maxVideos && pagesConsumed < maxPages) {
    const url = new URL(`${APP_CONFIG.YOUTUBE_BASE_URL}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.error(`[YouTube] playlistItems.list failed: ${res.status}`);
      break;
    }

    const data = await res.json() as { items?: Array<{ snippet: { title: string; resourceId?: { videoId?: string }; thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } }; publishedAt: string } }>; nextPageToken?: string };
    pagesConsumed++;
    logger.info(`[YouTube] playlistItems.list page ${pagesConsumed} (1 unit)`);

    for (const item of data.items ?? []) {
      const snippet = item.snippet;
      // Skip deleted/private videos (resourceId will have kind but no videoId)
      const videoId = snippet?.resourceId?.videoId;
      if (!videoId) continue;
      // Skip "Private video" placeholders
      if (snippet.title === "Private video" || snippet.title === "Deleted video") continue;

      videos.push({
        videoId,
        title: snippet.title,
        thumbnail:
          snippet.thumbnails?.high?.url ??
          snippet.thumbnails?.medium?.url ??
          snippet.thumbnails?.default?.url ??
          "",
        publishedAt: snippet.publishedAt,
      });

      if (videos.length >= maxVideos) break;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  logger.info(
    `[YouTube] Seeded ${videos.length} videos using ${pagesConsumed} playlistItems.list units`
  );
  return videos;
}

// ── One page of a playlist (playlistItems.list — 1 unit) ──────
// Channels have undocumented sibling playlists of their uploads playlist ("UU…"):
// "UULF…" = long videos only, "UUSH…" = Shorts only. ok = false if YouTube doesn't
// know the playlist (caller falls back to the full uploads list).
export function longVideosPlaylist(uploadsPlaylistId: string): string {
  return `UULF${uploadsPlaylistId.slice(2)}`;
}
export function shortsPlaylist(uploadsPlaylistId: string): string {
  return `UUSH${uploadsPlaylistId.slice(2)}`;
}

export async function getPlaylistPage(
  playlistId: string,
  apiKey: string,
  maxResults: number,
  pageToken?: string
): Promise<{ ok: boolean; videos: YouTubePlaylistItem[]; nextPageToken: string | null }> {
  const url = new URL(`${APP_CONFIG.YOUTUBE_BASE_URL}/playlistItems`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", String(Math.min(50, maxResults)));
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url.toString());
  logger.info(`[YouTube] playlistItems.list ${playlistId} (1 unit) → ${res.status}`);
  if (!res.ok) return { ok: false, videos: [], nextPageToken: null };
  const data = (await res.json()) as {
    items?: Array<{ snippet: { title: string; resourceId?: { videoId?: string }; thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } }; publishedAt: string } }>;
    nextPageToken?: string;
  };
  const videos: YouTubePlaylistItem[] = [];
  for (const item of data.items ?? []) {
    const sn = item.snippet;
    const videoId = sn?.resourceId?.videoId;
    if (!videoId || sn.title === "Private video" || sn.title === "Deleted video") continue;
    videos.push({
      videoId,
      title: sn.title,
      thumbnail: sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? "",
      publishedAt: sn.publishedAt,
    });
  }
  return { ok: true, videos: videos.slice(0, maxResults), nextPageToken: data.nextPageToken ?? null };
}
