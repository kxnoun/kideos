// ─────────────────────────────────────────────────────────────
// Kideos Kid App — FeedScreen
//
// The kid's entire world: only videos that passed this child's settings (or a
// parent approved). Live: new videos appear and hidden ones disappear by themselves.
// Design notes: docs/kid-app-design.md. Two modes from the child's age (theme.ts):
//
//   LITTLE (≤4) — pre-readers, landscape only (App.tsx locks it). The child's avatar
//   (not a button — no circle) then a band of big round bubbles (⭐ New, ⚡ Shorts, each
//   channel's picture); tapping one swaps the single sideways film strip below. No
//   vertical scrolling, no greeting text; the strip is sized to the space really left,
//   with nothing in the bottom 48 pt on tablets (where wrists rest).
//
//   BIG (5+) — shelves like YouTube Kids: New / Shorts / one row per channel, and a
//   channel page with everything. The header collapses as they scroll: the
//   "Hi Simon" line fades out and only a slim bar of jump-chips stays pinned.
//
// Sizes come from the window (useLayout), so phone / tablet / rotation / split screen
// all lay out properly.
//
// Data flow:
//   1. Subscribe to whitelisted channels
//   2. Subscribe to this child's videoVerdicts where approved == true,
//      limited to whitelisted channels (newest first)
//   3. Group in memory: New / Shorts / per channel
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Animated,
  BackHandler,
  FlatList,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { subscribeToWhitelistedChannels, subscribeToApprovedVideos } from "../services/firebase";
import { colors, fonts, modeForAge, radius, type as typo, useLayout, type Layout } from "../theme";
import { useWatched } from "../watched";
import Tap from "../components/Tap";
import VideoTile from "../components/VideoTile";
import type { ApprovedVideo, ChildSession, KidProfile, WhitelistedChannel } from "../types";

const NEW_COUNT = 15;
const LITTLE_NEW_COUNT = 30;
const SHORTS_COUNT = 20;
const PER_CHANNEL_ROW = 12;

interface Props {
  session: ChildSession;
  profile: KidProfile;
  // pool = the videos "up next" can come from (same channel, same kind)
  onVideoPress: (video: ApprovedVideo, pool: ApprovedVideo[]) => void;
}

interface Shelf {
  key: string; // "new" | "shorts" | channelId
  label: string;
  emoji?: string;
  color?: string;
  thumb?: string;
  videos: ApprovedVideo[];
  tall?: boolean; // Shorts
  channelId?: string;
}

export default function FeedScreen({ session, profile, onVideoPress }: Props) {
  const [channels, setChannels] = useState<WhitelistedChannel[]>([]);
  const [videos, setVideos] = useState<ApprovedVideo[]>([]);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const layout = useLayout();
  const mode = modeForAge(profile.age);

  const { parentId, childId } = session;

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
  const channelShelves = useMemo<Shelf[]>(() => {
    const byChannel = new Map<string, ApprovedVideo[]>();
    for (const v of longVideos) {
      const list = byChannel.get(v.channelId) ?? [];
      list.push(v);
      byChannel.set(v.channelId, list);
    }
    // Channels with the newest video first (insertion order follows newest-first videos)
    return [...byChannel.entries()].map(([channelId, list]) => {
      const c = channelById.get(channelId);
      return { key: channelId, channelId, label: c?.name ?? "", thumb: c?.thumbnail, videos: list };
    });
  }, [longVideos, channelById]);

  const play = useCallback(
    (v: ApprovedVideo) =>
      onVideoPress(
        v,
        named.filter((o) => o.channelId === v.channelId && Boolean(o.isShort) === Boolean(v.isShort))
      ),
    [named, onVideoPress]
  );

  // Android back on a channel page → home (not out of the app)
  useEffect(() => {
    if (!openChannelId) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenChannelId(null);
      return true;
    });
    return () => sub.remove();
  }, [openChannelId]);

  const statusBar = <StatusBar barStyle="light-content" backgroundColor={colors.bg} />;

  if (named.length === 0) {
    return (
      <View style={styles.screen}>
        {statusBar}
        <Empty waitingForChannels={channels.length === 0} layout={layout} />
      </View>
    );
  }

  if (openChannelId) {
    const channel = channelById.get(openChannelId);
    return (
      <View style={styles.screen}>
        {statusBar}
        <ChannelPage
          channel={channel}
          videos={named.filter((v) => v.channelId === openChannelId)}
          layout={layout}
          showDuration={mode === "big"}
          onBack={() => setOpenChannelId(null)}
          onPlay={play}
        />
      </View>
    );
  }

  const newShelf: Shelf = {
    key: "new",
    label: "New",
    emoji: "⭐",
    color: colors.brand,
    videos: longVideos.slice(0, mode === "little" ? LITTLE_NEW_COUNT : NEW_COUNT),
  };
  const shortsShelf: Shelf = { key: "shorts", label: "Shorts", emoji: "⚡", color: colors.action, videos: shorts, tall: true };
  const shelves = [newShelf, shortsShelf, ...channelShelves].filter((s) => s.videos.length > 0);

  return (
    <View style={styles.screen}>
      {statusBar}
      {mode === "little" ? (
        <LittleHome shelves={shelves} profile={profile} layout={layout} channelById={channelById} onPlay={play} />
      ) : (
        <BigHome
          shelves={shelves}
          profile={profile}
          layout={layout}
          channelById={channelById}
          onPlay={play}
          onOpenChannel={setOpenChannelId}
        />
      )}
    </View>
  );
}

