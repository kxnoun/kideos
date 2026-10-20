// ─────────────────────────────────────────────────────────────
// Kideos Kid App — PlayerScreen
//
// YouTube player (react-native-youtube-iframe), full screen from the first tap.
// Every video that reaches this screen is already approved.
//
// Layout + gestures (docs/kid-app-design.md → Player):
// - The video fills the screen (our own full screen — YouTube's fullscreen button
//   can't be triggered by an app, and isn't needed). Long videos are locked to
//   landscape while playing (App.tsx); Shorts fill the height.
// - YouTube's own fullscreen button is turned off (the official `fs=0` player setting
//   — its fullscreen would take over the screen and the swipes stop working).
// - The video always fills the screen as far as its shape allows (full height on a
//   phone in landscape). Nothing is drawn on top of it: a quiet round back button sits
//   in the middle of the black space beside it (or above it on 4:3 tablets) — only if
//   there's room; otherwise swipe down / Android back.
// - Opening: the tapped thumbnail grows out of its tile into the player and stays as
//   the picture until the video really plays, then fades into it (seamless open).
// - Drag DOWN → the video follows the finger, shrinking, and the feed shows through
//   behind it; let go far enough → it drops away, otherwise it springs back (only
//   stretches a little, then "Watch a little more!", while the minimum time is owed).
// - Swipe UP → the video shrinks up and "More from <channel>" slides in under it
//   (it moves out of the way — no overlay). Swipe down (anywhere) / the button /
//   Android back → full again.
//   Swipes on the video are seen by a small script inside YouTube's player
//   (SWIPE_IN_PLAYER) that only listens — it never blocks a touch; swipes anywhere
//   else on the screen by a PanResponder.
// - When a video ends: an end card — Watch again / My videos / up to 3 more from the
//   same channel. Nothing plays by itself (no autoplay).
//
// Features:
// - Logs watch session start/end to Firestore
// - Writes "now playing" so parent can see in real time
// - Listens for parent's pause/resume via Firestore (End Session / Hide → App.tsx)
// - Marks videos watched on this device (~90% played or played to the end → ✓)
// - Hides YouTube's share button, YouTube (logo / "Watch on YouTube") button and
//   "More videos" inside the player, and makes the title, channel name and channel
//   picture untappable (taps on them just reach the video) (HIDE_IN_PLAYER, run inside YouTube's iframe;
//   on Android that needs patches/react-native-webview+13.16.1.patch).
//   ⚠️ Changing the YouTube player is against YouTube's terms — decide before launch
//   (docs/backlog.md → kid player).
// - "Before switching videos, stay at least" (parent's viewing rules, src/viewing.ts):
//   until it's up, ← / swipe down / Android back / "More from" keep the kid on the video
//   with a banner. Timed (30 s / 1 / 2 min): counts from when the video first starts
//   playing — pausing counts. The whole video: ~90% actually played (seeking doesn't
//   count; skipping to the end → "Nice try" and back to where they were). Saved, so
//   closing the app reopens it. A parent's Hide / End Session always gets the kid out.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  Linking,
  PanResponder,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import YoutubePlayer, { type YoutubeIframeRef } from "react-native-youtube-iframe";
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";
import {
  subscribeToPlaySignal,
  writeNowPlaying,
  clearNowPlaying,
  setNowPlayingPaused,
  subscribeToVideoAllowed,
  logWatchSessionStart,
  logWatchSessionEnd,
} from "../services/firebase";
import type { ApprovedVideo, ChildSession, TileRect } from "../types";
import { FINISHED_SHARE, WHOLE_VIDEO, formatLeft, saveUnfinished, type Unfinished } from "../viewing";
import { colors, fonts, MOTION, radius, useLayout } from "../theme";
import { markWatched, useWatched } from "../watched";
import Tap, { useReduceMotion } from "../components/Tap";
import VideoTile from "../components/VideoTile";
import BackButton from "../components/BackButton";
import { hideSystemBars } from "../device";

// done = watched or left normally; removed = a parent hid it; error = it won't play here
export type ExitReason = "done" | "removed" | "error";

