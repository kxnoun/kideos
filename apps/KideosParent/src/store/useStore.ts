// ─────────────────────────────────────────────────────────────
// Kideos for Parents — Zustand global store
// ─────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { FirebaseAuthTypes } from "@react-native-firebase/auth";
import type { ChildProfile } from "../types";

export interface ChildEntry {
  id: string;
  profile: ChildProfile;
}

interface AppState {
  // undefined = auth not yet initialized, null = signed out, User = signed in
  user: FirebaseAuthTypes.User | null | undefined;
  setUser: (user: FirebaseAuthTypes.User | null) => void;

  children: ChildEntry[];
  childrenLoaded: boolean; // true after first Firestore snapshot fires
  setChildren: (children: ChildEntry[]) => void;

  selectedChildId: string | null;
  setSelectedChildId: (id: string | null) => void;

  // Prevents mid-onboarding stack swaps when the first child is written to Firestore.
  // Starts as null (unknown), set to true/false once children load.
  // Cleared to false explicitly when the user finishes the AddChannels screen.
  inOnboarding: boolean | null;
  completeOnboarding: () => void;
}

export const useStore = create<AppState>((set) => ({
  user: undefined,
  setUser: (user) =>
    set(user === null
      ? { user, children: [], childrenLoaded: false, selectedChildId: null, inOnboarding: null }
      : { user }),

  children: [],
  childrenLoaded: false,
  setChildren: (children) =>
    set((state) => {
      const validId =
        state.selectedChildId &&
        children.some((c) => c.id === state.selectedChildId)
          ? state.selectedChildId
          : (children[0]?.id ?? null);

      // Only set inOnboarding on the first load.
      // After that, completeOnboarding() drives the transition.
      const inOnboarding =
        state.childrenLoaded
          ? state.inOnboarding                 // already decided — keep
          : children.length === 0;             // first load: onboard if no children

      return { children, childrenLoaded: true, selectedChildId: validId, inOnboarding };
    }),

  selectedChildId: null,
  setSelectedChildId: (id) => set({ selectedChildId: id }),

  inOnboarding: null,
  completeOnboarding: () => set({ inOnboarding: false }),
}));

// Convenience hook — derive selected child reactively
export function useSelectedChild(): ChildEntry | null {
  const children = useStore((s) => s.children);
  const selectedChildId = useStore((s) => s.selectedChildId);
  return children.find((c) => c.id === selectedChildId) ?? null;
}