// ── LITTLE: bubbles + one film strip ─────────────────────────

function LittleHome({
  shelves,
  profile,
  layout,
  channelById,
  onPlay,
}: {
  shelves: Shelf[];
  profile: KidProfile;
  layout: Layout;
  channelById: Map<string, WhitelistedChannel>;
  onPlay: (v: ApprovedVideo) => void;
}) {
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const [selected, setSelected] = useState(shelves[0]?.key ?? "new");
  const shelf = shelves.find((s) => s.key === selected) ?? shelves[0];
  const { bubble, margin, gap } = layout;
  const [stripSpace, setStripSpace] = useState(0); // measured height under the bubble band

  // Fit the tile to the space really left (title = 2 lines under it), never wider than the design size
  const titleSize = Math.round(19 * layout.scale);
  const titleBlock = 8 + 2 * Math.round(titleSize * 1.3) + 8;
  const wrist = layout.phone ? 12 : 48; // tablets rest on wrists; phones are held
  const fitH = stripSpace ? Math.max(90, stripSpace - wrist - insets.bottom - titleBlock) : layout.stripTileH;
  const tileH = Math.min(layout.stripTileH, fitH);
  const tileW = shelf.tall ? Math.round(tileH * (9 / 16)) : Math.round(tileH * (16 / 9));
  const showBadge = !shelf.channelId; // mixed shelves show whose video it is

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View style={styles.band}>
        {/* Who's watching — a picture, not a button */}
        <View style={[styles.me, { paddingLeft: margin, height: bubble }]} accessible accessibilityLabel={profile.name}>
          <Text style={{ fontSize: Math.round(bubble * 0.55) }}>{profile.avatar || "🙂"}</Text>
          <View style={[styles.meDivider, { height: bubble * 0.7 }]} />
        </View>
        <ScrollView
          horizontal
          style={{ flex: 1 }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: margin, paddingLeft: 4, paddingTop: 16, paddingBottom: 8, gap }}
        >
          {shelves.map((s) => (
            <Bubble key={s.key} shelf={s} size={bubble} selected={s.key === shelf.key} onPress={() => setSelected(s.key)} />
          ))}
        </ScrollView>
      </View>

      <View
        style={{ flex: 1, justifyContent: "center", paddingBottom: wrist + insets.bottom }}
        onLayout={(e: LayoutChangeEvent) => setStripSpace(Math.round(e.nativeEvent.layout.height))}
      >
        <FlatList
          key={shelf.key} // a new shelf starts at its beginning
          horizontal
          data={shelf.videos}
          keyExtractor={(v) => v.videoId}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: margin, gap }}
          snapToInterval={tileW + gap}
          decelerationRate="fast"
          renderItem={({ item }) => (
            <VideoTile
              video={item}
              width={tileW}
              height={tileH}
              onPress={onPlay}
              watched={watched.has(item.videoId)}
              channelThumb={showBadge ? channelById.get(item.channelId)?.thumbnail : undefined}
              titleSize={titleSize}
            />
          )}
        />
      </View>
    </View>
  );
}

