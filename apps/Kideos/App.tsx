// ─────────────────────────────────────────────────────────────
// Kideos Kid App — Root component
//
// State machine:
//   unpaired → PairingScreen (the device is paired to a FAMILY)
//   old one-child pairing (before Oct 20, 2026) → moved over once (onDeviceMigration)
//   paired → users/{p}/kidDevices/{this device's UID} says which children use it
//     2+ children, nobody picked → "Who's watching?" (WhoScreen; PIN if set)
//     the parent removed the device → back to pairing
//   a child picked, no video → FeedScreen
//   a child picked, video selected → PlayerScreen
//   parent pressed End Session for that child → "Time's up" over everything, until
//   the parent lets them watch again (the last playSignal is "stop"; survives restarts)
//   "stay at least N / the whole video" + a video still owed → it reopens when that
//   child is picked again (also after a restart)
//
// "Who's watching?" comes back after a full restart, and when the app has been away
// longer than the parent's setting (src/gate.ts). Each child's doc is watched live:
// name, avatar, age (picks the little/big layout, theme.ts), PIN, viewing rules.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  AppState,
  Animated,
  InteractionManager,
  Dimensions,
} from "react-native";
import auth from "@react-native-firebase/auth";

import { useSession } from "./src/hooks/useSession";
import PairingScreen from "./src/screens/PairingScreen";
import FeedScreen from "./src/screens/FeedScreen";
import PlayerScreen, { type ExitReason } from "./src/screens/PlayerScreen";
import WhoScreen from "./src/screens/WhoScreen";
import {
  subscribeToPlaySignal,
  subscribeToChild,
  subscribeToKidDevice,
  requestDeviceMigration,
  subscribeToMigration,
} from "./src/services/firebase";
import { normalizeRules, getUnfinished, clearUnfinished, stillOwed, type Unfinished } from "./src/viewing";
import { colors, fonts, MOTION, modeForAge, radius, useLayout } from "./src/theme";
import { setLandscapeOnly } from "./src/device";
import { useWatched, setWatchedChild, adoptLegacyWatched } from "./src/watched";
import { rememberChild, forgetChild, markLeft, stillChosen, setAskWhoMinutes } from "./src/gate";
import Tap, { useReduceMotion } from "./src/components/Tap";
import {
  isLegacySession,
  type ApprovedVideo,
  type ChildSession,
  type DeviceChild,
  type KidDevice,
  type TileRect,
} from "./src/types";

const TAP_DEBOUNCE_MS = 600;
const DEFAULT_ASK_WHO_MINUTES = 5;

// Up next: older videos from the same list first (it's newest first), unwatched first
function pickNext(pool: ApprovedVideo[], video: ApprovedVideo, watched: Set<string>, n = 3): ApprovedVideo[] {
  const i = pool.findIndex((v) => v.videoId === video.videoId);
  const ordered = [...pool.slice(i + 1), ...pool.slice(0, Math.max(i, 0))].filter((v) => v.videoId !== video.videoId);
  return [...ordered.filter((v) => !watched.has(v.videoId)), ...ordered.filter((v) => watched.has(v.videoId))].slice(0, n);
}

