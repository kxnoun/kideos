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
//   "More videos" inside the player (HIDE_IN_PLAYER, run inside YouTube's iframe;
//   on Android that needs patches/react-native-webview+13.16.1.patch).
//   ⚠️ Changing the YouTube player is against YouTube's terms — decide before launch
//   (docs/backlog.md → kid player).
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import {
  subscribeToPlaySignal,
  writeNowPlaying,
  clearNowPlaying,
  logWatchSessionStart,
  logWatchSessionEnd,
} from "../services/firebase";
import type { ApprovedVideo, ChildSession } from "../types";

// Runs at document start in every frame; acts only inside YouTube's player.
// Hides by class AND by label, so it keeps working if YouTube renames classes.
const HIDE_IN_PLAYER = `(function () {
  if (!/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)) return;
  if (window.__kideosHide) return;
  window.__kideosHide = true;
  var CSS = '.ytp-share-button,.ytp-share-button-visible,.ytp-youtube-button,.ytp-impression-link,' +
    '.ytp-watermark,.ytp-pause-overlay,.ytp-expand-pause-overlay,.ytp-pause-overlay-container' +
    '{display:none!important;pointer-events:none!important}';
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
  var start = function () {
    hideLabelled();
    new MutationObserver(hideLabelled).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(); true;`;

const { width } = Dimensions.get("window");
const PLAYER_HEIGHT = width * 0.5625; // 16:9

interface Props {
  video: ApprovedVideo;
  session: ChildSession;
  onBack: () => void;
}

export default function PlayerScreen({ video, session, onBack }: Props) {
  const { parentId, childId } = session;
  const [playing, setPlaying] = useState(true);
  const [timeUp, setTimeUp] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());

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

  // Listen for parent remote commands
  useEffect(() => {
    const unsub = subscribeToPlaySignal(parentId, childId, (signal) => {
      if (!signal) return;
      if (signal.action === "pause") setPlaying(false);
      if (signal.action === "play") setPlaying(true);
      if (signal.action === "stop") setTimeUp(true);
    });
    return unsub;
  }, [parentId, childId]);

  const handleBack = useCallback(() => {
    setPlaying(false);
    onBack();
  }, [onBack]);

  if (timeUp) {
    return (
      <SafeAreaView style={styles.timeUpContainer}>
        <Text style={styles.timeUpEmoji}>🌙</Text>
        <Text style={styles.timeUpTitle}>Time's up for now!</Text>
        <Text style={styles.timeUpText}>
          A parent has ended your session. See you next time!
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={styles.playerWrapper}>
        <YoutubePlayer
          height={PLAYER_HEIGHT}
          videoId={video.videoId}
          play={playing}
          onChangeState={(state) => {
            if (state === "ended") onBack();
          }}
          webViewStyle={{ opacity: 0.99 }} // fixes RN rendering flicker
          webViewProps={{
            injectedJavaScriptBeforeContentLoaded: HIDE_IN_PLAYER,
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false, // reach YouTube's iframe
          }}
        />
      </View>

      <View style={styles.info}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

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
  timeUpContainer: {
    flex: 1,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  timeUpEmoji: {
    fontSize: 80,
    marginBottom: 24,
  },
  timeUpTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 12,
  },
  timeUpText: {
    fontSize: 17,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    lineHeight: 26,
  },
});
