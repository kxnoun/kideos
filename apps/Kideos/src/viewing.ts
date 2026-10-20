// ─────────────────────────────────────────────────────────────
// Kideos Kid App — viewing rules, set per child by the parent
//
// "Before switching videos, stay at least": off / 30 s / 1 min / 2 min / the whole
// video. Stored on the child doc (users/{p}/children/{c}.viewing.minWatchSeconds;
// -1 = the whole video), which a paired kid device can read.
//   - Timed: counts from when the video first starts playing, wall-clock — pausing
//     counts, and so does time with the app closed.
//   - Whole video: ~90% actually played (pausing / seeking don't count).
// The video still being "owed" is kept on this device (AsyncStorage), so closing
// the app reopens it.
// ─────────────────────────────────────────────────────────────

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApprovedVideo, ViewingRules } from "./types";

export const WHOLE_VIDEO = -1;
export const NO_RULES: ViewingRules = { minWatchSeconds: 0 };
export const FINISHED_SHARE = 0.9; // "whole video": this much actually played = finished

const UNFINISHED_KEY = "@kideos_unfinished";

export interface Unfinished {
  video: ApprovedVideo;
  position: number; // seconds into the video
  played: number; // seconds actually played
  startedAt: number | null; // when it first started playing (ms)
}

export function normalizeRules(raw: unknown): ViewingRules {
  const r = (raw ?? {}) as { minWatchSeconds?: unknown; mustFinish?: unknown };
  const n = Number(r.minWatchSeconds);
  if ([0, 30, 60, 120, WHOLE_VIDEO].includes(n)) return { minWatchSeconds: n };
  return { minWatchSeconds: r.mustFinish ? WHOLE_VIDEO : 0 }; // first version of this setting
}

// Still has to stay on this video?
export function stillOwed(u: Unfinished, rules: ViewingRules, now = Date.now()): boolean {
  if (rules.minWatchSeconds === 0) return false;
  if (rules.minWatchSeconds === WHOLE_VIDEO) return true; // the player checks the exact amount
  return u.startedAt !== null && now - u.startedAt < rules.minWatchSeconds * 1000;
}

export async function getUnfinished(): Promise<Unfinished | null> {
  try {
    const raw = await AsyncStorage.getItem(UNFINISHED_KEY);
    return raw ? (JSON.parse(raw) as Unfinished) : null;
  } catch {
    return null;
  }
}

export async function saveUnfinished(u: Unfinished): Promise<void> {
  // Timestamp objects don't survive JSON; the player doesn't need publishedAt
  const video = { ...u.video, publishedAt: null as unknown as ApprovedVideo["publishedAt"] };
  await AsyncStorage.setItem(UNFINISHED_KEY, JSON.stringify({ ...u, video })).catch(() => {});
}

export async function clearUnfinished(): Promise<void> {
  await AsyncStorage.removeItem(UNFINISHED_KEY).catch(() => {});
}

export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
