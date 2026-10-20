// Kideos Kid App — VideoTile: one thumbnail + title, used by every shelf and grid.
// Rounded 20 pt corners, optional channel badge (bottom-left), length (bottom-right,
// big-kid mode only) and a mint ✓ sticker once watched.

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Tap from "./Tap";
import { colors, fonts, radius } from "../theme";
import type { ApprovedVideo } from "../types";

interface Props {
  video: ApprovedVideo;
  width: number;
  height: number; // thumbnail height (16:9, or tall for Shorts)
  onPress: (v: ApprovedVideo) => void;
  watched?: boolean;
  channelThumb?: string; // shows the channel badge
  showDuration?: boolean;
  titleSize?: number;
  titleLines?: number;
}

export function formatDuration(s: number | null): string {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// The stored thumbnail is 320 px wide; bigger tiles get YouTube's 480 px one
// (its 4:3 letterbox bars are cropped away by "cover" in a 16:9 tile)
function thumbFor(video: ApprovedVideo, width: number): string {
  if (width > 300 && !video.isShort && video.videoId) return `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  return video.thumbnail;
}

export default function VideoTile({
  video,
  width,
  height,
  onPress,
  watched,
  channelThumb,
  showDuration,
  titleSize = 17,
  titleLines = 2,
}: Props) {
  const duration = showDuration && !video.isShort ? formatDuration(video.durationSeconds) : "";
  const badge = Math.max(26, Math.round(width * 0.13));
  return (
    <Tap
      style={{ width }}
      onPress={() => onPress(video)}
      accessibilityLabel={`${video.title}${video.channelName ? `, ${video.channelName}` : ""}${watched ? ", watched" : ""}`}
    >
      <View style={[styles.thumbWrap, { width, height }]}>
        <Image source={{ uri: thumbFor(video, width) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {channelThumb ? (
          <Image
            source={{ uri: channelThumb }}
            style={[styles.channelBadge, { width: badge, height: badge, borderRadius: badge / 2 }]}
          />
        ) : null}
        {duration ? (
          <View style={styles.duration}>
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        ) : null}
        {watched ? (
          <View style={styles.watched}>
            <Text style={styles.watchedText}>✓</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.3) }]}
        numberOfLines={titleLines}
        maxFontSizeMultiplier={1.3}
      >
        {video.title}
      </Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  thumbWrap: { borderRadius: radius.tile, overflow: "hidden", backgroundColor: colors.surface },
  channelBadge: {
    position: "absolute",
    left: 8,
    bottom: 8,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  duration: {
    position: "absolute",
    right: 8,
    bottom: 8,
    backgroundColor: "rgba(14, 8, 36, 0.82)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  durationText: { color: colors.text, fontFamily: fonts.body, fontSize: 13 },
  watched: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.text,
  },
  watchedText: { color: colors.ink, fontFamily: fonts.bodyHeavy, fontSize: 16, lineHeight: 20 },
  title: { color: colors.text, fontFamily: fonts.bodyHeavy, marginTop: 8, paddingHorizontal: 2 },
});