// Runs at document start in every frame; acts only inside YouTube's player.
// Hides by class AND by label, so it keeps working if YouTube renames classes.
const HIDE_IN_PLAYER = `(function () {
  if (!/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)) return;
  if (window.__kideosHide) return;
  window.__kideosHide = true;
  var CSS = '.ytp-share-button,.ytp-share-button-visible,.ytp-youtube-button,.ytp-impression-link,' +
    '.ytp-watermark,.ytp-pause-overlay,.ytp-expand-pause-overlay,.ytp-pause-overlay-container' +
    '{display:none!important;pointer-events:none!important}' +
    '.ytp-title,.ytp-title-text,.ytp-title-link,.ytp-title-channel,.ytp-title-channel-logo,' +
    '.ytp-title-beacon,.ytp-title-expanded-overlay,.ytp-title-expanded-heading{pointer-events:none!important}';
  var LABEL = /^(share|watch on youtube|more videos)\\b/i;
  function addStyle() {
    var root = document.head || document.documentElement;
    if (!root) return false;
    var st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    return true;
  }
  function hideLabelled() {
    var els = document.querySelectorAll('[aria-label],[title],[data-tooltip-text]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var l = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip-text') || '';
      if (LABEL.test(l.trim())) { el.style.setProperty('display', 'none', 'important'); }
    }
  }
  if (!addStyle()) document.addEventListener('DOMContentLoaded', addStyle);
  // Any other link in the player (title, channel, end cards…) does nothing when tapped.
  // Ad links are left alone (YouTube's rules: don't interfere with ads).
  var blockLink = function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || a.closest('.ytp-ad-module, .video-ads, [class*="ytp-ad-"]')) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('click', blockLink, true);
  document.addEventListener('touchend', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && !a.closest('.ytp-ad-module, .video-ads, [class*="ytp-ad-"]')) e.preventDefault();
  }, true);
  var start = function () {
    hideLabelled();
    new MutationObserver(hideLabelled).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(); true;`;

// Backup at the web view level: YouTube pages never open (in the app, the browser or
// the YouTube app); anything else — i.e. an ad's own link — opens as it normally would.
const PLAYER_PAGE = "https://lonelycpp.github.io/react-native-youtube-iframe/iframe_v2.html";
const YOUTUBE_PAGE = /^https?:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/(?!embed\/)/i;

function allowLoad(req: ShouldStartLoadRequest): boolean {
  const url = req.url ?? "";
  if (url === "about:blank") return true;
  if (req.isTopFrame === false) return !YOUTUBE_PAGE.test(url); // inside YouTube's iframe (iOS)
  if (url.startsWith(PLAYER_PAGE)) return true;
  if (!YOUTUBE_PAGE.test(url) && /^https?:/.test(url)) Linking.openURL(url).catch(() => {});
  return false;
}

function onOpenWindow(e: WebViewOpenWindowEvent) {
  const url = e.nativeEvent.targetUrl ?? "";
  if (url && !YOUTUBE_PAGE.test(url) && /^https?:/.test(url)) Linking.openURL(url).catch(() => {});
}

// Swipe up / down on the video, seen from inside YouTube's iframe (the app can't see
// touches inside the web view). Listens only (passive) — taps, the seek bar, ads all
// work as normal. react-native-youtube-iframe has no custom-message hook, so it
// arrives as a "playbackRateChange" whose data is a "kideos:swipe:*" string (real rate
// changes are numbers, and we don't use them).
const SWIPE_IN_PLAYER = `(function () {
  if (!/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)) return;
  if (window.__kideosSwipe) return;
  window.__kideosSwipe = true;
  function send(dir) {
    var m = JSON.stringify({ eventType: 'playbackRateChange', data: 'kideos:swipe:' + dir });
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) window.ReactNativeWebView.postMessage(m);
      else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView)
        window.webkit.messageHandlers.ReactNativeWebView.postMessage(m);
    } catch (e) {}
  }
  var sx = 0, sy = 0, st = 0, on = false;
  var SKIP = '.ytp-progress-bar-container, .ytp-settings-menu, .ytp-popup, .ytp-ad-module, .video-ads';
  document.addEventListener('touchstart', function (e) {
    on = e.touches.length === 1 && !(e.target && e.target.closest && e.target.closest(SKIP));
    if (!on) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true, capture: true });
  document.addEventListener('touchend', function (e) {
    if (!on) return;
    on = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    // 40 px: well past a tap's wobble, and still reachable on the shrunk video
    if (Date.now() - st < 800 && Math.abs(dy) > 40 && Math.abs(dy) > 2 * Math.abs(dx)) send(dy > 0 ? 'down' : 'up');
  }, { passive: true, capture: true });
})(); true;`;