function toChild(id: string, data: Record<string, unknown> | undefined): DeviceChild {
  return {
    id,
    name: typeof data?.name === "string" ? data.name : "",
    age: typeof data?.age === "number" ? data.age : 8,
    avatar: typeof data?.avatar === "string" ? data.avatar : "",
    pinHash: typeof data?.pinHash === "string" && data.pinHash ? data.pinHash : undefined,
    viewing: data?.viewing,
  };
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const { session, loading, saveSession, clearSession } = useSession();
  const [currentVideo, setCurrentVideo] = useState<ApprovedVideo | null>(null);
  const [pool, setPool] = useState<ApprovedVideo[]>([]); // where "up next" comes from
  const [resume, setResume] = useState<Unfinished | null>(null); // where to pick an unfinished video up
  const [notice, setNotice] = useState<string | null>(null);
  const [openFrom, setOpenFrom] = useState<TileRect | null>(null); // the tapped thumbnail (player zooms out of it)
  const [curtain, setCurtain] = useState<DeviceChild | null>(null); // "Hi Simon!" after picking
  const [feedReady, setFeedReady] = useState(false); // the picked child's videos have arrived
  const markFeedReady = useCallback(() => setFeedReady(true), []);
  const watched = useWatched();
  const lastTap = useRef(0);

  // Sign in anonymously so Firestore security rules allow reads/writes.
  // The anonymous UID is stable across restarts on the same device — it's the
  // device's identity (kidDevices/{uid}).
  // Wait for auth before rendering screens — their Firestore listeners
  // are denied (and never retry) if they start before sign-in finishes.
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    return auth().onAuthStateChanged((user) => {
      if (user) {
        setUid(user.uid);
        return;
      }
      setUid(null);
      auth().signInAnonymously().catch((err) => {
        // Without auth, every Firestore read except pairing is denied
        console.warn("[auth] anonymous sign-in failed:", err);
      });
    });
  }, []);

  const parentId = session?.paired ? session.parentId : null;
  const legacy = isLegacySession(session) ? session : null;

  // ── This device: which children use it (undefined = loading, null = unpaired) ──
  const [device, setDevice] = useState<KidDevice | null | undefined>(undefined);
  useEffect(() => {
    setDevice(undefined);
    if (!uid || !parentId) return;
    return subscribeToKidDevice(parentId, uid, setDevice);
  }, [uid, parentId]);

  // Old one-child pairing: ask once to be moved over, then save the new session
  useEffect(() => {
    if (!legacy || !uid || device === undefined) return;
    if (device) {
      adoptLegacyWatched(legacy.childId).finally(() =>
        saveSession({ parentId: legacy.parentId, paired: true, version: 2 })
      );
      return;
    }
    requestDeviceMigration(uid, legacy.parentId, legacy.childId).catch((err) =>
      console.warn("[deviceMigration] request failed:", err)
    );
    return subscribeToMigration(uid, (status) => {
      if (status === "refused") clearSession(); // pair again
    });
  }, [legacy, uid, device, saveSession, clearSession]);

  // The parent unpaired this device → back to the pairing screen
  useEffect(() => {
    if (device === null && session?.paired && !legacy) {
      forgetChild();
      clearSession();
    }
  }, [device, session?.paired, legacy, clearSession]);

  // ── The children on this device (their docs, live) ──
  const childIdsKey = device?.childIds.join(",") ?? "";
  const [childDocs, setChildDocs] = useState<Record<string, DeviceChild>>({});
  useEffect(() => {
    if (!parentId || !childIdsKey) return;
    const unsubs = childIdsKey
      .split(",")
      .map((id) =>
        subscribeToChild(parentId, id, (data) => setChildDocs((prev) => ({ ...prev, [id]: toChild(id, data) })))
      );
    return () => unsubs.forEach((u) => u());
  }, [parentId, childIdsKey]);
  const kids = useMemo(
    () => (childIdsKey ? childIdsKey.split(",").map((id) => childDocs[id]).filter((k): k is DeviceChild => Boolean(k)) : []),
    [childIdsKey, childDocs]
  );
  const kidsReady = Boolean(device) && kids.length === (device?.childIds.length ?? 0);
  const shared = (device?.childIds.length ?? 0) > 1;
  const askWho = device?.askWhoAfterMinutes ?? DEFAULT_ASK_WHO_MINUTES;

  // ── Who's watching ──
  const [activeId, setActiveId] = useState<string | null>(() => stillChosen());
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const active = kids.find((k) => k.id === activeId) ?? null;
  const rules = useMemo(() => normalizeRules(active?.viewing), [active?.viewing]);

  // End Session (per child) — the last playSignal "stop" locks that child
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!parentId || !childIdsKey) return;
    const unsubs = childIdsKey.split(",").map((id) =>
      subscribeToPlaySignal(parentId, id, (signal) => {
        const stop = signal?.action === "stop";
        setLocked((prev) => ({ ...prev, [id]: stop }));
        if (stop) {
          // End Session wins over everything, including the minimum watch time
          clearUnfinished(id);
          if (activeRef.current === id) {
            setCurrentVideo(null);
            setResume(null);
          }
        }
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [parentId, childIdsKey]);

  const resumeChecked = useRef(false); // the remembered child's owed video was looked at
  // A video this child still owes (closed the app mid-video) → reopen it
  const resumeOwed = useCallback((child: DeviceChild) => {
    getUnfinished(child.id).then((u) => {
      if (activeRef.current !== child.id) return;
      if (u && stillOwed(u, normalizeRules(child.viewing))) {
        setPool([]);
        setResume(u);
        setCurrentVideo(u.video);
      } else if (u) {
        clearUnfinished(child.id);
      }
    });
  }, []);

  const choose = useCallback(
    (child: DeviceChild) => {
      rememberChild(child.id);
      setWatchedChild(child.id);
      setActiveId(child.id);
      activeRef.current = child.id;
      setCurrentVideo(null);
      setResume(null);
      resumeChecked.current = true;
      resumeOwed(child);
    },
    [resumeOwed]
  );

  // "Who's watching?" slides down over the screen (WhoLayer), then this runs
  const [whoEntering, setWhoEntering] = useState(false);
  const switchProfile = useCallback(() => setWhoEntering(true), []);
  const finishSwitch = useCallback(() => {
    setWhoEntering(false);
    forgetChild();
    setWatchedChild(null);
    setActiveId(null);
    setCurrentVideo(null);
    setResume(null);
  }, []);

  // The picked child was taken off this device / the remembered one isn't here
  useEffect(() => {
    if (activeId && kidsReady && !kids.some((k) => k.id === activeId)) finishSwitch();
  }, [activeId, kidsReady, kids, finishSwitch]);

  // Only one child on this device → no picker
  useEffect(() => {
    if (kidsReady && kids.length === 1 && activeId !== kids[0].id) choose(kids[0]);
  }, [kidsReady, kids, activeId, choose]);

  // Remembered from before the screen was rebuilt (app closed and reopened): their ✓s,
  // and the video they still owe (once their doc — with the viewing rules — is here)
  useEffect(() => {
    if (resumeChecked.current || !active) return;
    resumeChecked.current = true;
    if (activeId === active.id && !currentVideo) {
      setWatchedChild(active.id);
      resumeOwed(active);
    }
    // only for the child remembered at start-up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Away long enough (the parent's setting) → ask again. A full restart always asks
  // (gate.ts lives in memory only).
  useEffect(() => {
    setAskWhoMinutes(askWho);
  }, [askWho]);
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") markLeft();
      if (state === "active" && sharedRef.current && activeRef.current && !stillChosen()) {
        finishSwitch(); // nobody's looking — no animation
      }
    });
    return () => {
      sub.remove();
      markLeft(); // the screen is going away (Back out of the app) — counts as leaving
    };
  }, [finishSwitch]);

  // A friendly note on the feed (instead of a system pop-up)
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleVideoPress = useCallback((video: ApprovedVideo, fromPool: ApprovedVideo[], from?: TileRect) => {
    const now = Date.now();
    if (now - lastTap.current < TAP_DEBOUNCE_MS) return; // excited double taps
    lastTap.current = now;
    // A long video held upright turns the phone sideways as it opens — the tile's spot means
    // nothing after that, so it zooms from the centre instead
    const { width, height } = Dimensions.get("window");
    setOpenFrom(video.isShort || width > height ? from ?? null : null);
    setResume(null);
    setPool(fromPool);
    setCurrentVideo(video);
  }, []);

  // Picked from the end card / "More from" — same pool
  const handlePlayNext = useCallback((video: ApprovedVideo) => {
    setOpenFrom(null);
    setResume(null);
    if (activeRef.current) clearUnfinished(activeRef.current);
    setCurrentVideo(video);
  }, []);

  // Leaving a video (watched, allowed to leave, hidden by a parent, or won't play)
  const handleBack = useCallback((reason: ExitReason = "done") => {
    setCurrentVideo(null);
    setResume(null);
    if (activeRef.current) clearUnfinished(activeRef.current);
    if (reason === "removed") setNotice("A grown-up took that video away. Pick another one!");
    if (reason === "error") setNotice("That video can't play here. Pick another one!");
  }, []);

  const childSession = useMemo<ChildSession | null>(
    () =>
      parentId && active
        ? { parentId, childId: active.id, childName: active.name, childAge: active.age, paired: true }
        : null,
    [parentId, active]
  );

  // Landscape only: young mode always (a portrait strip wastes most of the screen), and
  // everyone while a long video plays (full screen). Otherwise (and on "Who's watching?")
  // free to rotate.
  const littleMode = Boolean(active) && modeForAge(active?.age) === "little";
  const isLocked = Boolean(activeId && locked[activeId]);
  const longVideoOpen = Boolean(currentVideo && !currentVideo.isShort && !isLocked);
  useEffect(() => {
    setLandscapeOnly(littleMode || longVideoOpen);
  }, [littleMode, longVideoOpen]);

  const upNext = useMemo(
    () => (currentVideo ? pickNext(pool, currentVideo, watched) : []),
    // watched changes as this video plays — the list shouldn't reshuffle under the kid's finger
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, currentVideo]
  );

  if (loading || !uid) return <Loading />;

  if (!session?.paired) return <PairingScreen onPaired={saveSession} />;

  if (legacy || device === undefined || (device && !kidsReady)) return <Loading />;

  if (!device || kids.length === 0) {
    return <Message emoji="📺" title="Almost ready!" text="A grown-up is choosing who uses this device." />;
  }

  if (!active && kids.length === 1) return <Loading />; // picked automatically in a moment

  const pick = (id: string) => {
    const k = kids.find((c) => c.id === id);
    if (!k) return;
    setFeedReady(false);
    choose(k);
    setCurtain(k); // "Hi Simon!" — slides up once their feed is ready
  };

  // The feed stays alive under the player (Back from a video is instant, same scroll
  // position). "Who's watching?" and the "Hi Simon!" card are layers on top.
  return (
    <View style={styles.root}>
      {active && childSession ? (
        isLocked ? (
          <TimesUp name={active.name} onSwitch={shared ? switchProfile : undefined} />
        ) : (
          <>
            <View style={styles.root}>
              <FeedScreen
                key={active.id}
                session={childSession}
                profile={active}
                onVideoPress={handleVideoPress}
                onSwitchProfile={shared ? switchProfile : undefined}
                onReady={markFeedReady}
              />
              {notice ? <Notice text={notice} /> : null}
            </View>
            {currentVideo ? (
              <View style={[StyleSheet.absoluteFill, styles.playerLayer]}>
                <PlayerScreen
                  key={currentVideo.videoId}
                  video={currentVideo}
                  session={childSession}
                  minWatchSeconds={rules.minWatchSeconds}
                  resume={resume && resume.video.videoId === currentVideo.videoId ? resume : null}
                  upNext={upNext}
                  from={openFrom}
                  onPlay={handlePlayNext}
                  onBack={handleBack}
                />
              </View>
            ) : null}
          </>
        )
      ) : null}
      {!active || whoEntering ? (
        <WhoLayer slideIn={whoEntering} onIn={finishSwitch}>
          <WhoScreen kids={kids} locked={locked} onChoose={pick} />
        </WhoLayer>
      ) : null}
      {curtain ? <Curtain kid={curtain} ready={feedReady || isLocked} onDone={() => setCurtain(null)} /> : null}
    </View>
  );
}