function Bubble({ shelf, size, selected, onPress }: { shelf: Shelf; size: number; selected: boolean; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={{ width: size + 12, alignItems: "center" }} accessibilityLabel={shelf.label} accessibilityState={{ selected }}>
      <View
        style={[
          styles.bubble,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: shelf.color ?? colors.surface },
          selected && styles.bubbleSelected,
        ]}
      >
        {shelf.thumb ? (
          <Image source={{ uri: shelf.thumb }} style={{ width: "100%", height: "100%" }} />
        ) : (
          <Text style={{ fontSize: size * 0.45 }}>{shelf.emoji}</Text>
        )}
      </View>
      <Text style={[styles.bubbleLabel, selected && { color: colors.focus }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {shelf.label}
      </Text>
    </Tap>
  );
}

// ── BIG: collapsing header + shelves ─────────────────────────

const BAR_H = 64;

function BigHome({
  shelves,
  profile,
  layout,
  channelById,
  onPlay,
  onOpenChannel,
}: {
  shelves: Shelf[];
  profile: KidProfile;
  layout: Layout;
  channelById: Map<string, WhitelistedChannel>;
  onPlay: (v: ApprovedVideo) => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const { margin, gap, rowTileW, rowTileH, shortTileW, shortTileH, scale } = layout;
  const greetH = layout.phone ? 48 : 60;
  const topPad = insets.top + greetH + BAR_H + 8;

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const sectionY = useRef<Record<string, number>>({});
  const [active, setActive] = useState(shelves[0]?.key);
  const activeRef = useRef(active);

  // Where a section's top lands just under the pinned bar
  const targetY = useCallback(
    (key: string, index: number) => (index === 0 ? 0 : Math.max(0, (sectionY.current[key] ?? 0) - insets.top - BAR_H - 8)),
    [insets.top]
  );

  // Highlight the chip for the shelf currently under the bar
  const onScrollJS = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const value = e.nativeEvent.contentOffset.y;
    let current = shelves[0]?.key;
    shelves.forEach((s, i) => {
      if (sectionY.current[s.key] !== undefined && targetY(s.key, i) <= value + 12) current = s.key;
    });
    if (current !== activeRef.current) {
      activeRef.current = current;
      setActive(current);
    }
  };

  const headerY = scrollY.interpolate({ inputRange: [0, greetH], outputRange: [0, -greetH], extrapolate: "clamp" });
  const greetOpacity = scrollY.interpolate({ inputRange: [0, greetH * 0.7], outputRange: [1, 0], extrapolate: "clamp" });
  const lineOpacity = scrollY.interpolate({ inputRange: [greetH * 0.7, greetH], outputRange: [0, 1], extrapolate: "clamp" });

  const jump = (key: string, index: number) => scrollRef.current?.scrollTo({ y: targetY(key, index), animated: true });

  return (
    <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: insets.bottom + 32 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: onScrollJS,
        })}
      >
        {shelves.map((s) => (
          <View
            key={s.key}
            style={styles.section}
            onLayout={(e: LayoutChangeEvent) => {
              sectionY.current[s.key] = e.nativeEvent.layout.y;
            }}
          >
            <View style={[styles.sectionHeader, { paddingHorizontal: margin }]}>
              {s.thumb ? (
                <Image source={{ uri: s.thumb }} style={styles.sectionAvatar} />
              ) : (
                <Text style={styles.sectionEmoji}>{s.emoji}</Text>
              )}
              <Text style={[typo.rowTitle, styles.sectionTitle, { fontSize: typo.rowTitle.fontSize * scale }]} numberOfLines={1}>
                {s.label}
              </Text>
              {s.channelId ? (
                <Tap outerStyle={styles.seeAllOuter} style={styles.seeAll} onPress={() => onOpenChannel(s.channelId!)} accessibilityLabel={`See all ${s.label}`}>
                  <Text style={styles.seeAllText}>See all ›</Text>
                </Tap>
              ) : null}
            </View>
            <FlatList
              horizontal
              data={s.channelId ? s.videos.slice(0, PER_CHANNEL_ROW) : s.videos}
              keyExtractor={(v) => v.videoId}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: margin, gap }}
              renderItem={({ item }) => (
                <VideoTile
                  video={item}
                  width={s.tall ? shortTileW : rowTileW}
                  height={s.tall ? shortTileH : rowTileH}
                  onPress={onPlay}
                  watched={watched.has(item.videoId)}
                  channelThumb={s.channelId ? undefined : channelById.get(item.channelId)?.thumbnail}
                  showDuration
                  titleSize={Math.round(17 * scale)}
                />
              )}
              ListFooterComponent={
                s.channelId && s.videos.length > PER_CHANNEL_ROW ? (
                  <Tap
                    style={[styles.moreTile, { width: rowTileH, height: rowTileH }]}
                    onPress={() => onOpenChannel(s.channelId!)}
                    accessibilityLabel={`See all ${s.label}`}
                  >
                    {s.thumb ? <Image source={{ uri: s.thumb }} style={styles.moreAvatar} /> : null}
                    <Text style={styles.moreText}>See all</Text>
                  </Tap>
                ) : null
              }
            />
          </View>
        ))}

        <View style={styles.endCap}>
          <Text style={styles.endEmoji}>🎉</Text>
          <Text style={styles.endText}>You've seen all your channels!</Text>
          <Tap style={styles.endBtn} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}>
            <Text style={styles.endBtnText}>Back to the top ↑</Text>
          </Tap>
        </View>
      </Animated.ScrollView>

      {/* Header: greeting (scrolls away) + chip bar (stays) */}
      <Animated.View
        style={[styles.header, { paddingTop: insets.top, height: insets.top + greetH + BAR_H, transform: [{ translateY: headerY }] }]}
      >
        <Animated.View style={[styles.greetRow, { height: greetH, paddingHorizontal: margin, opacity: greetOpacity }]}>
          <View style={styles.greetAvatar}>
            <Text style={{ fontSize: 22 }}>{profile.avatar || "🙂"}</Text>
          </View>
          <Text style={[typo.greeting, styles.greetText, { fontSize: layout.phone ? 26 : 32 }]} numberOfLines={1}>
            {profile.name ? `Hi ${profile.name} 👋` : "Hi there 👋"}
          </Text>
        </Animated.View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: BAR_H, flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: margin, gap: 10, alignItems: "center" }}
        >
          {shelves.map((s, i) => {
            const on = s.key === active;
            return (
              <Tap
                key={s.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => jump(s.key, i)}
                accessibilityLabel={s.label}
                accessibilityState={{ selected: on }}
              >
                {s.thumb ? <Image source={{ uri: s.thumb }} style={styles.chipAvatar} /> : <Text style={styles.chipEmoji}>{s.emoji}</Text>}
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {s.label}
                </Text>
              </Tap>
            );
          })}
        </ScrollView>
        <Animated.View style={[styles.headerLine, { opacity: lineOpacity }]} />
      </Animated.View>
    </View>
  );
}

