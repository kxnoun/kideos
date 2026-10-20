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
// On a device more than one child uses, the child's avatar (little: the rounded square
// on the left; big: next to "Hi Simon") goes back to "Who's watching?" (onSwitchProfile).
//
// Data flow:
//   1. Subscribe to whitelisted channels
//   2. Subscribe to this child's videoVerdicts where approved == true,
//      limited to whitelisted channels (newest first)
//   3. Group in memory: New / Shorts / per channel
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef, useImperativeHandle, forwardRef, memo } from "react";
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
import { colors, fonts, modeForAge, MOTION, radius, type as typo, useLayout, type Layout } from "../theme";
import { useWatched } from "../watched";
import Tap, { useReduceMotion } from "../components/Tap";
import VideoTile from "../components/VideoTile";
import BackButton from "../components/BackButton";
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
  onSwitchProfile?: () => void; // only on devices with 2+ children
  onReady?: () => void; // the first channels + videos have arrived (App's "Hi Simon!" card waits for it)
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

export default function FeedScreen({ session, profile, onVideoPress, onSwitchProfile, onReady }: Props) {
  const [channels, setChannels] = useState<WhitelistedChannel[]>([]);
  const [videos, setVideos] = useState<ApprovedVideo[]>([]);
  // Nothing is drawn until the first channels + videos arrive (no "Getting ready" flash)
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [videosFor, setVideosFor] = useState<string | null>(null);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const layout = useLayout();
  const mode = modeForAge(profile.age);

  const { parentId, childId } = session;

  useEffect(() => {
    return subscribeToWhitelistedChannels(parentId, childId, (list) => {
      setChannels(list);
      setChannelsLoaded(true);
    });
  }, [parentId, childId]);

  // Stable key — only changes when the actual channel IDs change
  const channelIdsKey = useMemo(() => channels.map((c) => c.channelId).sort().join(","), [channels]);

  useEffect(() => {
    const channelIds = channelIdsKey ? channelIdsKey.split(",") : [];
    if (!channelsLoaded) return;
    return subscribeToApprovedVideos(parentId, childId, channelIds, (list) => {
      setVideos(list);
      setVideosFor(channelIdsKey);
    });
  }, [parentId, childId, channelIdsKey, channelsLoaded]);
  const ready = channelsLoaded && videosFor === channelIdsKey;
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);

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

  // Built once per data change — not on every redraw (opening a channel page used to
  // rebuild them, which redrew every row)
  const shelves = useMemo<Shelf[]>(() => {
    const newShelf: Shelf = {
      key: "new",
      label: "New",
      emoji: "⭐",
      color: colors.brand,
      videos: longVideos.slice(0, mode === "little" ? LITTLE_NEW_COUNT : NEW_COUNT),
    };
    const shortsShelf: Shelf = { key: "shorts", label: "Shorts", emoji: "⚡", color: colors.action, videos: shorts, tall: true };
    return [newShelf, shortsShelf, ...channelShelves].filter((s) => s.videos.length > 0);
  }, [longVideos, shorts, channelShelves, mode]);

  const channelVideos = useMemo(
    () => (openChannelId ? named.filter((v) => v.channelId === openChannelId) : []),
    [named, openChannelId]
  );
  const closeChannel = useCallback(() => setOpenChannelId(null), []);

  const statusBar = <StatusBar barStyle="light-content" backgroundColor={colors.bg} />;

  if (!ready) return <View style={styles.screen} />;

  if (named.length === 0) {
    return (
      <View style={styles.screen}>
        {statusBar}
        <Empty waitingForChannels={channels.length === 0} layout={layout} onSwitchProfile={onSwitchProfile} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {statusBar}
      {mode === "little" ? (
        <LittleHomeMemo
          shelves={shelves}
          profile={profile}
          layout={layout}
          channelById={channelById}
          onPlay={play}
          onSwitchProfile={onSwitchProfile}
        />
      ) : (
        <BigHomeMemo
          shelves={shelves}
          profile={profile}
          layout={layout}
          channelById={channelById}
          onPlay={play}
          onOpenChannel={setOpenChannelId}
          onSwitchProfile={onSwitchProfile}
        />
      )}
      {/* "See all": slides in over the home screen, which stays as it was underneath */}
      {openChannelId ? (
        <ChannelPage
          channel={channelById.get(openChannelId)}
          videos={channelVideos}
          layout={layout}
          showDuration={mode === "big"}
          onBack={closeChannel}
          onPlay={play}
        />
      ) : null}
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
  onSwitchProfile,
}: {
  shelves: Shelf[];
  profile: KidProfile;
  layout: Layout;
  channelById: Map<string, WhitelistedChannel>;
  onPlay: (v: ApprovedVideo) => void;
  onSwitchProfile?: () => void;
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
        {/* Who's watching — just a picture; on a shared device a rounded square (not a
            round bubble) that goes back to "Who's watching?" */}
        <View style={[styles.me, { paddingLeft: margin, height: bubble }]}>
          {onSwitchProfile ? (
            <Tap
              highlight={false}
              style={[styles.meSwitch, { width: bubble * 0.82, height: bubble * 0.82 }]}
              onPress={onSwitchProfile}
              accessibilityLabel={`${profile.name} — switch who's watching`}
            >
              <Text style={{ fontSize: Math.round(bubble * 0.46) }}>{profile.avatar || "🙂"}</Text>
            </Tap>
          ) : (
            <Text style={{ fontSize: Math.round(bubble * 0.55) }} accessibilityLabel={profile.name}>
              {profile.avatar || "🙂"}
            </Text>
          )}
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
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
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
    <Tap onPress={onPress} highlight={false} style={{ width: size + 12, alignItems: "center" }} accessibilityLabel={shelf.label} accessibilityState={{ selected }}>
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
  onSwitchProfile,
}: {
  shelves: Shelf[];
  profile: KidProfile;
  layout: Layout;
  channelById: Map<string, WhitelistedChannel>;
  onPlay: (v: ApprovedVideo) => void;
  onOpenChannel: (channelId: string) => void;
  onSwitchProfile?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const watched = useWatched();
  const { margin, gap, rowTileW, rowTileH, shortTileW, shortTileH, scale } = layout;
  // Breathing room above "Hi Simon" and between it and the chip bar
  const greetH = layout.phone ? 72 : 88;
  const avatar = layout.phone ? 52 : 60;
  const topPad = insets.top + greetH + BAR_H + 8;

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const sectionY = useRef<Record<string, number>>({});
  // The lit chip lives in ChipBar's own state: changing it redraws only the chips,
  // not every shelf (that redraw was what made the highlight lag)
  const chips = useRef<ChipBarHandle>(null);
  const activeRef = useRef<string | undefined>(shelves[0]?.key);
  const setActiveKey = useCallback((key: string | undefined) => {
    if (key === activeRef.current) return;
    activeRef.current = key;
    chips.current?.setActive(key);
  }, []);
  // A chip was tapped: that chip stays lit while the list scrolls there (instead of
  // every shelf on the way lighting up), until the kid scrolls by hand
  const jumpedTo = useRef<string | null>(null);
  const viewportH = useRef(0);
  const contentH = useRef(0);


  // Where a section's top lands just under the pinned bar
  const targetY = useCallback(
    (key: string, index: number) => (index === 0 ? 0 : Math.max(0, (sectionY.current[key] ?? 0) - insets.top - BAR_H - 8)),
    [insets.top]
  );

  // Highlight the chip for the shelf currently under the bar
  const onScrollJS = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (jumpedTo.current) return;
    const value = e.nativeEvent.contentOffset.y;
    let current = shelves[0]?.key;
    shelves.forEach((s, i) => {
      if (sectionY.current[s.key] !== undefined && targetY(s.key, i) <= value + 12) current = s.key;
    });
    // At the very bottom the last shelves can't reach the bar — the last one counts
    if (contentH.current && value >= contentH.current - viewportH.current - 8) current = shelves[shelves.length - 1]?.key;
    setActiveKey(current);
  };



  const headerY = scrollY.interpolate({ inputRange: [0, greetH], outputRange: [0, -greetH], extrapolate: "clamp" });
  const greetOpacity = scrollY.interpolate({ inputRange: [0, greetH * 0.7], outputRange: [1, 0], extrapolate: "clamp" });
  const lineOpacity = scrollY.interpolate({ inputRange: [greetH * 0.7, greetH], outputRange: [0, 1], extrapolate: "clamp" });

  const jump = useCallback(
    (key: string, index: number) => {
      jumpedTo.current = key;
      setActiveKey(key); // lights up right away
      scrollRef.current?.scrollTo({ y: targetY(key, index), animated: true });
    },
    [setActiveKey, targetY]
  );

  return (
    <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: insets.bottom + 32 }}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          jumpedTo.current = null; // scrolling by hand again
        }}
        onLayout={(e: LayoutChangeEvent) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w: number, h: number) => {
          contentH.current = h;
        }}
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
              // only what fits on screen first; the rest as they scroll
              initialNumToRender={Math.ceil(layout.width / ((s.tall ? shortTileW : rowTileW) + gap)) + 1}
              maxToRenderPerBatch={4}
              windowSize={3}
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
          {onSwitchProfile ? (
            <Tap
              highlight={false}
              style={[styles.greetAvatar, { width: avatar, height: avatar, borderRadius: avatar / 2 }]}
              onPress={onSwitchProfile}
              accessibilityLabel={`${profile.name} — switch who's watching`}
            >
              <Text style={{ fontSize: Math.round(avatar * 0.55) }}>{profile.avatar || "🙂"}</Text>
              <View style={styles.switchBadge}>
                <Text style={styles.switchBadgeText}>⇄</Text>
              </View>
            </Tap>
          ) : (
            <View style={[styles.greetAvatar, { width: avatar, height: avatar, borderRadius: avatar / 2 }]}>
              <Text style={{ fontSize: Math.round(avatar * 0.55) }}>{profile.avatar || "🙂"}</Text>
            </View>
          )}
          <Text style={[typo.greeting, styles.greetText, { fontSize: layout.phone ? 26 : 32 }]} numberOfLines={1}>
            {profile.name ? `Hi ${profile.name} 👋` : "Hi there 👋"}
          </Text>
        </Animated.View>
        <ChipBar ref={chips} shelves={shelves} margin={margin} initial={shelves[0]?.key} onJump={jump} />
        <Animated.View style={[styles.headerLine, { opacity: lineOpacity }]} />
      </Animated.View>
    </View>
  );
}