// "Who's watching?" — slides down from the top when switching (appears in place on start-up)
function WhoLayer({ slideIn, onIn, children }: { slideIn: boolean; onIn: () => void; children: React.ReactNode }) {
  const { height } = useLayout();
  const reduceMotion = useReduceMotion();
  const y = useRef(new Animated.Value(slideIn && !reduceMotion ? -height : 0)).current;
  useEffect(() => {
    if (!slideIn) return;
    if (reduceMotion) {
      onIn();
      return;
    }
    Animated.timing(y, { toValue: 0, duration: MOTION.slide, easing: MOTION.easing, useNativeDriver: true }).start(
      () => onIn()
    );
    // only when it first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.whoLayer, { transform: [{ translateY: y }] }]}>
      {children}
    </Animated.View>
  );
}

// After picking a child: their avatar and "Hi Simon!" until their feed has its videos
// (so it never slides away onto an empty screen that then pops in), then it slides up
const CURTAIN_MIN_MS = 450;
const CURTAIN_MAX_MS = 4000;

function Curtain({ kid, ready, onDone }: { kid: DeviceChild; ready: boolean; onDone: () => void }) {
  const { height, phone } = useLayout();
  const reduceMotion = useReduceMotion();
  const y = useRef(new Animated.Value(0)).current;
  const shownAt = useRef(Date.now());
  const going = useRef(false);
  const go = useRef(() => {});
  go.current = () => {
    if (going.current) return;
    going.current = true;
    if (reduceMotion) {
      onDone();
      return;
    }
    Animated.timing(y, { toValue: -height, duration: MOTION.slide, easing: MOTION.easing, useNativeDriver: true }).start(
      () => onDone()
    );
  };
  useEffect(() => {
    const t = setTimeout(() => go.current(), CURTAIN_MAX_MS); // never stuck
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!ready) return;
    // let the feed draw its first frame, and the card be seen for a moment
    const wait = Math.max(0, CURTAIN_MIN_MS - (Date.now() - shownAt.current));
    let t: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      t = setTimeout(() => go.current(), wait);
    });
    return () => {
      task.cancel();
      if (t) clearTimeout(t);
    };
  }, [ready]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.center, styles.curtainLayer, { transform: [{ translateY: y }] }]}>
      <StatusBar hidden />
      <Text style={{ fontSize: phone ? 96 : 128 }}>{kid.avatar || "🙂"}</Text>
      <Text style={styles.curtainHi}>{kid.name ? `Hi ${kid.name}!` : "Hi!"}</Text>
    </Animated.View>
  );
}

