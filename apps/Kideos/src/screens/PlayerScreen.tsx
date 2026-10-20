// ─────────────────────────────────────────────────────────────
// Kideos Kid App — PlayerScreen
//
// Full-screen YouTube player using react-native-youtube-iframe.
// Every video that reaches this screen is already approved.
// No blocked states exist here.
//
// Features:
// - Logs watch session start/end to Firestore
// - Writes "now playing" so parent can see in real time
// - Listens for parent's pause/stop command via Firestore
// - Shows a friendly "time's up" screen on remote stop
// - Hides YouTube's share button, YouTube (logo / "Watch on YouTube") button and
//   "More videos" inside the player, and makes the title, channel name and channel
//   picture untappable (taps on them just reach the video) (HIDE_IN_PLAYER, run inside YouTube's iframe;
//   on Android that needs patches/react-native-webview+13.16.1.patch).
//   ⚠️ Changing the YouTube player is against YouTube's terms — decide before launch
//   (docs/backlog.md → kid player).
// - "Before switching videos, stay at least" (parent's viewing rules, src/viewing.ts):
//   until it's up, Back / Android back keep the kid on the video with a banner.
//   Timed (30 s / 1 / 2 min): counts from when the video first starts playing —
//   pausing counts. The whole video: ~90% actually played (seeking doesn't count;
//   skipping to the end → "Nice try" and back to where they were). Saved, so
//   closing the app reopens it. A parent's Hide / End Session always gets the kid out.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from "react";
import { AppState, BackHandler } from "react-native";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Linking,
  Alert,
} from "react-native";
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
import type { ApprovedVideo, ChildSession } from "../types";
import { FINISHED_SHARE, WHOLE_VIDEO, formatLeft, saveUnfinished, type Unfinished } from "../viewing";

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

const { width } = Dimensions.get("window");
const PLAYER_HEIGHT = width * 0.5625; // 16:9

interface Props {
  video: ApprovedVideo;
  session: ChildSession;
  minWatchSeconds: number; // 0 = off, -1 = the whole video
  resume: Unfinished | null; // pick up an owed video where it was
  onBack: (reason?: ExitReason) => void;
}

export default function PlayerScreen({ video, session, minWatchSeconds, resume, onBack }: Props) {
  const { parentId, childId } = session;
  const [playing, setPlaying] = useState(true); // kept in step with the real player (onChangeState)
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
    saveUnfinished({ video, position: lastPosRef.current, played: playedRef.current, startedAt: startedAtRef.current });

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
      if (blocked() && playedRef.current % 5 === 0) save();
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWatchSeconds, video]);

  // Leaving is only blocked while "must finish" applies
  const tryLeave = useCallback(() => {
    if (blocked()) {
      flash(whole ? `Finish this one first! ${formatLeft(owed())} left` : `Watch a little more! ${formatLeft(owed())} left`);
      return;
    }
    setPlaying(false);
    onBack("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, flash, minWatchSeconds]);

  // Android back button: same as ← Back (instead of closing the app)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      tryLeave();
      return true;
    });
    return () => sub.remove();
  }, [tryLeave]);

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

  // A parent tapped "Hide this video" — close it right away
  useEffect(() => {
    return subscribeToVideoAllowed(parentId, childId, video.videoId, (allowed) => {
      if (!allowed) {
        onBack("removed");
        Alert.alert("This video was removed", "A parent removed this video. Pick another one!");
      }
    });
  }, [parentId, childId, video.videoId, onBack]);


  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.playerWrapper}>
        <YoutubePlayer
          ref={playerRef}
          height={PLAYER_HEIGHT}
          videoId={video.videoId}
          play={playing}
          // Safety net: some videos (often record-label music) refuse to play outside YouTube
          onError={(err: string) => {
            if (err === "embed_not_allowed" || err === "video_not_found") {
              onBack("error");
              Alert.alert("This video can't play here", "Pick another one!");
            }
          }}
          onReady={() => {
            playerRef.current?.getDuration().then((d) => {
              if (d > 0) durationRef.current = d;
            });
            if (resume && resume.position > 5) playerRef.current?.seekTo(resume.position, true);
          }}
          onChangeState={(state: string) => {
            isPlayingRef.current = state === "playing";
            if (state === "playing" && startedAtRef.current === null) {
              startedAtRef.current = Date.now(); // the minimum time counts from here
              if (ruleOn) save(); // so closing the app right away still reopens it
            }
            if (state === "ended") {
              // Ended for real (most of it played — e.g. a short video) always lets them go;
              // dragged to the end while still owed → back to where they really were
              const reallyWatched = playedRef.current >= durationRef.current * FINISHED_SHARE;
              if (blocked() && !reallyWatched) {
                // Skipped to the end without watching — back to where they really were
                flash(`Nice try 😄 ${formatLeft(owed())} left`);
                playerRef.current?.seekTo(lastPosRef.current, true);
                setPlaying(true);
                return;
              }
              onBack("done");
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
            injectedJavaScriptBeforeContentLoaded: HIDE_IN_PLAYER,
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false, // reach YouTube's iframe
            onShouldStartLoadWithRequest: allowLoad,
            onOpenWindow, // handling new windows ourselves = Android no longer sends them to the browser
          }}
        />
      </View>

      <View style={styles.info}>
        <TouchableOpacity onPress={tryLeave} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {message ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : null}

        <Text style={styles.title} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={styles.channel}>{video.channelName}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  playerWrapper: {
    width: "100%",
    backgroundColor: "#000",
  },
  info: {
    flex: 1,
    backgroundColor: "#F7F7FF",
    padding: 20,
  },
  backBtn: {
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 16,
    color: "#6C63FF",
    fontWeight: "600",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 6,
  },
  channel: {
    fontSize: 14,
    color: "#666",
  },
  message: {
    backgroundColor: "#FFF6E0",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  messageText: { fontSize: 16, fontWeight: "700", color: "#6B4600" },
});
