// ─────────────────────────────────────────────────────────────
// Kideos for Parents — VideoPreview
//
// A video's thumbnail with a ▶ — tap it and the video plays right there, so a
// parent can see what it's actually like. Used on the now-watching card and in the
// Videos details sheet. (Plain YouTube player: this is the parent's app, so none of
// the kid player's lockdown applies.)
// ─────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { View, Image, Text, TouchableOpacity, StyleSheet, type LayoutChangeEvent, type ViewStyle } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

interface Props {
  videoId: string;
  thumbnail: string;
  style?: ViewStyle;
}

export default function VideoPreview({ videoId, thumbnail, style }: Props) {
  const [playing, setPlaying] = useState(false);
  const [width, setWidth] = useState(0);
  const height = width * 0.5625; // 16:9

  return (
    <View style={[styles.wrap, style]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {playing && width > 0 ? (
        <YoutubePlayer
          height={height}
          width={width}
          videoId={videoId}
          play
          onChangeState={(s: string) => {
            if (s === "ended") setPlaying(false);
          }}
        />
      ) : (
        <TouchableOpacity activeOpacity={0.85} onPress={() => setPlaying(true)} style={{ height: height || undefined }}>
          {thumbnail ? (
            <Image source={{ uri: thumbnail }} style={[styles.thumb, { height: height || 180 }]} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, { height: height || 180 }]} />
          )}
          <View style={styles.play}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", backgroundColor: "#000", overflow: "hidden" },
  thumb: { width: "100%", backgroundColor: "#E8E8F0" },
  play: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 56,
    height: 56,
    marginTop: -28,
    marginLeft: -28,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: { color: "#fff", fontSize: 22, marginLeft: 3 },
});
