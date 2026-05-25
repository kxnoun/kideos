// Kideos Kid App — Firebase service helpers

import firestore from "@react-native-firebase/firestore";
import type { WhitelistedChannel, ApprovedVideo, PlaySignal } from "../types";

// ── Get whitelisted channels for a child ──────────────────────

export function subscribeToWhitelistedChannels(
  parentId: string,
  childId: string,
  onUpdate: (channels: WhitelistedChannel[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children/${childId}/whitelistedChannels`)
    .where("seedingStatus", "==", "ready")
    .onSnapshot((snap) => {
      const channels: WhitelistedChannel[] = snap.docs.map((doc) => ({
        channelId: doc.id,
        ...doc.data(),
      })) as WhitelistedChannel[];
      onUpdate(channels);
    });
}

// ── Get approved videos for a list of channels ────────────────
// Returns a combined unsubscribe function for all listeners.

export function subscribeToApprovedVideos(
  channelIds: string[],
  onUpdate: (videos: ApprovedVideo[]) => void
): () => void {
  if (channelIds.length === 0) {
    onUpdate([]);
    return () => {};
  }

  // One listener per channel — Firestore can't query across collections
  const videosMap = new Map<string, ApprovedVideo[]>();
  const unsubscribers: Array<() => void> = [];

  const emitMerged = () => {
    const allVideos: ApprovedVideo[] = [];
    for (const vids of videosMap.values()) {
      allVideos.push(...vids);
    }
    // Sort newest first
    allVideos.sort(
      (a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis()
    );
    onUpdate(allVideos);
  };

  for (const channelId of channelIds) {
    const unsub = firestore()
      .collection(`channelLibraryCache/${channelId}/videos`)
      .where("approved", "==", true)
      .orderBy("publishedAt", "desc")
      .limit(30) // 30 videos per channel max in feed
      .onSnapshot((snap) => {
        const videos: ApprovedVideo[] = snap.docs
          .map((doc) => {
            const data = doc.data();
            return {
              videoId: doc.id,
              channelId,
              channelName: "", // enriched below
              title: data.title,
              thumbnail: data.thumbnail,
              publishedAt: data.publishedAt,
              durationSeconds: data.durationSeconds ?? null,
            } as ApprovedVideo;
          });
        videosMap.set(channelId, videos);
        emitMerged();
      });
    unsubscribers.push(unsub);
  }

  return () => unsubscribers.forEach((fn) => fn());
}

// ── Subscribe to parent's play signal (pause/stop/play) ───────

export function subscribeToPlaySignal(
  parentId: string,
  childId: string,
  onSignal: (signal: PlaySignal | null) => void
): () => void {
  return firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/playSignal`)
    .onSnapshot((snap) => {
      onSignal(snap.exists ? (snap.data() as PlaySignal) : null);
    });
}

// ── Write now-playing state so parent can see "Now Watching" ──

export async function writeNowPlaying(
  parentId: string,
  childId: string,
  videoId: string,
  title: string,
  channelName: string,
  thumbnail: string
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/nowPlaying`)
    .set({
      videoId,
      title,
      channelName,
      thumbnail,
      startedAt: firestore.FieldValue.serverTimestamp(),
    });
}

export async function clearNowPlaying(
  parentId: string,
  childId: string
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/nowPlaying`)
    .delete();
}

// ── Log a watch session start ─────────────────────────────────

export async function logWatchSessionStart(
  parentId: string,
  childId: string,
  videoId: string,
  title: string,
  channel: string,
  channelId: string
): Promise<string> {
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const ref = await firestore()
    .collection(`users/${parentId}/children/${childId}/watchHistory`)
    .add({
      videoId,
      title,
      channel,
      channelId,
      startedAt: firestore.FieldValue.serverTimestamp(),
      endedAt: null,
      durationSeconds: null,
      expiresAt: firestore.Timestamp.fromDate(new Date(Date.now() + ninetyDaysMs)),
    });
  return ref.id;
}

export async function logWatchSessionEnd(
  parentId: string,
  childId: string,
  sessionId: string,
  durationSeconds: number
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/watchHistory/${sessionId}`)
    .update({
      endedAt: firestore.FieldValue.serverTimestamp(),
      durationSeconds,
    });
}
