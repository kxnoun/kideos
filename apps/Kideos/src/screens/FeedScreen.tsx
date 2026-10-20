// ─────────────────────────────────────────────────────────────
// Kideos Kid App — FeedScreen
//
// The kid's entire world: only videos that passed this child's settings (or a
// parent approved). Laid out like YouTube Kids:
//   - "New" — the latest long videos from every channel
//   - "Shorts" — only if the child has any (hidden entirely with "No Shorts")
//   - one row per channel (newest first) — tap the channel → all its videos
// Live: new videos appear and hidden ones disappear without a refresh.
//
// Data flow:
//   1. Subscribe to whitelisted channels
//   2. Subscribe to this child's videoVerdicts where approved == true,
//      limited to whitelisted channels (newest first)
//   3. Group in memory: New / Shorts / per channel
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  BackHandler,
} from "react-native";
import { subscribeToWhitelistedChannels, subscribeToApprovedVideos } from "../services/firebase";
import type { ApprovedVideo, ChildSession, WhitelistedChannel } from "../types";

const { width } = Dimensions.get("window");
// Row tiles (sideways rows)
const ROW_TILE = Math.round(width * 0.42);
const ROW_THUMB_H = Math.round(ROW_TILE * 0.5625); // 16:9
const SHORT_TILE = Math.round(width * 0.28);
const SHORT_THUMB_H = Math.round(SHORT_TILE * 1.6); // tall, like a Short
// Channel page grid
const COLUMNS = 3;
const GRID_TILE = (width - 48) / COLUMNS; // 16px padding each side + 8px gaps
const GRID_THUMB_H = GRID_TILE * 0.5625;

const NEW_COUNT = 15;
const SHORTS_COUNT = 20;
const PER_CHANNEL_ROW = 12;

interface Props {
  session: ChildSession;
  onVideoPress: (video: ApprovedVideo) => void;
  onPaused: () => void;
}