// ── The chip bar (big mode) ──────────────────────────────────
// Owns which chip is lit, so lighting one redraws just the chips. Keeps the lit
// chip in view.

interface ChipBarHandle {
  setActive: (key: string | undefined) => void;
}

const ChipBar = memo(
  forwardRef<
    ChipBarHandle,
    { shelves: Shelf[]; margin: number; initial: string | undefined; onJump: (key: string, index: number) => void }
  >(function ChipBar({ shelves, margin, initial, onJump }, ref) {
    const [active, setActive] = useState(initial);
    const bar = useRef<ScrollView>(null);
    const chipX = useRef<Record<string, number>>({});
    useImperativeHandle(ref, () => ({ setActive }), []);

    useEffect(() => {
      const x = active ? chipX.current[active] : undefined;
      if (x !== undefined) bar.current?.scrollTo({ x: Math.max(0, x - margin - 48), animated: true });
    }, [active, margin]);

    return (
      <ScrollView
        ref={bar}
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
              onLayout={(e: LayoutChangeEvent) => {
                chipX.current[s.key] = e.nativeEvent.layout.x;
              }}
              onPress={() => onJump(s.key, i)}
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
    );
  })
);

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
  const reduceMotion = useReduceMotion();
  const { margin, gap, gridColumns, gridTileW, gridTileH, touch, scale } = layout;

  // Slides in from the right; the grid fills in once it's there (so the slide starts at once)
  const x = useRef(new Animated.Value(reduceMotion ? 0 : layout.width)).current;
  const [ready, setReady] = useState(reduceMotion);
  const closing = useRef(false);
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(x, { toValue: 0, duration: MOTION.slide, easing: MOTION.easing, useNativeDriver: true }).start(
      () => setReady(true)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reduceMotion) {
      onBack();
      return;
    }
    Animated.timing(x, { toValue: layout.width, duration: MOTION.slideOut, easing: MOTION.easing, useNativeDriver: true }).start(
      () => onBack()
    );
  }, [onBack, reduceMotion, x, layout.width]);

  // Android back → home (not out of the app). Registered once: a video opened from
  // here registers after it, so Back closes the video first.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.page,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, transform: [{ translateX: x }] },
      ]}
    >
      <View style={[styles.pageHeader, { paddingHorizontal: margin }]}>
        <BackButton size={touch} onPress={close} label="Back" outerStyle={{ marginRight: 14 }} />
        {channel?.thumbnail ? <Image source={{ uri: channel.thumbnail }} style={styles.pageAvatar} /> : null}
        <Text style={[typo.greeting, styles.pageTitle, { fontSize: 30 * scale }]} numberOfLines={1}>
          {channel?.name ?? ""}
        </Text>
      </View>
      {!ready ? (
        // Placeholders in the grid's shape while it slides in
        <View style={[styles.skeleton, { paddingHorizontal: margin, gap }]}>
          {Array.from({ length: gridColumns * 2 }, (_, i) => (
            <View key={i} style={[styles.skeletonTile, { width: gridTileW, height: gridTileH }]} />
          ))}
        </View>
      ) : (
      <FlatList
        key={`grid-${gridColumns}`} // column count changes with rotation
        data={videos}
        initialNumToRender={gridColumns * 3}
        maxToRenderPerBatch={gridColumns * 2}
        windowSize={5}
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
      )}
    </Animated.View>
  );
}

