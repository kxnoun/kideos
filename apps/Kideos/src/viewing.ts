// ─────────────────────────────────────────────────────────────
// Kideos Kid App — viewing rules (cooldowns), set per child by the parent
//
// Stored on the child doc (users/{p}/children/{c}.viewing), which a paired kid
// device can read. Kept on this device (AsyncStorage) so they survive the app
// being closed:
//   - breakUntil: when the current break ends (ms)
//   - unfinished: the video the kid must finish, and where they were
// ─────────────────────────────────────────────────────────────

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApprovedVideo, ViewingRules } from "./types";

export const NO_RULES: ViewingRules = { breakSeconds: 0, mustFinish: false };
export const FINISHED_SHARE = 0.9; // this much of the video actually played = finished

const BREAK_KEY = "@kideos_break_until";
const UNFINISHED_KEY = "@kideos_unfinished";

export interface Unfinished {
  video: ApprovedVideo;
  position: number; // seconds into the video
  played: number; // seconds actually played
}

export function normalizeRules(raw: unknown): ViewingRules {
  const r = (raw ?? {}) as Partial<ViewingRules>;
  const breakSeconds = [0, 30, 60, 120].includes(Number(r.breakSeconds)) ? Number(r.breakSeconds) : 0;
  return { breakSeconds, mustFinish: Boolean(r.mustFinish) };
}

export async function getBreakUntil(): Promise<number> {
  try {
    return Number(await AsyncStorage.getItem(BREAK_KEY)) || 0;
  } catch {
    return 0;
  }
}

export async function setBreakUntil(ms: number): Promise<void> {
  await AsyncStorage.setItem(BREAK_KEY, String(ms)).catch(() => {});
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
