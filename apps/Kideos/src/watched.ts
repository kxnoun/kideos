// Kideos Kid App — which videos each child has watched on this device (the ✓ sticker).
// Local only (AsyncStorage, one list per child): watched = ~90% played or played to the end.

import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (childId: string) => `@kideos_watched:${childId}`;
const LEGACY_KEY = "@kideos_watched"; // before Oct 20, 2026: one child per device
const MAX = 500; // newest kept

let childId: string | null = null;
let ids: string[] = [];
let snapshot = new Set<string>();
const listeners = new Set<() => void>();

function publish() {
  snapshot = new Set(ids);
  listeners.forEach((l) => l());
}

// Whose ✓s to show (the child who's watching now; null on "Who's watching?")
export function setWatchedChild(id: string | null): void {
  if (id === childId) return;
  childId = id;
  ids = [];
  publish();
  if (!id) return;
  AsyncStorage.getItem(key(id))
    .then((raw) => {
      if (!raw || childId !== id) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        ids = [...new Set([...saved.filter((s) => typeof s === "string"), ...ids])].slice(-MAX);
        publish();
      }
    })
    .catch(() => {});
}

// A device moved over from one-child pairing: its list belongs to that child
export async function adoptLegacyWatched(id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (raw && !(await AsyncStorage.getItem(key(id)))) await AsyncStorage.setItem(key(id), raw);
    await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {
    // not important
  }
}

export function markWatched(videoId: string): void {
  if (!childId || snapshot.has(videoId)) return;
  ids = [...ids, videoId].slice(-MAX);
  publish();
  AsyncStorage.setItem(key(childId), JSON.stringify(ids)).catch(() => {});
}

export function useWatched(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot
  );
}