// ── Channel page (big mode "See all") ────────────────────────

function ChannelPage({
  channel,
  videos,
  layout,
  showDuration,
  onBack,
  onPlay,
}: {
  channel: WhitelistedChannel | undefined;
  videos: ApprovedVideo[];
  layout: Layout;
  showDuration: boolean;
  onBack: () => void;
  onPlay: (v: ApprovedVideo) => void;
}) {
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const { margin, gap, gridColumns, gridTileW, gridTileH, touch, scale } = layout;

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View style={[styles.pageHeader, { paddingHorizontal: margin }]}>
        <Tap
          style={[styles.backBtn, { width: touch, height: touch, borderRadius: touch / 2 }]}
          onPress={onBack}
          accessibilityLabel="Back"
        >
          <Text style={[styles.backText, { fontSize: touch * 0.45 }]}>←</Text>
        </Tap>
        {channel?.thumbnail ? <Image source={{ uri: channel.thumbnail }} style={styles.pageAvatar} /> : null}
        <Text style={[typo.greeting, styles.pageTitle, { fontSize: 30 * scale }]} numberOfLines={1}>
          {channel?.name ?? ""}
        </Text>
      </View>
      <FlatList
        key={`grid-${gridColumns}`} // column count changes with rotation
        data={videos}
        keyExtractor={(v) => v.videoId}
        numColumns={gridColumns}
        contentContainerStyle={{ paddingHorizontal: margin, paddingBottom: insets.bottom + 32, gap: gap + 4 }}
        columnWrapperStyle={gridColumns > 1 ? { gap } : undefined}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <VideoTile
            video={item}
            width={gridTileW}
            height={gridTileH}
            onPress={onPlay}
            watched={watched.has(item.videoId)}
            showDuration={showDuration}
            titleSize={Math.round(16 * scale)}
          />
        )}
      />
    </View>
  );
}

