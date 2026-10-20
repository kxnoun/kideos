// Kideos Kid App — Firebase service helpers

import firestore from "@react-native-firebase/firestore";
import type { WhitelistedChannel, ApprovedVideo, PlaySignal, KidDevice } from "../types";

const DEFAULT_ASK_WHO_MINUTES = 5;

// ── This device (users/{p}/kidDevices/{uid}): which children use it ──
// null = the doc is gone (unpaired by the parent) — only reported once the server
// confirms it, never from an empty local cache at start-up.

export function subscribeToKidDevice(
  parentId: string,
  deviceUid: string,
  onUpdate: (device: KidDevice | null) => void
): () => void {
  return firestore()
    .doc(`users/${parentId}/kidDevices/${deviceUid}`)
    .onSnapshot(
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          if (!snap.metadata.fromCache) onUpdate(null);
          return;
        }
        const data = snap.data() ?? {};
        onUpdate({
          childIds: Array.isArray(data.childIds) ? data.childIds.filter((c: unknown) => typeof c === "string") : [],
          askWhoAfterMinutes:
            typeof data.askWhoAfterMinutes === "number" ? data.askWhoAfterMinutes : DEFAULT_ASK_WHO_MINUTES,
        });
      },
      (err) => console.warn("[kidDevice] listener error:", err)
    );
}

// ── Devices paired before Oct 20, 2026: ask once to be moved over ──
// onDeviceMigration (functions/src/kidDevices.ts) checks it and writes the kidDevices doc.

export async function requestDeviceMigration(deviceUid: string, parentId: string, childId: string): Promise<void> {
  const ref = firestore().doc(`deviceMigrations/${deviceUid}`);
  const existing = await ref.get().catch(() => null);
  if (existing?.exists()) return; // already asked
  await ref.set({ parentId, childId, createdAt: firestore.FieldValue.serverTimestamp() });
}

export function subscribeToMigration(
  deviceUid: string,
  onStatus: (status: "done" | "refused" | null) => void
): () => void {
  return firestore()
    .doc(`deviceMigrations/${deviceUid}`)
    .onSnapshot(
      (snap) => {
        const status = snap.exists() ? snap.data()?.status : null;
        onStatus(status === "done" || status === "refused" ? status : null);
      },
      (err) => console.warn("[deviceMigration] listener error:", err)
    );
}

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
          isShort: data.isShort === true,
        }));
      onUpdate(videos);
    }, (err) => console.warn("[videoVerdicts] listener error:", err));
}

// ── The child doc: name / age / avatar + viewing rules ───────
// A paired kid device may read it.

export function subscribeToChild(
  parentId: string,
  childId: string,
  onUpdate: (data: Record<string, unknown> | undefined) => void
): () => void {
  return firestore()
    .doc(`users/${parentId}/children/${childId}`)
    .onSnapshot(
      (snap) => onUpdate(snap.data()),
      (err) => console.warn("[child] listener error:", err)
    );
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

// Is this video still allowed for this child? (a parent can hide it while it plays)
export function subscribeToVideoAllowed(
  parentId: string,
  childId: string,
  videoId: string,
  onUpdate: (allowed: boolean) => void
): () => void {
  return firestore()
    .doc(`users/${parentId}/children/${childId}/videoVerdicts/${videoId}`)
    .onSnapshot(
      (snap) => {
        if (snap.exists()) onUpdate(snap.data()?.approved !== false);
      },
      (err) => console.warn("[videoAllowed] listener error:", err)
    );
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
