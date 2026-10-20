// ─────────────────────────────────────────────────────────────
// Kideos Kid App — PlayerScreen
//
// YouTube player (react-native-youtube-iframe) on a dark screen.
// Every video that reaches this screen is already approved.
//
// Layout (docs/kid-app-design.md): a big orange ← button and the title on top; the
// player as big as the window allows (landscape tablets fit the height, nothing is
// cut off); in portrait, "More from <channel>" under it. When a video ends: an end
// card — Watch again / My videos / up to 3 more from the same channel. Nothing
// plays by itself (no autoplay).
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
//   until it's up, Back / Android back / "More from" keep the kid on the video with a banner.
//   Timed (30 s / 1 / 2 min): counts from when the video first starts playing —
//   pausing counts. The whole video: ~90% actually played (seeking doesn't count;
//   skipping to the end → "Nice try" and back to where they were). Saved, so
//   closing the app reopens it. A parent's Hide / End Session always gets the kid out.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from "react";
import { AppState, BackHandler, FlatList, Linking, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
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
import type { ApprovedVideo, ChildSession } from "../types";
import { FINISHED_SHARE, WHOLE_VIDEO, formatLeft, saveUnfinished, type Unfinished } from "../viewing";
import { colors, fonts, radius, useLayout } from "../theme";
import { markWatched, useWatched } from "../watched";
import Tap from "../components/Tap";
import { hideSystemBars } from "../device";
import VideoTile from "../components/VideoTile";

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

interface Props {
  video: ApprovedVideo;
  session: ChildSession;
  minWatchSeconds: number; // 0 = off, -1 = the whole video
  resume: Unfinished | null; // pick up an owed video where it was
  upNext: ApprovedVideo[]; // up to 3 more from the same channel (end card / "More from")
  onPlay: (video: ApprovedVideo) => void; // picked one of upNext
  onBack: (reason?: ExitReason) => void;
}

export default function PlayerScreen({ video, session, minWatchSeconds, resume, upNext, onPlay, onBack }: Props) {
  const { parentId, childId } = session;
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const [playing, setPlaying] = useState(true); // kept in step with the real player (onChangeState)
  const [ended, setEnded] = useState(false); // end card showing
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
      if (durationRef.current && playedRef.current >= durationRef.current * FINISHED_SHARE) markWatched(video.videoId);
      if (blocked() && playedRef.current % 5 === 0) save();
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWatchSeconds, video]);

  const stillHereMessage = () =>
    whole ? `Finish this one first! ${formatLeft(owed())} left` : `Watch a little more! ${formatLeft(owed())} left`;

  // Leaving is only blocked while the minimum time applies
  const tryLeave = useCallback(() => {
    if (blocked()) {
      flash(stillHereMessage());
      return;
    }
    setPlaying(false);
    onBack("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, flash, minWatchSeconds]);

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

  // Android back button: same as ← (instead of closing the app)
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

  // A parent tapped "Hide this video" — close it right away (App shows why)
  useEffect(() => {
    return subscribeToVideoAllowed(parentId, childId, video.videoId, (allowed) => {
      if (!allowed) onBack("removed");
    });
  }, [parentId, childId, video.videoId, onBack]);

  // ── Sizes ──
  const { width, height, landscape, margin, gap, touch, scale } = layout;
  const barH = touch + 16;
  const usableW = width - insets.left - insets.right;
  const usableH = height - insets.top - insets.bottom - barH;
  const playerW = Math.floor(landscape ? Math.min(usableW, usableH * (16 / 9)) : usableW);
  const playerH = Math.round(playerW * (9 / 16));
  const endTileW = Math.min(
    Math.round(layout.rowTileW * 1.15),
    Math.floor((usableW - 2 * margin - 2 * gap) / 3)
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      <View style={[styles.bar, { height: barH, paddingHorizontal: margin }]}>
        <Tap
          style={[styles.backBtn, { width: touch, height: touch, borderRadius: touch / 2 }]}
          onPress={tryLeave}
          accessibilityLabel="Back to my videos"
        >
          <Text style={[styles.backText, { fontSize: touch * 0.45 }]}>←</Text>
        </Tap>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { fontSize: Math.round(19 * scale) }]} numberOfLines={landscape ? 1 : 2} maxFontSizeMultiplier={1.2}>
            {video.title}
          </Text>
          {video.channelName ? (
            <Text style={styles.channel} numberOfLines={1}>
              {video.channelName}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.playerBand, landscape && { flex: 1 }]}>
        <View style={{ width: playerW, height: playerH }}>
          <YoutubePlayer
            ref={playerRef}
            width={playerW}
            height={playerH}
            videoId={video.videoId}
            play={playing}
            onFullScreenChange={(full: boolean) => {
              if (!full) hideSystemBars(); // leaving YouTube's fullscreen gives the bars back
            }}
            // Safety net: some videos (often record-label music) refuse to play outside YouTube
            onError={(err: string) => {
              if (err === "embed_not_allowed" || err === "video_not_found") onBack("error");
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
                  flash(`Nice try 😄 ${formatLeft(owed())} left`);
                  playerRef.current?.seekTo(lastPosRef.current, true);
                  setPlaying(true);
                  return;
                }
                markWatched(video.videoId);
                setPlaying(false);
                setEnded(true);
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
              injectedJavaScriptBeforeContentLoaded: HIDE_IN_PLAYER,
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false, // reach YouTube's iframe
              onShouldStartLoadWithRequest: allowLoad,
              onOpenWindow, // handling new windows ourselves = Android no longer sends them to the browser
            }}
          />
        </View>
      </View>

      {/* Portrait has room under the player: more from this channel */}
      {!landscape && upNext.length ? (
        <View style={{ paddingTop: 20 }}>
          <Text style={[styles.moreTitle, { paddingHorizontal: margin }]} numberOfLines={1}>
            More from {video.channelName || "this channel"}
          </Text>
          <FlatList
            horizontal
            data={upNext}
            keyExtractor={(v) => v.videoId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: margin, gap }}
            renderItem={({ item }) => (
              <VideoTile
                video={item}
                width={layout.rowTileW}
                height={item.isShort ? layout.shortTileH : layout.rowTileH}
                onPress={tryPlay}
                watched={watched.has(item.videoId)}
                titleSize={Math.round(16 * scale)}
              />
            )}
          />
        </View>
      ) : null}

      {message ? (
        <View pointerEvents="none" style={[styles.messageWrap, { top: insets.top + barH + 12 }]}>
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
                      width={endTileW}
                      height={Math.round(endTileW * (9 / 16))}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: "row", alignItems: "center", gap: 14 },
  backBtn: { backgroundColor: colors.action, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.ink, fontFamily: fonts.displayBold },
  title: { color: colors.text, fontFamily: fonts.bodyHeavy },
  channel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 15, marginTop: 2 },
  playerBand: { backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  moreTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 22, marginBottom: 12 },
  messageWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
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
  endOverlay: { backgroundColor: "rgba(30, 20, 66, 0.97)" },
  endContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  endTitle: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 36, textAlign: "center" },
  endButtons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: 24 },
  endBtn: { minHeight: 72, minWidth: 200, borderRadius: radius.pill, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  endBtnText: { fontFamily: fonts.display, fontSize: 22 },
  endMore: { color: colors.textSecondary, fontFamily: fonts.display, fontSize: 20, marginTop: 32, marginBottom: 14 },
  endTiles: { flexDirection: "row", justifyContent: "center" },
});