// ── Nothing to show yet ──────────────────────────────────────

function Empty({ waitingForChannels, layout }: { waitingForChannels: boolean; layout: Layout }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.empty, { paddingTop: insets.top, paddingHorizontal: layout.margin * 2 }]}>
      <Text style={styles.emptyEmoji}>{waitingForChannels ? "📺" : "⏳"}</Text>
      <Text style={styles.emptyTitle}>{waitingForChannels ? "Getting your videos ready!" : "Almost ready!"}</Text>
      <Text style={styles.emptyText}>
        {waitingForChannels
          ? "A grown-up is picking your channels. Check back soon!"
          : "We're checking your videos. This only takes a moment."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // little
  band: { flexDirection: "row", alignItems: "flex-start" },
  me: { flexDirection: "row", alignItems: "center", marginTop: 16, paddingRight: 8 },
  meDivider: { width: 2, borderRadius: 1, backgroundColor: colors.surfacePressed, marginLeft: 14 },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 4,
    borderColor: "transparent",
  },
  bubbleSelected: { borderColor: colors.focus, transform: [{ scale: 1.06 }] },
  bubbleLabel: { color: colors.textSecondary, fontFamily: fonts.display, fontSize: 15, marginTop: 6, textAlign: "center" },

  // big — header
  header: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: colors.bg, zIndex: 2 },
  greetRow: { flexDirection: "row", alignItems: "center" },
  greetAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  greetText: { color: colors.text, flexShrink: 1 },
  chip: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    paddingRight: 18,
    maxWidth: 240,
  },
  chipOn: { backgroundColor: colors.focus },
  chipAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 8, backgroundColor: colors.surfacePressed },
  chipEmoji: { fontSize: 22, width: 36, textAlign: "center", marginRight: 4 },
  chipText: { color: colors.text, fontFamily: fonts.display, fontSize: 17, flexShrink: 1 },
  chipTextOn: { color: colors.ink },
  headerLine: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.surfacePressed },

  // big — shelves
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  sectionAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10, backgroundColor: colors.surface },
  sectionEmoji: { fontSize: 26, marginRight: 8 },
  sectionTitle: { color: colors.text, flexShrink: 1 },
  seeAllOuter: { marginLeft: "auto", marginRight: -4, paddingLeft: 12 },
  seeAll: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  seeAllText: { color: colors.brandOnDark, fontFamily: fonts.display, fontSize: 16 },
  moreTile: {
    borderRadius: radius.tile,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  moreAvatar: { width: 56, height: 56, borderRadius: 28, marginBottom: 8 },
  moreText: { color: colors.text, fontFamily: fonts.display, fontSize: 18 },
  endCap: { alignItems: "center", paddingVertical: 24 },
  endEmoji: { fontSize: 48 },
  endText: { color: colors.textSecondary, fontFamily: fonts.display, fontSize: 20, marginTop: 8, textAlign: "center" },
  endBtn: { marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 14 },
  endBtnText: { color: colors.text, fontFamily: fonts.display, fontSize: 17 },

  // channel page
  pageHeader: { flexDirection: "row", alignItems: "center", paddingTop: 12, paddingBottom: 16 },
  backBtn: { backgroundColor: colors.action, alignItems: "center", justifyContent: "center", marginRight: 14 },
  backText: { color: colors.ink, fontFamily: fonts.displayBold },
  pageAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12, backgroundColor: colors.surface },
  pageTitle: { color: colors.text, flexShrink: 1 },

  // empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyEmoji: { fontSize: 72, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 28, textAlign: "center", marginBottom: 10 },
  emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 18, textAlign: "center", lineHeight: 26 },
});