export default function FeedScreen({ session, onVideoPress }: Props) {
  const [channels, setChannels] = useState<WhitelistedChannel[]>([]);
  const [videos, setVideos] = useState<ApprovedVideo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);

  const { parentId, childId, childName } = session;

  useEffect(() => {
    return subscribeToWhitelistedChannels(parentId, childId, setChannels);
  }, [parentId, childId]);

  // Stable key — only changes when the actual channel IDs change
  const channelIdsKey = useMemo(() => channels.map((c) => c.channelId).sort().join(","), [channels]);

  useEffect(() => {
    const channelIds = channelIdsKey ? channelIdsKey.split(",") : [];
    return subscribeToApprovedVideos(parentId, childId, channelIds, setVideos);
  }, [parentId, childId, channelIdsKey]);

  // Video docs don't store channel names — fill them from the whitelist
  const channelById = useMemo(() => new Map(channels.map((c) => [c.channelId, c])), [channels]);
  const named = useMemo(
    () => videos.map((v) => ({ ...v, channelName: channelById.get(v.channelId)?.name ?? "" })),
    [videos, channelById]
  );

  // Already newest first (the query orders by publishedAt desc)
  const longVideos = useMemo(() => named.filter((v) => !v.isShort), [named]);
  const shorts = useMemo(() => named.filter((v) => v.isShort).slice(0, SHORTS_COUNT), [named]);
  const channelRows = useMemo(() => {
    const byChannel = new Map<string, ApprovedVideo[]>();
    for (const v of longVideos) {
      const list = byChannel.get(v.channelId) ?? [];
      list.push(v);
      byChannel.set(v.channelId, list);
    }
    // Channels with the newest video first (insertion order follows newest-first videos)
    return [...byChannel.entries()].map(([channelId, list]) => ({ channel: channelById.get(channelId), channelId, list }));
  }, [longVideos, channelById]);

  // Android back on a channel page → home (not out of the app)
  useEffect(() => {
    if (!openChannelId) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenChannelId(null);
      return true;
    });
    return () => sub.remove();
  }, [openChannelId]);

  const onRefresh = useCallback(() => {
    // Everything is live already — this is just the familiar gesture
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // ── Channel page ──
  if (openChannelId) {
    const channel = channelById.get(openChannelId);
    const list = named.filter((v) => v.channelId === openChannelId);
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />
        <View style={styles.channelHeader}>
          <TouchableOpacity onPress={() => setOpenChannelId(null)} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.channelTitleRow}>
            {channel?.thumbnail ? <Image source={{ uri: channel.thumbnail }} style={styles.avatarBig} /> : null}
            <Text style={styles.channelTitle} numberOfLines={1}>
              {channel?.name ?? ""}
            </Text>
          </View>
        </View>
        <FlatList
          data={list}
          keyExtractor={(v) => v.videoId}
          numColumns={COLUMNS}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.gridTile} onPress={() => onVideoPress(item)} activeOpacity={0.85}>
              <Image source={{ uri: item.thumbnail }} style={styles.gridThumb} resizeMode="cover" />
              <Text style={styles.gridTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    );
  }

  // ── Home ──
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />

      <View style={styles.header}>
        <Text style={styles.greeting}>Hi {childName} 👋</Text>
        <Text style={styles.subtitle}>What do you want to watch?</Text>
      </View>

      {named.length === 0 ? (
        <View style={styles.emptyState}>
          {channels.length === 0 ? (
            <>
              <Text style={styles.emptyEmoji}>📺</Text>
              <Text style={styles.emptyTitle}>Getting your videos ready!</Text>
              <Text style={styles.emptyText}>A parent is setting up your channel list. Check back soon!</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyEmoji}>⏳</Text>
              <Text style={styles.emptyTitle}>Almost ready!</Text>
              <Text style={styles.emptyText}>We're checking your videos. This only takes a moment.</Text>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />}
        >
          {longVideos.length ? (
            <Row title="✨ New" videos={longVideos.slice(0, NEW_COUNT)} onVideoPress={onVideoPress} showChannel />
          ) : null}

          {shorts.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚡ Shorts</Text>
              <FlatList
                horizontal
                data={shorts}
                keyExtractor={(v) => v.videoId}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rowContent}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.shortTile} onPress={() => onVideoPress(item)} activeOpacity={0.85}>
                    <Image source={{ uri: item.thumbnail }} style={styles.shortThumb} resizeMode="cover" />
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          ) : null}

          {channelRows.map(({ channel, channelId, list }) => (
            <View key={channelId} style={styles.section}>
              <TouchableOpacity style={styles.channelRowHeader} onPress={() => setOpenChannelId(channelId)} activeOpacity={0.7}>
                {channel?.thumbnail ? <Image source={{ uri: channel.thumbnail }} style={styles.avatar} /> : null}
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {channel?.name ?? ""}
                </Text>
                <Text style={styles.seeAll}>See all ›</Text>
              </TouchableOpacity>
              <Row videos={list.slice(0, PER_CHANNEL_ROW)} onVideoPress={onVideoPress} />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({
  title,
  videos,
  onVideoPress,
  showChannel,
}: {
  title?: string;
  videos: ApprovedVideo[];
  onVideoPress: (v: ApprovedVideo) => void;
  showChannel?: boolean;
}) {
  return (
    <View style={title ? styles.section : undefined}>
      {title ? <Text style={[styles.sectionTitle, styles.sectionTitlePad]}>{title}</Text> : null}
      <FlatList
        horizontal
        data={videos}
        keyExtractor={(v) => v.videoId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.rowTile} onPress={() => onVideoPress(item)} activeOpacity={0.85}>
            <Image source={{ uri: item.thumbnail }} style={styles.rowThumb} resizeMode="cover" />
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {showChannel && item.channelName ? (
              <Text style={styles.rowChannel} numberOfLines={1}>
                {item.channelName}
              </Text>
            ) : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const card = {
  backgroundColor: "#fff",
  borderRadius: 12,
  overflow: "hidden" as const,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
  elevation: 3,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  greeting: { fontSize: 26, fontWeight: "800", color: "#1A1A2E" },
  subtitle: { fontSize: 15, color: "#666", marginTop: 2 },

  section: { marginTop: 18 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#1A1A2E", flexShrink: 1 },
  sectionTitlePad: { paddingHorizontal: 20, marginBottom: 10 },
  channelRowHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, marginRight: 10, backgroundColor: "#E0E0FF" },
  seeAll: { marginLeft: "auto", paddingLeft: 12, fontSize: 14, fontWeight: "700", color: "#6C63FF" },

  rowContent: { paddingHorizontal: 16, gap: 10 },
  rowTile: { width: ROW_TILE, ...card },
  rowThumb: { width: ROW_TILE, height: ROW_THUMB_H, backgroundColor: "#E0E0FF" },
  rowTitle: { fontSize: 13, fontWeight: "600", color: "#333", paddingHorizontal: 8, paddingTop: 7, paddingBottom: 2, lineHeight: 17 },
  rowChannel: { fontSize: 11, color: "#888", paddingHorizontal: 8, paddingBottom: 8 },
  shortTile: { width: SHORT_TILE, ...card },
  shortThumb: { width: SHORT_TILE, height: SHORT_THUMB_H, backgroundColor: "#E0E0FF" },

  channelHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  back: { fontSize: 16, fontWeight: "600", color: "#6C63FF", marginBottom: 10 },
  channelTitleRow: { flexDirection: "row", alignItems: "center" },
  avatarBig: { width: 40, height: 40, borderRadius: 20, marginRight: 12, backgroundColor: "#E0E0FF" },
  channelTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A2E", flexShrink: 1 },
  grid: { paddingHorizontal: 16, paddingBottom: 24 },
  gridRow: { gap: 8, marginBottom: 8 },
  gridTile: { width: GRID_TILE, ...card },
  gridThumb: { width: GRID_TILE, height: GRID_THUMB_H, backgroundColor: "#E0E0FF" },
  gridTitle: { fontSize: 12, fontWeight: "600", color: "#333", padding: 8, lineHeight: 16 },

  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: "#1A1A2E", marginBottom: 8, textAlign: "center" },
  emptyText: { fontSize: 16, color: "#666", textAlign: "center", lineHeight: 24 },
});
