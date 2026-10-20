// ─────────────────────────────────────────────────────────────
// Kideos Kid App — Root component
//
// Simple state machine:
//   unpaired → PairingScreen
//   paired, no video → FeedScreen
//   paired, video selected → PlayerScreen
//   parent pressed End Session → "Time's up" over everything, until the parent
//   lets them watch again (the last playSignal is "stop"; survives restarts)
//   "stay at least N / the whole video" + a video still owed → it reopens (also after a restart)
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Text, ActivityIndicator, StyleSheet, SafeAreaView } from "react-native";
import auth from "@react-native-firebase/auth";

import { useSession } from "./src/hooks/useSession";
import PairingScreen from "./src/screens/PairingScreen";
import FeedScreen from "./src/screens/FeedScreen";
import PlayerScreen, { type ExitReason } from "./src/screens/PlayerScreen";
import { subscribeToPlaySignal, subscribeToViewingRules } from "./src/services/firebase";
import { NO_RULES, normalizeRules, getUnfinished, clearUnfinished, stillOwed, type Unfinished } from "./src/viewing";
import type { ApprovedVideo, ChildSession, ViewingRules } from "./src/types";

export default function App() {
  const { session, loading, saveSession } = useSession();
  const [currentVideo, setCurrentVideo] = useState<ApprovedVideo | null>(null);
  const [resume, setResume] = useState<Unfinished | null>(null); // where to pick an unfinished video up
  const [rules, setRules] = useState<ViewingRules>(NO_RULES);
  const [rulesLoaded, setRulesLoaded] = useState(false);

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

  // End Session from the parent app locks the whole app until they send "play"
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!authed || !session?.paired) return;
    return subscribeToPlaySignal(session.parentId, session.childId, (signal) => {
      const stop = signal?.action === "stop";
      setLocked(stop);
      if (stop) {
        // End Session wins over everything, including the minimum watch time
        setCurrentVideo(null);
        setResume(null);
        clearUnfinished();
      }
    });
  }, [authed, session?.paired, session?.parentId, session?.childId]);

  // The parent's viewing rules (minimum time on a video before switching)
  useEffect(() => {
    if (!authed || !session?.paired) return;
    return subscribeToViewingRules(session.parentId, session.childId, (raw) => {
      setRules(normalizeRules(raw));
      setRulesLoaded(true);
    });
  }, [authed, session?.paired, session?.parentId, session?.childId]);

  // After a restart: reopen a video that's still owed (once the rules are known)
  useEffect(() => {
    if (!rulesLoaded) return;
    getUnfinished().then((u) => {
      if (u && stillOwed(u, rules)) {
        setResume(u);
        setCurrentVideo(u.video);
      } else if (u) {
        clearUnfinished();
      }
    });
    // only on start-up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesLoaded]);

  const handlePaired = useCallback(
    (newSession: ChildSession) => {
      saveSession(newSession);
    },
    [saveSession]
  );

  const handleVideoPress = useCallback((video: ApprovedVideo) => {
    setResume(null);
    setCurrentVideo(video);
  }, []);

  // Leaving a video (watched, allowed to leave, hidden by a parent, or won't play)
  const handleBack = useCallback((_reason: ExitReason = "done") => {
    setCurrentVideo(null);
    setResume(null);
    clearUnfinished();
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

  if (locked) {
    return (
      <SafeAreaView style={styles.timeUp}>
        <Text style={styles.timeUpEmoji}>🌙</Text>
        <Text style={styles.timeUpTitle}>Time's up for now!</Text>
        <Text style={styles.timeUpText}>A parent has ended your session. See you next time!</Text>
      </SafeAreaView>
    );
  }

  if (currentVideo) {
    return (
      <SafeAreaProvider>
        <PlayerScreen
          key={currentVideo.videoId}
          video={currentVideo}
          session={session}
          minWatchSeconds={rules.minWatchSeconds}
          resume={resume && resume.video.videoId === currentVideo.videoId ? resume : null}
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
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  timeUp: { flex: 1, backgroundColor: "#1A1A2E", alignItems: "center", justifyContent: "center", padding: 40 },
  timeUpEmoji: { fontSize: 80, marginBottom: 24 },
  timeUpTitle: { fontSize: 28, fontWeight: "800", color: "#fff", textAlign: "center", marginBottom: 12 },
  timeUpText: { fontSize: 17, color: "rgba(255,255,255,0.7)", textAlign: "center", lineHeight: 26 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F7FF",
  },
});
