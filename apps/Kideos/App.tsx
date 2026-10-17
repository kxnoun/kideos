// ─────────────────────────────────────────────────────────────
// Kideos Kid App — Root component
//
// Simple state machine:
//   unpaired → PairingScreen
//   paired, no video → FeedScreen
//   paired, video selected → PlayerScreen
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import auth from "@react-native-firebase/auth";

import { useSession } from "./src/hooks/useSession";
import PairingScreen from "./src/screens/PairingScreen";
import FeedScreen from "./src/screens/FeedScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import type { ApprovedVideo, ChildSession } from "./src/types";

export default function App() {
  const { session, loading, saveSession } = useSession();
  const [currentVideo, setCurrentVideo] = useState<ApprovedVideo | null>(null);

  // Sign in anonymously so Firestore security rules allow reads/writes.
  // The anonymous UID is stable across restarts on the same device.
  // Wait for auth before rendering screens — their Firestore listeners
  // are denied (and never retry) if they start before sign-in finishes.
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    return auth().onAuthStateChanged((user) => {
      if (user) {
        setAuthed(true);
        return;
      }
      setAuthed(false);
      auth().signInAnonymously().catch((err) => {
        // Without auth, every Firestore read except pairing is denied
        console.warn("[auth] anonymous sign-in failed:", err);
      });
    });
  }, []);

  const handlePaired = useCallback(
    (newSession: ChildSession) => {
      saveSession(newSession);
    },
    [saveSession]
  );

  const handleVideoPress = useCallback((video: ApprovedVideo) => {
    setCurrentVideo(video);
  }, []);

  const handleBack = useCallback(() => {
    setCurrentVideo(null);
  }, []);

  const handleSessionEnded = useCallback(() => {
    setCurrentVideo(null);
  }, []);

  if (loading || !authed) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (!session?.paired) {
    return (
      <SafeAreaProvider>
        <PairingScreen onPaired={handlePaired} />
      </SafeAreaProvider>
    );
  }

  if (currentVideo) {
    return (
      <SafeAreaProvider>
        <PlayerScreen
          video={currentVideo}
          session={session}
          onBack={handleBack}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <FeedScreen
        session={session}
        onVideoPress={handleVideoPress}
        onPaused={() => {}}
        onSessionEnded={handleSessionEnded}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F7FF",
  },
});
