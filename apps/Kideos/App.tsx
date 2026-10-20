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
//
// The child doc is watched live: name, avatar and age (age picks the little/big
// layout, theme.ts) and the viewing rules.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { View, Text, ActivityIndicator, StyleSheet, StatusBar } from "react-native";
import auth from "@react-native-firebase/auth";

import { useSession } from "./src/hooks/useSession";
import PairingScreen from "./src/screens/PairingScreen";
import FeedScreen from "./src/screens/FeedScreen";
import PlayerScreen, { type ExitReason } from "./src/screens/PlayerScreen";
import { subscribeToPlaySignal, subscribeToChild } from "./src/services/firebase";
import { NO_RULES, normalizeRules, getUnfinished, clearUnfinished, stillOwed, type Unfinished } from "./src/viewing";
import { colors, fonts, modeForAge, radius, useLayout } from "./src/theme";
import { setLandscapeOnly } from "./src/device";
import { useWatched } from "./src/watched";
import type { ApprovedVideo, ChildSession, KidProfile, ViewingRules } from "./src/types";

const TAP_DEBOUNCE_MS = 600;

// Up next: older videos from the same list first (it's newest first), unwatched first
function pickNext(pool: ApprovedVideo[], video: ApprovedVideo, watched: Set<string>, n = 3): ApprovedVideo[] {
  const i = pool.findIndex((v) => v.videoId === video.videoId);
  const ordered = [...pool.slice(i + 1), ...pool.slice(0, Math.max(i, 0))].filter((v) => v.videoId !== video.videoId);
  return [...ordered.filter((v) => !watched.has(v.videoId)), ...ordered.filter((v) => watched.has(v.videoId))].slice(0, n);
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const { session, loading, saveSession } = useSession();
  const [currentVideo, setCurrentVideo] = useState<ApprovedVideo | null>(null);
  const [pool, setPool] = useState<ApprovedVideo[]>([]); // where "up next" comes from
  const [resume, setResume] = useState<Unfinished | null>(null); // where to pick an unfinished video up
  const [rules, setRules] = useState<ViewingRules>(NO_RULES);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [child, setChild] = useState<Partial<KidProfile>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const watched = useWatched();
  const lastTap = useRef(0);

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

  // The child doc: profile (name / avatar / age) + viewing rules (minimum time on a video)
  useEffect(() => {
    if (!authed || !session?.paired) return;
    return subscribeToChild(session.parentId, session.childId, (data) => {
      setRules(normalizeRules(data?.viewing));
      setRulesLoaded(true);
      setChild({
        name: typeof data?.name === "string" ? data.name : undefined,
        age: typeof data?.age === "number" ? data.age : undefined,
        avatar: typeof data?.avatar === "string" ? data.avatar : undefined,
      });
    });
  }, [authed, session?.paired, session?.parentId, session?.childId]);

  // After a restart: reopen a video that's still owed (once the rules are known)
  useEffect(() => {
    if (!rulesLoaded) return;
    getUnfinished().then((u) => {
      if (u && stillOwed(u, rules)) {
        setResume(u);
        setPool([]);
        setCurrentVideo(u.video);
      } else if (u) {
        clearUnfinished();
      }
    });
    // only on start-up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesLoaded]);

  // A friendly note on the feed (instead of a system pop-up)
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const handlePaired = useCallback(
    (newSession: ChildSession) => {
      saveSession(newSession);
    },
    [saveSession]
  );

  const handleVideoPress = useCallback((video: ApprovedVideo, fromPool: ApprovedVideo[]) => {
    const now = Date.now();
    if (now - lastTap.current < TAP_DEBOUNCE_MS) return; // excited double taps
    lastTap.current = now;
    setResume(null);
    setPool(fromPool);
    setCurrentVideo(video);
  }, []);

  // Picked from the end card / "More from" — same pool
  const handlePlayNext = useCallback((video: ApprovedVideo) => {
    setResume(null);
    clearUnfinished();
    setCurrentVideo(video);
  }, []);

  // Leaving a video (watched, allowed to leave, hidden by a parent, or won't play)
  const handleBack = useCallback((reason: ExitReason = "done") => {
    setCurrentVideo(null);
    setResume(null);
    clearUnfinished();
    if (reason === "removed") setNotice("A grown-up took that video away. Pick another one!");
    if (reason === "error") setNotice("That video can't play here. Pick another one!");
  }, []);

  const profile = useMemo<KidProfile>(
    () => ({
      name: child.name ?? session?.childName ?? "",
      age: child.age ?? session?.childAge ?? 8,
      avatar: child.avatar ?? "",
    }),
    [child, session?.childName, session?.childAge]
  );

  // Landscape only: young mode always (a portrait strip wastes most of the screen), and
  // everyone while a long video plays (full screen). Older kids rotate freely otherwise.
  const littleMode = Boolean(session?.paired) && modeForAge(profile.age) === "little";
  const longVideoOpen = Boolean(currentVideo && !currentVideo.isShort && !locked);
  useEffect(() => {
    setLandscapeOnly(littleMode || longVideoOpen);
  }, [littleMode, longVideoOpen]);

  const upNext = useMemo(
    () => (currentVideo ? pickNext(pool, currentVideo, watched) : []),
    // watched changes as this video plays — the list shouldn't reshuffle under the kid's finger
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, currentVideo]
  );

  if (loading || !authed) return <Loading />;

  if (!session?.paired) return <PairingScreen onPaired={handlePaired} />;

  if (locked) return <TimesUp name={profile.name} />;

  if (currentVideo) {
    return (
      <PlayerScreen
        key={currentVideo.videoId}
        video={currentVideo}
        session={session}
        minWatchSeconds={rules.minWatchSeconds}
        resume={resume && resume.video.videoId === currentVideo.videoId ? resume : null}
        upNext={upNext}
        onPlay={handlePlayNext}
        onBack={handleBack}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FeedScreen session={session} profile={profile} onVideoPress={handleVideoPress} />
      {notice ? <Notice text={notice} /> : null}
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.center}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Text style={styles.logo}>Kideos</Text>
      <ActivityIndicator size="large" color={colors.brandOnDark} />
    </View>
  );
}

function Notice({ text }: { text: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.noticeWrap, { bottom: insets.bottom + 64 }]}>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{text}</Text>
      </View>
    </View>
  );
}

