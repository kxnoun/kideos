// Kideos Kid App — child session management
// Reads the paired session from AsyncStorage.

import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StoredSession } from "../types";

const SESSION_KEY = "@kideos_session";

export function useSession() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY).then((raw) => {
      if (raw) {
        try {
          setSession(JSON.parse(raw));
        } catch {
          setSession(null);
        }
      }
      setLoading(false);
    });
  }, []);

  const saveSession = useCallback(async (s: StoredSession) => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const clearSession = useCallback(async () => {
    await AsyncStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  return { session, loading, saveSession, clearSession };
}
