// Kideos Kid App — which videos this device has watched (for the ✓ sticker).
// Local only (AsyncStorage): watched = ~90% played or played to the end.

import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@kideos_watched";
const MAX = 500; // newest kept

let ids: string[] = [];
let snapshot = new Set<string>();
const listeners = new Set<() => void>();

function publish() {
  snapshot = new Set(ids);
  listeners.forEach((l) => l());
}

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) {
      ids = [...new Set([...ids, ...saved.filter((s) => typeof s === "string")])].slice(-MAX);
      publish();
    }
  })
  .catch(() => {});

export function markWatched(videoId: string): void {
  if (snapshot.has(videoId)) return;
  ids = [...ids, videoId].slice(-MAX);
  publish();
  AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
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