function Message({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <View style={[styles.center, { paddingHorizontal: 32 }]}>
      <StatusBar hidden />
      <Text style={styles.moon}>{emoji}</Text>
      <Text style={styles.timeUpTitle}>{title}</Text>
      <Text style={styles.timeUpText}>{text}</Text>
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.center}>
      <StatusBar hidden />
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

function TimesUp({ name, onSwitch }: { name: string; onSwitch?: () => void }) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  // A different three each day
  const day = Math.floor(Date.now() / 86_400_000);
  const picks = [0, 1, 2].map((k) => ACTIVITIES[(day + k * 2) % ACTIVITIES.length]);
  const cardW = Math.min(220, Math.floor((layout.width - 2 * layout.margin - 2 * layout.gap) / 3));

  return (
    <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.margin }]}>
      <StatusBar hidden />
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
      {onSwitch ? (
        <Tap style={styles.switchBtn} onPress={onSwitch} accessibilityLabel="Who's watching?">
          <Text style={styles.switchText}>Who's watching?</Text>
        </Tap>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Layers over the feed — explicit order, or Android lets the feed's chip bar show through
  playerLayer: { zIndex: 10, elevation: 10 }, // see-through: the player fades its own black in/out over the feed
  whoLayer: { backgroundColor: colors.bg, zIndex: 20, elevation: 20 },
  curtainLayer: { zIndex: 30, elevation: 30 },
  curtainHi: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 40, marginTop: 12 },
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
  switchBtn: { marginTop: 32, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 28, paddingVertical: 16 },
  switchText: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
  activityText: { color: colors.text, fontFamily: fonts.display, fontSize: 17, textAlign: "center" },
});
