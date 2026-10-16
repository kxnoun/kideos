// ─────────────────────────────────────────────────────────────
// Kideos Kid App — FeedScreen
//
// The kid's entire world. Shows pre-approved videos in a grid.
// Every video here passed this child's questionnaire answers (or a parent approved it).
// No blocked screens. No error states. Just videos.
//
// Data flow:
//   1. Subscribe to whitelisted channels (seedingStatus == "ready")
//   2. Subscribe to this child's videoVerdicts where approved == true,
//      limited to whitelisted channels
//   3. Merge + sort by publishedAt desc
//   4. Render a simple thumbnail grid
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
  RefreshControl,
} from "react-native";
import {
  subscribeToWhitelistedChannels,
  subscribeToApprovedVideos,
  subscribeToPlaySignal,
} from "../services/firebase";
import type { ApprovedVideo, ChildSession, WhitelistedChannel } from "../types";

const { width } = Dimensions.get("window");
const COLUMNS = 3;
const TILE_WIDTH = (width - 48) / COLUMNS; // 16px padding each side + 8px gaps
const TILE_HEIGHT = TILE_WIDTH * 0.56; // 16:9 ratio

interface Props {
  session: ChildSession;
  onVideoPress: (video: ApprovedVideo) => void;
  onPaused: () => void;
  onSessionEnded: () => void;
}

export default function FeedScreen({
  session,
  onVideoPress,
  onPaused,
  onSessionEnded,
}: Props) {
  const [channels, setChannels] = useState<WhitelistedChannel[]>([]);
  const [videos, setVideos] = useState<ApprovedVideo[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const { parentId, childId, childName } = session;

  // Subscribe to whitelisted channels
  useEffect(() => {
    const unsub = subscribeToWhitelistedChannels(parentId, childId, setChannels);
    return unsub;
  }, [parentId, childId]);

  // Stable string key — only changes when the actual channel IDs change,
  // not on every Firestore snapshot (which creates a new array reference).
  const channelIdsKey = useMemo(
    () => channels.map((c) => c.channelId).sort().join(","),
    [channels]
  );

  // Subscribe to approved videos for all ready channels
  useEffect(() => {
    const channelIds = channelIdsKey ? channelIdsKey.split(",") : [];
    const unsub = subscribeToApprovedVideos(parentId, childId, channelIds, setVideos);
    return unsub;
  }, [parentId, childId, channelIdsKey]);

  // Video docs don't store channel name — fill it from the whitelist entries
  const namedVideos = useMemo(() => {
    const names = new Map(channels.map((c) => [c.channelId, c.name]));
    return videos.map((v) => ({ ...v, channelName: names.get(v.channelId) ?? "" }));
  }, [videos, channels]);

  // Listen for parent remote commands (pause / stop)
  useEffect(() => {
    const unsub = subscribeToPlaySignal(parentId, childId, (signal) => {
      if (!signal) return;
      if (signal.action === "stop") onSessionEnded();
    });
    return unsub;
  }, [parentId, childId, onSessionEnded]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const renderVideo = ({ item }: { item: ApprovedVideo }) => (
    <TouchableOpacity
      style={styles.tile}
      onPress={() => onVideoPress(item)}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.thumbnail}
        resizeMode="cover"
      />
      <Text style={styles.videoTitle} numberOfLines={2}>
        {item.title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />

      <View style={styles.header}>
        <Text style={styles.greeting}>Hi {childName} 👋</Text>
        <Text style={styles.subtitle}>What do you want to watch?</Text>
      </View>

      {namedVideos.length === 0 ? (
        <View style={styles.emptyState}>
          {channels.length === 0 ? (
            <>
              <Text style={styles.emptyEmoji}>📺</Text>
              <Text style={styles.emptyTitle}>Getting your videos ready!</Text>
              <Text style={styles.emptyText}>
                A parent is setting up your channel list. Check back soon!
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyEmoji}>⏳</Text>
              <Text style={styles.emptyTitle}>Almost ready!</Text>
              <Text style={styles.emptyText}>
                We're checking your videos. This only takes a moment.
              </Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={namedVideos}
          renderItem={renderVideo}
          keyExtractor={(item) => item.videoId}
          numColumns={COLUMNS}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#6C63FF"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7FF",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  greeting: {
    fontSize: 26,
    fontWeight: "800",
    color: "#1A1A2E",
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    marginTop: 2,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    gap: 8,
    marginBottom: 8,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  thumbnail: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    backgroundColor: "#E0E0FF",
  },
  videoTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333",
    padding: 8,
    lineHeight: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
  },
});