// Things to do instead — a calm off-ramp, not a punishment
const ACTIVITIES = [
  { emoji: "🎨", text: "Draw something you saw" },
  { emoji: "🧱", text: "Build something cool" },
  { emoji: "📚", text: "Read a book" },
  { emoji: "💃", text: "Have a dance party" },
  { emoji: "🌳", text: "Play outside" },
  { emoji: "🧩", text: "Do a puzzle" },
];

function TimesUp({ name }: { name: string }) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  // A different three each day
  const day = Math.floor(Date.now() / 86_400_000);
  const picks = [0, 1, 2].map((k) => ACTIVITIES[(day + k * 2) % ACTIVITIES.length]);
  const cardW = Math.min(220, Math.floor((layout.width - 2 * layout.margin - 2 * layout.gap) / 3));

  return (
    <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.margin }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Text style={styles.moon}>🌙</Text>
      <Text style={styles.timeUpTitle}>{name ? `Great watching, ${name}!` : "Great watching!"}</Text>
      <Text style={styles.timeUpText}>Time for a break. What will you do next?</Text>
      <View style={[styles.activities, { gap: layout.gap }]}>
        {picks.map((a) => (
          <View key={a.text} style={[styles.activity, { width: cardW }]}>
            <Text style={styles.activityEmoji}>{a.emoji}</Text>
            <Text style={styles.activityText}>{a.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  logo: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 48, marginBottom: 24 },
  noticeWrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  notice: { backgroundColor: colors.focus, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 22, maxWidth: 560 },
  noticeText: { color: colors.ink, fontFamily: fonts.display, fontSize: 19, textAlign: "center" },
  moon: { fontSize: 88, marginBottom: 16 },
  timeUpTitle: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 34, textAlign: "center", marginBottom: 10 },
  timeUpText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 19, textAlign: "center", lineHeight: 27 },
  activities: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  activity: { backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 20, paddingHorizontal: 12, alignItems: "center" },
  activityEmoji: { fontSize: 44, marginBottom: 10 },
  activityText: { color: colors.text, fontFamily: fonts.display, fontSize: 17, textAlign: "center" },
});