// Redraw only when their own props change (opening "See all" doesn't touch them)
const LittleHomeMemo = memo(LittleHome);
const BigHomeMemo = memo(BigHome);

// ── Nothing to show yet ──────────────────────────────────────

// Nothing to watch yet — on a shared device, a way back to "Who's watching?" (a sibling may have videos)
function Empty({
  waitingForChannels,
  layout,
  onSwitchProfile,
}: {
  waitingForChannels: boolean;
  layout: Layout;
  onSwitchProfile?: () => void;
}) {
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
      {onSwitchProfile ? (
        <Tap style={styles.endBtn} onPress={onSwitchProfile} accessibilityLabel="Who's watching?">
          <Text style={styles.endBtnText}>Who's watching?</Text>
        </Tap>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  // little
  band: { flexDirection: "row", alignItems: "flex-start" },
  me: { flexDirection: "row", alignItems: "center", marginTop: 16, paddingRight: 8 },
  meDivider: { width: 2, borderRadius: 1, backgroundColor: colors.surfacePressed, marginLeft: 14 },
  meSwitch: { borderRadius: 20, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
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
  greetRow: { flexDirection: "row", alignItems: "center", paddingTop: 8 },
  greetAvatar: {
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  switchBadge: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.focus,
    alignItems: "center",
    justifyContent: "center",
  },
  switchBadgeText: { color: colors.ink, fontFamily: fonts.bodyHeavy, fontSize: 14, lineHeight: 18 },
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
  page: { backgroundColor: colors.bg, zIndex: 5 },
  skeleton: { flexDirection: "row", flexWrap: "wrap" },
  skeletonTile: { borderRadius: radius.tile, backgroundColor: colors.surface, marginBottom: 56 },
  pageHeader: { flexDirection: "row", alignItems: "center", paddingTop: 12, paddingBottom: 16 },
  pageAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12, backgroundColor: colors.surface },
  pageTitle: { color: colors.text, flexShrink: 1 },

  // empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyEmoji: { fontSize: 72, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 28, textAlign: "center", marginBottom: 10 },
  emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 18, textAlign: "center", lineHeight: 26 },
});
