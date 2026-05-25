// ─────────────────────────────────────────────────────────────
// Kideos for Parents — useAuth hook
//
// Subscribes to Firebase Auth state and syncs to Zustand store.
// Call this once at the root of the app.
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
import auth from "@react-native-firebase/auth";
import { useStore } from "../store/useStore";

/**
 * Subscribes to Firebase Auth state and syncs to the Zustand store.
 * Returns:
 *   undefined  — still waiting for the first auth callback (loading)
 *   null       — signed out
 *   User       — signed in
 */
export function useAuth() {
  const setUser = useStore((s) => s.setUser);
  const user = useStore((s) => s.user);

  useEffect(() => {
    const unsub = auth().onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser); // null when signed out
    });
    return unsub;
  }, [setUser]);

  return user;
}
