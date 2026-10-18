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
    }, (err) => console.warn("[whitelistedChannels] listener error:", err));
}

// ── Get this child's approved videos ──────────────────────────
// Verdicts are per child (users/{p}/children/{c}/videoVerdicts), computed by the
// backend from each video's content profile + this child's filters.
// Only videos from currently whitelisted channels are shown.

export function subscribeToApprovedVideos(
  parentId: string,
  childId: string,
  channelIds: string[],
  onUpdate: (videos: ApprovedVideo[]) => void
): () => void {
  if (channelIds.length === 0) {
    onUpdate([]);
    return () => {};
  }
  const allowed = new Set(channelIds);

  return firestore()
    .collection(`users/${parentId}/children/${childId}/videoVerdicts`)
    .where("approved", "==", true)
    .orderBy("publishedAt", "desc")
    .limit(500)
    .onSnapshot((snap) => {
      const videos: ApprovedVideo[] = snap.docs
        .map((doc) => doc.data())
        .filter((data) => allowed.has(data.channelId))
        .map((data) => ({
          videoId: data.videoId,
          channelId: data.channelId,
          channelName: "", // filled in by FeedScreen from whitelist names
          title: data.title,
          thumbnail: data.thumbnail,
          publishedAt: data.publishedAt,
          durationSeconds: data.durationSeconds ?? null,
        }));
      onUpdate(videos);
    }, (err) => console.warn("[videoVerdicts] listener error:", err));
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
      onSignal(snap.exists() ? (snap.data() as PlaySignal) : null);
    }, (err) => console.warn("[playSignal] listener error:", err));
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
      paused: false,
      startedAt: firestore.FieldValue.serverTimestamp(),
    });
}

// So the parent app can show "Now watching" vs "Paused"
export async function setNowPlayingPaused(parentId: string, childId: string, paused: boolean): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/nowPlaying`)
    .update({ paused })
    .catch(() => {}); // the doc may already be gone (video closed)
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
