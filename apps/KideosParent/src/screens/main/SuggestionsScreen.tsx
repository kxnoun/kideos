// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SuggestionsScreen
//
// Suggested channels for one child, one card at a time. Each card is a channel
// profile: what it's about, how many of its analyzed videos fit this child's
// answers, why the rest wouldn't show, and some videos that would.
//
// Swipe left = "Not for us" (never suggested again). Swipe right = "Maybe later"
// (skipped for now). Adding to the kid's feed is only ever a deliberate tap on
// the button — never a swipe.
// ─────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Dimensions,
  Modal,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, SuggestedChannel } from "../../types";
import {
  getChannelSuggestions,
  dismissSuggestion,
  addChannel,
  checkChannel,
  type CheckChannelResult,
} from "../../services/firebase";
import ChannelReview from "../../components/ChannelReview";
import { LEVEL_LABELS } from "../../prefs";
import { DIM_TITLES } from "./VideosScreen";
import KideosNotes from "../../components/KideosNotes";
import { useStore } from "../../store/useStore";

type Props = NativeStackScreenProps<RootStackParamList, "Suggestions">;

const SWIPE = 110;

export default function SuggestionsScreen({ route, navigation }: Props) {
  const { childId, childName } = route.params;
  const user = useStore((s) => s.user);
  const [queue, setQueue] = useState<SuggestedChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false); // checking the channel
  const [review, setReview] = useState<CheckChannelResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;

  const load = useCallback(async () => {
    if (!user) return;
    setQueue(null);
    setError(null);
    try {
      setQueue(await getChannelSuggestions(user.uid, childId));
    } catch {
      setError("Couldn't load suggestions. Check your connection and try again.");
    }
  }, [user, childId]);

  useEffect(() => {
    load();
  }, [load]);

  const current = queue?.[0];

  const next = useCallback(() => {
    pan.setValue({ x: 0, y: 0 });
    setQueue((q) => (q ? q.slice(1) : q));
  }, [pan]);

  const notForUs = useCallback(
    (s: SuggestedChannel) => {
      if (user) dismissSuggestion(user.uid, childId, s.channelId).catch(() => {});
      next();
    },
    [user, childId, next]
  );

  const flyOut = useCallback(
    (dir: -1 | 1) => {
      const s = current;
      Animated.timing(pan, { toValue: { x: dir * Dimensions.get("window").width * 1.2, y: 0 }, duration: 180, useNativeDriver: false }).start(() => {
        if (!s) return;
        if (dir === -1) notForUs(s);
        else next();
      });
    },
    [pan, current, notForUs, next]
  );

  // Horizontal drags only, so the card still scrolls vertically
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -SWIPE) flyRef.current(-1);
        else if (g.dx > SWIPE) flyRef.current(1);
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
    })
  ).current;
  const flyRef = useRef(flyOut);
  flyRef.current = flyOut;

  // Same review as the Channels screen before anything is added (instant if the channel was checked before)
  const add = async (s: SuggestedChannel) => {
    if (!user) return;
    setAdding(true);
    try {
      const result = await checkChannel(user.uid, childId, s.channelId);
      if (result.alreadyAdded) {
        Alert.alert("Already added", `${s.name} is already on the list.`);
        next();
      } else setReview(result);
    } catch {
      Alert.alert("Couldn't check that channel. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  };

  const confirmAdd = async () => {
    if (!user || !review) return;
    setConfirming(true);
    try {
      await addChannel(user.uid, childId, review.channel.channelId);
      const name = review.channel.name;
      setReview(null);
      Alert.alert("Added", `${name} is being added to ${childName}'s feed. Videos that fit your answers will show up in a few minutes.`);
      next();
    } catch {
      Alert.alert("Couldn't add that channel. Check your connection and try again.");
    } finally {
      setConfirming(false);
    }
  };

  const rotate = pan.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ["-8deg", "0deg", "8deg"] });
  const leftHint = pan.x.interpolate({ inputRange: [-SWIPE, -20, 0], outputRange: [1, 0, 0], extrapolate: "clamp" });
  const rightHint = pan.x.interpolate({ inputRange: [0, 20, SWIPE], outputRange: [0, 0, 1], extrapolate: "clamp" });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Channels for {childName}</Text>
        <Text style={styles.sub}>Picked by how well their videos fit your answers.</Text>
      </View>

      {queue === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
          <Text style={styles.centerText}>Finding channels that fit…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : !current ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>✨</Text>
          <Text style={styles.centerText}>
            That's everything for now. New suggestions appear as more channels get checked.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Start over</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Animated.View
            {...responder.panHandlers}
            style={[styles.card, { transform: [{ translateX: pan.x }, { rotate }] }]}
          >
            <Animated.Text style={[styles.stamp, styles.stampLeft, { opacity: leftHint }]}>NOT FOR US</Animated.Text>
            <Animated.Text style={[styles.stamp, styles.stampRight, { opacity: rightHint }]}>MAYBE LATER</Animated.Text>
            <SuggestionCard s={current} childName={childName} />
          </Animated.View>

          <Text style={styles.swipeHint}>Swipe left: not for us · Swipe right: maybe later</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => flyOut(-1)} disabled={adding}>
              <Text style={styles.skipText}>Not for us</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addBtn, adding && { opacity: 0.6 }]} onPress={() => add(current)} disabled={adding}>
              {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.addText}>Add to {childName}'s feed</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal visible={!!review} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReview(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          <View style={{ flex: 1, padding: 24 }}>
            <Text style={styles.heading}>Before you add it</Text>
            {review ? (
              <ChannelReview
                result={review}
                childName={childName}
                confirming={confirming}
                onConfirm={confirmAdd}
                onCancel={() => setReview(null)}
              />
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SuggestionCard({ s, childName }: { s: SuggestedChannel; childName: string }) {
  const pct = s.analyzed ? s.fitting / s.analyzed : 0;
  const hidden = s.analyzed - s.fitting;
  return (
    <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false}>
      <View style={styles.channelRow}>
        {s.thumbnail ? <Image source={{ uri: s.thumbnail }} style={styles.avatar} /> : <View style={styles.avatar} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{s.name}</Text>
          {s.handle ? <Text style={styles.handle}>{s.handle}</Text> : null}
        </View>
      </View>

      {/* No AI-guessed ages, topic labels, scores or percentages on screen (YouTube API policy:
          no audience estimates, inferred categories or custom channel scores) — only how the
          videos compare with THIS parent's settings, in words. Ages / topics still steer which
          channels are suggested, in code. */}
      <Text style={styles.overview}>{s.overview}</Text>

      <View style={[styles.fitBox, pct < 0.75 && styles.fitBoxWarn]}>
        <Text style={[styles.fitTitle, pct < 0.75 && styles.fitTitleWarn]}>
          {hidden === 0
            ? `All the ${s.longOnly ? "long videos" : "videos"} we checked match ${childName}'s settings`
            : `Most of the ${s.longOnly ? "long videos" : "videos"} we checked match ${childName}'s settings`}
        </Text>
        {hidden > 0 && s.hiddenReasons.length ? (
          <Text style={styles.hiddenText}>
            Some would be hidden, mostly for: {s.hiddenReasons.map((r) => r.label).join(", ")}
          </Text>
        ) : null}
        {s.shorts ? <Text style={styles.uncheckedText}>Its Shorts are checked separately.</Text> : null}
        {s.unchecked > 0 ? (
          <Text style={styles.uncheckedText}>Some had no transcript, so we couldn't check them.</Text>
        ) : null}
      </View>

      {s.check ? (
        s.check.thingsToKnow.length ? (
          <View style={styles.checkBox}>
            <Text style={styles.checkTitle}>
              ⚠️ {s.check.thingsToKnow.length} {s.check.thingsToKnow.length === 1 ? "thing" : "things"} to know (thumbnails
              + what people say, against {childName}'s settings)
            </Text>
            {s.check.thingsToKnow.map((t, i) => (
              <Text key={i} style={styles.checkText}>
                • {t}
              </Text>
            ))}
          </View>
        ) : (
          <View style={[styles.checkBox, styles.checkBoxGood]}>
            <Text style={[styles.checkTitle, styles.checkTitleGood]}>
              ✅ Thumbnails and what people say match {childName}'s settings
            </Text>
          </View>
        )
      ) : null}

      {s.severe > 0 ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            ⚠ {s.severe === 1 ? "A video has" : "A few videos have"} very strong content:{" "}
            {s.severeLabels.map((l) => l.label).join(", ")}. Those would be hidden, but it's worth knowing before you add
            this channel.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>In the videos that would show</Text>
      {s.ratings.length ? (
        <View style={styles.chips}>
          {s.ratings.slice(0, 8).map((r) => (
            <View key={r.dim} style={styles.chip}>
              <Text style={styles.chipText}>
                {DIM_TITLES[r.dim] ?? r.dim}: up to {LEVEL_LABELS[r.dim]?.[r.maxLevel] ?? r.maxLevel}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.cleanText}>Nothing on any of your lists</Text>
      )}

      {s.samples.length ? (
        <>
          <Text style={styles.sectionLabel}>Some videos {childName} would see</Text>
          {s.samples.map((v) => (
            <View key={v.videoId} style={styles.sample}>
              {v.thumbnail ? <Image source={{ uri: v.thumbnail }} style={styles.sampleThumb} /> : <View style={styles.sampleThumb} />}
              <Text style={styles.sampleTitle} numberOfLines={2}>
                {v.title}
              </Text>
            </View>
          ))}
        </>
      ) : null}
      <KideosNotes style={{ marginTop: 14 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: "#6C63FF", fontWeight: "600", marginBottom: 8 },
  heading: { fontSize: 26, fontWeight: "800", color: "#1A1A2E" },
  sub: { fontSize: 14, color: "#888", marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  centerText: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginTop: 12 },
  emptyEmoji: { fontSize: 40 },
  retryBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: "#6C63FF" },
  retryText: { color: "#6C63FF", fontWeight: "700" },
  card: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E8E8F0",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    overflow: "hidden",
  },
  cardContent: { padding: 18, paddingBottom: 28 },
  stamp: {
    position: "absolute",
    top: 18,
    zIndex: 2,
    fontSize: 16,
    fontWeight: "900",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 2,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  stampLeft: { right: 18, color: "#D9534F", borderColor: "#D9534F" },
  stampRight: { left: 18, color: "#888", borderColor: "#888" },
  channelRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#E8E8F0", marginRight: 12 },
  name: { fontSize: 20, fontWeight: "800", color: "#1A1A2E" },
  handle: { fontSize: 13, color: "#888", marginTop: 2 },
  ageChip: { alignSelf: "flex-start", backgroundColor: "#1A1A2E", borderRadius: 10, paddingVertical: 3, paddingHorizontal: 9, marginBottom: 10 },
  ageText: { fontSize: 12, color: "#fff", fontWeight: "700" },
  overview: { fontSize: 15, color: "#333", lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  topicChip: { backgroundColor: "#EEEDFF", borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 6 },
  topicText: { fontSize: 12, color: "#6C63FF", fontWeight: "600" },
  chip: { backgroundColor: "#F0F0F5", borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 6 },
  chipText: { fontSize: 12, color: "#555" },
  fitBox: { backgroundColor: "#F4FBF6", borderRadius: 12, padding: 12, marginTop: 14 },
  checkBox: { backgroundColor: "#FFF6E0", borderRadius: 12, padding: 12, marginTop: 12 },
  checkBoxGood: { backgroundColor: "#E8F5E9" },
  checkTitle: { fontSize: 14, fontWeight: "800", color: "#8A5A00", marginBottom: 4 },
  checkTitleGood: { color: "#2E7D32", marginBottom: 0 },
  checkText: { fontSize: 13, color: "#6B4600", lineHeight: 19, marginTop: 2 },
  fitTitle: { fontSize: 16, fontWeight: "800", color: "#1E7A44" },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, backgroundColor: "#DDEFE3", overflow: "hidden", marginTop: 8 },
  barFill: { backgroundColor: "#2EAD5F" },
  // Suggestions are ≥75% by rule; amber is a safety net so a weak channel never looks green
  fitBoxWarn: { backgroundColor: "#FFF8EC" },
  fitTitleWarn: { color: "#A86200" },
  barFillWarn: { backgroundColor: "#E59A1F" },
  warnBox: { backgroundColor: "#FFF4F4", borderRadius: 12, padding: 12, marginTop: 10 },
  warnText: { fontSize: 13, color: "#B23B3B", lineHeight: 19, fontWeight: "600" },
  uncheckedText: { fontSize: 12, color: "#888", marginTop: 4 },
  hiddenText: { fontSize: 13, color: "#555", marginTop: 8, lineHeight: 19 },
  sectionLabel: { fontSize: 13, fontWeight: "800", color: "#1A1A2E", marginTop: 18, textTransform: "uppercase", letterSpacing: 0.5 },
  cleanText: { fontSize: 13, color: "#888", marginTop: 6 },
  sample: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  sampleThumb: { width: 96, height: 54, borderRadius: 8, backgroundColor: "#E8E8F0", marginRight: 10 },
  sampleTitle: { flex: 1, fontSize: 14, color: "#333" },
  swipeHint: { textAlign: "center", fontSize: 12, color: "#999", marginTop: 10 },
  actions: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },
  skipBtn: { flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: "center", borderWidth: 1, borderColor: "#D0D0DA", marginRight: 10, backgroundColor: "#fff" },
  skipText: { fontSize: 15, fontWeight: "700", color: "#666" },
  addBtn: { flex: 1.6, borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: "#6C63FF" },
  addText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