const SWIPE_PREFIX = "kideos:swipe:";

interface Props {
  video: ApprovedVideo;
  session: ChildSession;
  minWatchSeconds: number; // 0 = off, -1 = the whole video
  resume: Unfinished | null; // pick up an owed video where it was
  upNext: ApprovedVideo[]; // up to 3 more from the same channel (end card / swipe up)
  from?: TileRect | null; // the tapped thumbnail — the player zooms out of it (null = from the centre)
  onPlay: (video: ApprovedVideo) => void; // picked one of upNext
  onBack: (reason?: ExitReason) => void;
}

export default function PlayerScreen({ video, session, minWatchSeconds, resume, upNext, from, onPlay, onBack }: Props) {
  const { parentId, childId } = session;
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const reduceMotion = useReduceMotion();
  const [playing, setPlaying] = useState(true); // kept in step with the real player (onChangeState)
  const [ended, setEnded] = useState(false); // end card showing
  const [showMore, setShowMore] = useState(false); // swiped up: "More from" row under the video
  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // ── Minimum time on this video ──
  const whole = minWatchSeconds === WHOLE_VIDEO;
  const ruleOn = minWatchSeconds !== 0;
  const playerRef = useRef<YoutubeIframeRef>(null);
  const isPlayingRef = useRef(false);
  const playedRef = useRef(resume?.played ?? 0); // seconds actually played
  const lastPosRef = useRef(resume?.position ?? 0); // last position reached by playing (not seeking)
  const durationRef = useRef(video.durationSeconds ?? 0);
  const startedAtRef = useRef<number | null>(resume?.startedAt ?? null); // first started playing (ms)
  const [message, setMessage] = useState("");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Animations (native driver) ──
  const open = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current; // 0 → 1: zooming out of the tile
  // Dragging the video away (any downward direction): where it is, and how far gone (0–1)
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const away = useRef(new Animated.Value(0)).current; // shrinks / fades / shows the feed
  // Geometry the gesture handler needs (set during render)
  const geo = useRef({ playerY: 0, playerH: 0, playerX: 0, playerW: 0, moreY: -1 });
  const thumb = useRef(new Animated.Value(1)).current; // the thumbnail over the player until it plays
  const drop = useRef(new Animated.Value(0)).current; // px down: "not yet" bounce
  const more = useRef(new Animated.Value(0)).current; // 0 full, 1 shrunk up with the row below
  const leavingRef = useRef(false);
  const lastSwipeAt = useRef(0);

  useEffect(() => {
    Animated.timing(open, { toValue: 1, duration: MOTION.slide, easing: MOTION.easing, useNativeDriver: true }).start();
  }, [open]);

  // The thumbnail fades into the video once it really plays (or soon after it's ready / at worst 5 s)
  const revealed = useRef(false);
  const reveal = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    Animated.timing(thumb, { toValue: 0, duration: 180, easing: MOTION.easing, useNativeDriver: true }).start();
  }, [thumb]);
  useEffect(() => {
    const t = setTimeout(reveal, 5000);
    return () => clearTimeout(t);
  }, [reveal]);

  // Seconds still owed (0 = free to go)
  const owed = (): number => {
    if (!ruleOn) return 0;
    if (whole) {
      if (!durationRef.current) return 0; // unknown length → never block
      return Math.max(0, durationRef.current * FINISHED_SHARE - playedRef.current);
    }
    if (startedAtRef.current === null) return 0; // hasn't started playing yet
    return Math.max(0, minWatchSeconds - (Date.now() - startedAtRef.current) / 1000);
  };
  const blocked = () => owed() > 0;
  const save = () =>
    saveUnfinished(childId, { video, position: lastPosRef.current, played: playedRef.current, startedAt: startedAtRef.current });

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 3000);
  }, []);

  useEffect(() => {
    const tick = setInterval(async () => {
      if (!isPlayingRef.current || AppState.currentState !== "active") return;
      playedRef.current += 1;
      const pos = await playerRef.current?.getCurrentTime().catch(() => undefined);
      // Normal playback moves ~1s per tick; a bigger jump is a seek and doesn't count
      if (typeof pos === "number" && pos >= lastPosRef.current - 1 && pos <= lastPosRef.current + 3) {
        lastPosRef.current = pos;
      }
      if (durationRef.current && playedRef.current >= durationRef.current * FINISHED_SHARE) markWatched(video.videoId);
      if (blocked() && playedRef.current % 5 === 0) save();
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWatchSeconds, video]);

  const stillHereMessage = () =>
    whole ? `Finish this one first! ${formatLeft(owed())} left` : `Watch a little more! ${formatLeft(owed())} left`;

  const bounce = () => {
    drop.setValue(0);
    Animated.sequence([
      Animated.timing(drop, { toValue: 36, duration: 120, useNativeDriver: true }),
      Animated.spring(drop, { toValue: 0, useNativeDriver: true, bounciness: 12 }),
    ]).start();
  };

  const toward = (v: Animated.Value, to: number, ms: number = MOTION.slideOut) =>
    Animated.timing(v, { toValue: to, duration: ms, easing: MOTION.easing, useNativeDriver: true });
  const springBack = () => Animated.parallel([toward(dragX, 0), toward(dragY, 0), toward(away, 0)]).start();

  // Back to the feed: the video carries on the way the finger was going (straight down
  // for ← / Android back), shrinking and fading while the feed shows through — only
  // once the minimum time is up
  const leave = (ux = 0, uy = 1) => {
    if (leavingRef.current) return;
    if (blocked()) {
      flash(stillHereMessage());
      springBack();
      bounce();
      return;
    }
    leavingRef.current = true;
    setPlaying(false);
    if (reduceMotion) {
      onBack("done");
      return;
    }
    const D = Math.max(layout.width, layout.height) * 0.9;
    Animated.parallel([toward(dragX, ux * D), toward(dragY, uy * D), toward(away, 1)]).start(() => onBack("done"));
  };

  // Finger let go
  const release = (dx: number, dy: number, vx: number, vy: number, mode: "down" | "up" | "more") => {
    lastSwipeAt.current = Date.now(); // the web view's report of this same swipe is ignored
    if (mode !== "down") {
      // Dragging the video up into "More from" (or back down out of it): finish whichever way it was heading
      const opening = mode === "up" ? dy < -40 || vy < -0.5 : !(dy > 40 || vy > 0.5);
      (opening ? openMore : closeMore)();
      return;
    }
    const dist = Math.hypot(dx, dy);
    const speed = Math.hypot(vx, vy);
    if (dy > 0 && (dist > Math.max(80, layout.height * 0.18) || (speed > 0.8 && dist > 30))) {
      leave(dist ? dx / dist : 0, dist ? dy / dist : 1);
      return;
    }
    springBack();
  };

  const openMore = () => {
    if (!upNext.length || ended) return;
    setShowMore(true);
    toward(more, 1, MOTION.slide).start(); // from wherever the finger left it
  };
  const closeMore = () => {
    Animated.timing(more, { toValue: 0, duration: MOTION.slideOut, easing: MOTION.easing, useNativeDriver: true }).start(() =>
      setShowMore(false)
    );
  };

  const tryPlay = (next: ApprovedVideo) => {
    if (blocked()) {
      flash(stillHereMessage());
      return;
    }
    onPlay(next);
  };

  const watchAgain = () => {
    setEnded(false);
    playerRef.current?.seekTo(0, true);
    setPlaying(true);
  };

  // Latest handlers for things called from outside React's render (web view, back button)
  const handlers = useRef({ leave, openMore, closeMore, showMore, release, blocked, ended, upNext });
  handlers.current = { leave, openMore, closeMore, showMore, release, blocked, ended, upNext };

  const onSwipe = useCallback((dir: string) => {
    const now = Date.now();
    if (now - lastSwipeAt.current < 600) return; // seen by both the web view and the PanResponder
    lastSwipeAt.current = now;
    const h = handlers.current;
    if (dir === "up" && !h.showMore) h.openMore();
    if (dir === "down") (h.showMore ? h.closeMore : h.leave)();
  }, []);

  // Drags anywhere — on the video too (the finger's touch is taken from the web view once
  // it's clearly a drag; taps still reach YouTube). Down in ANY downward direction (even
  // mostly sideways) → the video follows the finger and flies off that way; up → it rises
  // (slower than the finger) into "More from". Drags starting on YouTube's control bar
  // (bottom of the video — the seek bar) only count when they're straight up/down.
  const mode = useRef<"down" | "up" | "more">("down");
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => {
          const h = handlers.current;
          if (h.ended || leavingRef.current) return false;
          // The direction is decided HERE: at grant the responder resets dx/dy to 0
          const vertical = Math.abs(g.dy) > 10 && Math.abs(g.dy) > 2 * Math.abs(g.dx);
          if (h.showMore) {
            mode.current = "more";
            return vertical; // the row scrolls sideways
          }
          const { playerX, playerY, playerW, playerH } = geo.current;
          const onControls =
            g.y0 > playerY + playerH * 0.78 && g.y0 < playerY + playerH && g.x0 > playerX && g.x0 < playerX + playerW;
          const up = h.upNext.length > 0 && -g.dy > 10 && -g.dy > Math.abs(g.dx);
          const down = onControls ? vertical && g.dy > 0 : g.dy > 8 && g.dy >= 0.2 * Math.abs(g.dx);
          if (up && (!onControls || vertical)) {
            mode.current = "up";
            return true;
          }
          if (down) {
            mode.current = "down";
            return true;
          }
          return false;
        },
        onPanResponderGrant: () => {
          if (mode.current === "up") setShowMore(true); // the row comes in with the video
        },
        onPanResponderMove: (_e, g) => {
          const h = handlers.current;
          if (leavingRef.current) return;
          const reach = Math.abs(geo.current.moreY) || 1;
          if (mode.current === "up") {
            more.setValue(Math.min(1, Math.max(0, (-g.dy * 0.6) / reach)));
          } else if (mode.current === "more") {
            more.setValue(Math.min(1, Math.max(0, 1 - (g.dy * 0.6) / reach)));
          } else {
            const k = h.blocked() ? 0.25 : 1; // owed: only stretches
            dragX.setValue(g.dx * k);
            dragY.setValue(g.dy * k);
            away.setValue(Math.min(1, (Math.hypot(g.dx, Math.max(g.dy, 0)) * k) / (layout.height || 1)));
          }
        },
        onPanResponderRelease: (_e, g) => handlers.current.release(g.dx, g.dy, g.vx, g.vy, mode.current),
        onPanResponderTerminate: () => handlers.current.release(0, 0, 0, 0, mode.current),
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragX, dragY, away, more]
  );

  // Android back: closes "More from" first, then like ← (instead of closing the app)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const h = handlers.current;
      (h.showMore ? h.closeMore : h.leave)();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Log session start + write now-playing on mount
  useEffect(() => {
    writeNowPlaying(
      parentId, childId,
      video.videoId, video.title, video.channelName, video.thumbnail
    );

    logWatchSessionStart(
      parentId, childId,
      video.videoId, video.title, video.channelName, video.channelId
    ).then((id) => { sessionIdRef.current = id; });

    startTimeRef.current = Date.now();

    return () => {
      clearNowPlaying(parentId, childId);
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (sessionIdRef.current) {
        logWatchSessionEnd(parentId, childId, sessionIdRef.current, durationSeconds);
      }
    };
  }, [parentId, childId, video]);

  // Parent's pause / resume. The first snapshot is whatever was sent last (maybe
  // long ago) — only react to commands sent while this video is open.
  // ("stop" / time's up is handled for the whole app in App.tsx.)
  useEffect(() => {
    let first = true;
    const unsub = subscribeToPlaySignal(parentId, childId, (signal) => {
      if (first) {
        first = false;
        return;
      }
      if (signal?.action === "pause") setPlaying(false);
      if (signal?.action === "play") setPlaying(true);
    });
    return unsub;
  }, [parentId, childId]);

  // A parent tapped "Hide this video" — close it right away (App shows why)
  useEffect(() => {
    return subscribeToVideoAllowed(parentId, childId, video.videoId, (allowed) => {
      if (!allowed) onBack("removed");
    });
  }, [parentId, childId, video.videoId, onBack]);

  // ── Sizes: fit the video, and keep a strip beside (or above) it for the ← button ──
  const { width, height, margin, gap, touch, scale } = layout;
  const W = width - insets.left - insets.right;
  const H = height - insets.top - insets.bottom;
  const aspect = video.isShort ? 9 / 16 : 16 / 9;
  // The video always fills the screen as far as its shape allows — never shrunk for the button
  const playerW = Math.floor(Math.min(W, H * aspect));
  const playerH = Math.floor(playerW / aspect);
  const sideSpace = (W - playerW) / 2;
  const topSpace = (H - playerH) / 2;
  // The button only goes where there's black space for it; otherwise: swipe down / Android back
  const backSize = Math.min(touch, 56);
  const backFits = sideSpace >= backSize + 8 || topSpace >= backSize + 8;
  const backPosition = showMore
    ? { left: insets.left + 12, top: insets.top + 12 }
    : sideSpace >= backSize + 8
      ? { left: insets.left + (sideSpace - backSize) / 2, top: insets.top + (H - backSize) / 2 }
      : { left: insets.left + margin, top: insets.top + (topSpace - backSize) / 2 };

  useEffect(() => {
    if (__DEV__) {
      console.log(
        `[player] window ${Math.round(width)}x${Math.round(height)} insets t${insets.top} b${insets.bottom} ` +
          `l${insets.left} r${insets.right} → player ${playerW}x${playerH}`
      );
    }
  }, [width, height, insets.top, insets.bottom, insets.left, insets.right, playerW, playerH]);

  // Swiped up: the video shrinks to the top, the row takes the space below
  const rowTileH = Math.min(layout.rowTileH, Math.round(H * 0.3));
  const rowTileW = Math.round(rowTileH * (16 / 9));
  const rowBlock = 40 + rowTileH + 8 + 2 * Math.round(16 * scale * 1.3) + 12; // heading + tile + title
  const moreScale = Math.min(0.62, Math.max(0.3, (H - rowBlock - 24) / playerH));
  const moreY = 12 + (playerH * moreScale) / 2 - H / 2; // centre → near the top

  // Dragged away: follows the finger, smaller and fading the further it goes; the black
  // behind fades so the feed shows through
  const playerTransform = [
    { translateX: dragX },
    { translateY: Animated.add(Animated.add(drop, dragY), more.interpolate({ inputRange: [0, 1], outputRange: [0, moreY] })) },
    {
      scale: Animated.multiply(
        more.interpolate({ inputRange: [0, 1], outputRange: [1, moreScale] }),
        away.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] })
      ),
    },
  ];
  const playerOpacity = away.interpolate({ inputRange: [0, 0.45, 0.8], outputRange: [1, 1, 0], extrapolate: "clamp" });
  const backdrop = Animated.multiply(open, away.interpolate({ inputRange: [0, 0.7], outputRange: [1, 0], extrapolate: "clamp" }));
  const chrome = away.interpolate({ inputRange: [0, 0.15], outputRange: [1, 0], extrapolate: "clamp" });

  // Opening: the thumbnail starts on its tile and grows into the player's place
  const playerX = insets.left + (W - playerW) / 2;
  const playerY = insets.top + (H - playerH) / 2;
  geo.current = { playerX, playerY, playerW, playerH, moreY };
  const zoom = from
    ? {
        dx: from.x + from.w / 2 - (playerX + playerW / 2),
        dy: from.y + from.h / 2 - (playerY + playerH / 2),
        s: Math.max(0.1, from.w / playerW),
      }
    : { dx: 0, dy: 0, s: 0.85 };
  const thumbStyle = {
    opacity: from ? thumb : Animated.multiply(thumb, open),
    transform: [
      { translateX: open.interpolate({ inputRange: [0, 1], outputRange: [zoom.dx, 0] }) },
      { translateY: open.interpolate({ inputRange: [0, 1], outputRange: [zoom.dy, 0] }) },
      { scale: open.interpolate({ inputRange: [0, 1], outputRange: [zoom.s, 1] }) },
    ],
  };
  // The player itself appears once the thumbnail is in place (it's still loading anyway)
  const webOpacity = open.interpolate({ inputRange: [0, 0.98, 1], outputRange: [0, 0, 1] });
  const thumbUri = video.isShort ? video.thumbnail : `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;

  return (
    <View style={styles.screen} {...pan.panHandlers}>
      <StatusBar hidden />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]} />

      <View style={[styles.stage, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }]}>
        <Animated.View style={{ width: playerW, height: playerH, opacity: playerOpacity, transform: playerTransform }}>
          <Animated.View style={{ opacity: webOpacity }}>
          <YoutubePlayer
            ref={playerRef}
            width={playerW}
            height={playerH}
            videoId={video.videoId}
            play={playing}
            initialPlayerParams={{ preventFullScreen: true }}
            onPlaybackRateChange={(data: string) => {
              if (typeof data === "string" && data.startsWith(SWIPE_PREFIX)) onSwipe(data.slice(SWIPE_PREFIX.length));
            }}
            onFullScreenChange={(full: boolean) => {
              if (!full) hideSystemBars(); // leaving YouTube's fullscreen gives the bars back
            }}
            // Safety net: some videos (often record-label music) refuse to play outside YouTube
            onError={(err: string) => {
              if (err === "embed_not_allowed" || err === "video_not_found") onBack("error");
            }}
            onReady={() => {
              setTimeout(reveal, 1500); // in case it doesn't start playing by itself
              playerRef.current?.getDuration().then((d) => {
                if (d > 0) durationRef.current = d;
              });
              if (resume && resume.position > 5) playerRef.current?.seekTo(resume.position, true);
            }}
            onChangeState={(state: string) => {
              isPlayingRef.current = state === "playing";
              if (state === "playing") reveal();
              if (state === "playing" && startedAtRef.current === null) {
                startedAtRef.current = Date.now(); // the minimum time counts from here
                if (ruleOn) save(); // so closing the app right away still reopens it
              }
              if (state === "ended") {
                // Ended for real (most of it played — e.g. a short video) always lets them go;
                // dragged to the end while still owed → back to where they really were
                const reallyWatched = playedRef.current >= durationRef.current * FINISHED_SHARE;
                if (blocked() && !reallyWatched) {
                  flash(`Nice try 😄 ${formatLeft(owed())} left`);
                  playerRef.current?.seekTo(lastPosRef.current, true);
                  setPlaying(true);
                  return;
                }
                markWatched(video.videoId);
                setPlaying(false);
                setEnded(true);
                if (handlers.current.showMore) handlers.current.closeMore();
                setNowPlayingPaused(parentId, childId, true);
                return;
              }
              // keep `playing` matching the real player, so a parent's pause is always a change
              if (state === "playing") {
                setPlaying(true);
                setNowPlayingPaused(parentId, childId, false);
              }
              if (state === "paused") {
                setPlaying(false);
                setNowPlayingPaused(parentId, childId, true);
              }
            }}
            webViewStyle={{ opacity: 0.99 }} // fixes RN rendering flicker
            webViewProps={{
              injectedJavaScriptBeforeContentLoaded: HIDE_IN_PLAYER + SWIPE_IN_PLAYER,
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false, // reach YouTube's iframe
              onShouldStartLoadWithRequest: allowLoad,
              onOpenWindow, // handling new windows ourselves = Android no longer sends them to the browser
            }}
          />
          </Animated.View>
          {/* never takes touches — even see-through, it would block YouTube's controls */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, thumbStyle]}>
            <Image source={{ uri: thumbUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          </Animated.View>
        </Animated.View>
      </View>

      {/* Back: centred in the black space beside / above the video — never on top of it.
          With "More from" open, top-left (the row takes the bottom). */}
      {backFits || showMore ? (
        <Animated.View style={[styles.backWrap, backPosition, { opacity: chrome }]}>
        <BackButton
          size={backSize}
          variant="quiet"
          direction={showMore ? "down" : "left"}
          onPress={() => (showMore ? closeMore() : leave())}
          label={showMore ? "Back to the video" : "Back to my videos"}
        />
        </Animated.View>
      ) : null}

      {/* Swiped up: more from this channel, under the shrunk video */}
      {showMore ? (
        <Animated.View
          style={[
            styles.moreRow,
            {
              bottom: insets.bottom + 12,
              left: insets.left,
              right: insets.right,
              opacity: more,
              transform: [{ translateY: more.interpolate({ inputRange: [0, 1], outputRange: [rowBlock, 0] }) }],
            },
          ]}
        >
          <Text style={[styles.moreTitle, { paddingHorizontal: margin }]} numberOfLines={1}>
            More from {video.channelName || "this channel"}
          </Text>
          <FlatList
            horizontal
            data={upNext}
            keyExtractor={(v) => v.videoId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: margin, gap, flexGrow: 1, justifyContent: "center" }}
            renderItem={({ item }) => (
              <VideoTile
                video={item}
                width={rowTileW}
                height={rowTileH}
                onPress={tryPlay}
                watched={watched.has(item.videoId)}
                titleSize={Math.round(16 * scale)}
              />
            )}
          />
        </Animated.View>
      ) : null}

      {message ? (
        <View pointerEvents="none" style={[styles.messageWrap, { top: insets.top + 16 }]}>
          <View style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        </View>
      ) : null}

      {ended ? (
        <View style={[StyleSheet.absoluteFill, styles.endOverlay]}>
          <ScrollView
            contentContainerStyle={[
              styles.endContent,
              { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: margin },
            ]}
          >
            <Text style={styles.endTitle}>That's the end! 🎉</Text>
            <View style={[styles.endButtons, { gap }]}>
              <Tap style={[styles.endBtn, { backgroundColor: colors.brand }]} onPress={watchAgain}>
                <Text style={[styles.endBtnText, { color: colors.text }]}>↻ Watch again</Text>
              </Tap>
              <Tap style={[styles.endBtn, { backgroundColor: colors.action }]} onPress={() => onBack("done")}>
                <Text style={[styles.endBtnText, { color: colors.ink }]}>🏠 My videos</Text>
              </Tap>
            </View>
            {upNext.length ? (
              <>
                <Text style={styles.endMore} numberOfLines={1}>
                  More from {video.channelName || "this channel"}
                </Text>
                <View style={[styles.endTiles, { gap }]}>
                  {upNext.map((v) => (
                    <VideoTile
                      key={v.videoId}
                      video={v}
                      width={endTileW(layout, W)}
                      height={Math.round(endTileW(layout, W) * (9 / 16))}
                      onPress={onPlay}
                      watched={watched.has(v.videoId)}
                      titleSize={Math.round(16 * scale)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function endTileW(layout: ReturnType<typeof useLayout>, usableW: number): number {
  return Math.min(Math.round(layout.rowTileW * 1.15), Math.floor((usableW - 2 * layout.margin - 2 * layout.gap) / 3));
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, // see-through: the black is `backdrop`, which fades to show the feed
  backdrop: { backgroundColor: "#000" },
  stage: { position: "absolute", alignItems: "center", justifyContent: "center" },
  backWrap: { position: "absolute", zIndex: 3 },
  moreRow: { position: "absolute" },
  moreTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 20, marginBottom: 10, textAlign: "center" },
  messageWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 4 },
  message: {
    backgroundColor: colors.focus,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 22,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  messageText: { color: colors.ink, fontFamily: fonts.display, fontSize: 20 },
  endOverlay: { backgroundColor: "rgba(30, 20, 66, 0.97)", zIndex: 5 },
  endContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  endTitle: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 36, textAlign: "center" },
  endButtons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: 24 },
  endBtn: { minHeight: 72, minWidth: 200, borderRadius: radius.pill, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  endBtnText: { fontFamily: fonts.display, fontSize: 22 },
  endMore: { color: colors.textSecondary, fontFamily: fonts.display, fontSize: 20, marginTop: 32, marginBottom: 14 },
  endTiles: { flexDirection: "row", justifyContent: "center" },
});
