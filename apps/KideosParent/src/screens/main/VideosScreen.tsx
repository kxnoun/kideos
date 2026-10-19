// ─────────────────────────────────────────────────────────────
// Kideos for Parents — VideosScreen
//
// Everything analyzed for one child, split into Shown and Hidden, with what each
// video contains and (for hidden ones) why, in plain words. Parents come here
// when they want to — nothing here needs action. "Show anyway" sits behind a
// confirmation screen so it can't be tapped by accident.
// Tap a video → details sheet (summary, each rating with its evidence, actions).
// Shown tab: "Hide" per video, or Select → tick several → "Hide N videos".
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Modal,
  ScrollView,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList, VideoVerdict, Dim } from "../../types";
import {
  subscribeToVerdicts,
  setShowAnyway,
  hideVideo,
  hideVideos,
  reportTooHyper,
  getVideoSummary,
} from "../../services/firebase";
import { LEVEL_LABELS } from "../../prefs";
import { useStore } from "../../store/useStore";
import VideoPreview from "../../components/VideoPreview";

type Props = NativeStackScreenProps<RootStackParamList, "Videos">;

export const DIM_TITLES: Record<Dim, string> = {
  violence: "Violence",
  scary: "Scary",
  language: "Language",
  romance: "Romance",
  sexual: "Sexual references",
  substances: "Substances",
  dangerous: "Stunts",
  selfHarm: "Self-harm",
  meanness: "Meanness",
  consumerism: "Selling",
  politics: "Politics",
  religion: "Religion",
  gambling: "Gambling",
  stimulation: "Pace",
  junk: "Junk",
  crudeHumor: "Crude humor",
  matureThemes: "Mature themes",
  misinformation: "Misinformation",
  nudity: "Nudity",
};

function RatingChips({ v }: { v: VideoVerdict }) {
  const entries = Object.entries(v.ratings ?? {}) as [Dim, { level: number | null }][];
  if (!entries.length) {
    return <Text style={styles.noRatings}>{v.status === "approved" ? "Nothing on any of your lists" : ""}</Text>;
  }
  return (
    <View style={styles.chips}>
      {entries.map(([dim, r]) => (
        <View key={dim} style={styles.chip}>
          <Text style={styles.chipText}>
            {DIM_TITLES[dim] ?? dim}: {r.level === null ? "can't tell" : LEVEL_LABELS[dim]?.[r.level] ?? r.level}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function VideosScreen({ route, navigation }: Props) {
  const { childId, childName } = route.params;
  const user = useStore((s) => s.user);
  const [verdicts, setVerdicts] = useState<VideoVerdict[]>([]);
  const [tab, setTab] = useState<"shown" | "hidden">("shown");
  const [confirming, setConfirming] = useState<VideoVerdict | null>(null);
  const [details, setDetails] = useState<VideoVerdict | null>(null); // "learn more" sheet
  const [detailsSummary, setDetailsSummary] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    return subscribeToVerdicts(user.uid, childId, setVerdicts);
  }, [user, childId]);

  const shown = useMemo(() => verdicts.filter((v) => v.approved), [verdicts]);
  const hidden = useMemo(() => verdicts.filter((v) => !v.approved), [verdicts]);
  const list = tab === "shown" ? shown : hidden;

  useEffect(() => {
    setDetailsSummary("");
    if (details) getVideoSummary(details.videoId).then(setDetailsSummary);
  }, [details]);
  // keep the open sheet in step with live data (e.g. after Hide / Undo)
  const detailsLive = details ? verdicts.find((v) => v.videoId === details.videoId) ?? details : null;

  const hideOne = async (v: VideoVerdict) => {
    if (!user) return;
    try {
      await hideVideo(user.uid, childId, v.videoId);
    } catch {
      Alert.alert("Couldn't hide it. Check your connection.");
    }
  };

  const tooHyper = async (v: VideoVerdict) => {
    if (!user) return;
    try {
      await reportTooHyper(user.uid, childId, v.videoId);
    } catch {
      Alert.alert("Couldn't hide it. Check your connection.");
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const hideSelected = async () => {
    if (!user || !selected.size) return;
    try {
      await hideVideos(user.uid, childId, [...selected]);
      stopSelecting();
    } catch {
      Alert.alert("Couldn't hide those. Check your connection.");
    }
  };

  const change = async (v: VideoVerdict, show: boolean) => {
    if (!user) return;
    try {
      await setShowAnyway(user.uid, childId, v, show);
    } catch {
      Alert.alert("Couldn't save that. Check your connection.");
    }
  };

  const renderItem = ({ item: v }: { item: VideoVerdict }) => {
    const overridden = v.parentDecision === "approved";
    const hiddenByYou = v.parentDecision === "hidden";
    const isSelected = selected.has(v.videoId);
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.card, isSelected && styles.cardSelected]}
        onPress={() => (selecting ? toggleSelected(v.videoId) : setDetails(v))}
      >
        <View style={styles.row}>
          {selecting ? (
            <View style={[styles.check, isSelected && styles.checkOn]}>
              {isSelected ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
          ) : null}
          {v.thumbnail ? <Image source={{ uri: v.thumbnail }} style={styles.thumb} /> : <View style={styles.thumb} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {v.title}
            </Text>
            {v.channelName ? <Text style={styles.channel}>{v.channelName}</Text> : null}
          </View>
        </View>

        <RatingChips v={v} />

        {!v.approved && v.reason ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonTitle}>Why it's hidden</Text>
            {v.reason.split("; ").map((r, i) => (
              <Text key={i} style={styles.reason}>
                • {r}
              </Text>
            ))}
          </View>
        ) : null}

        {overridden ? (
          <View style={styles.footer}>
            <Text style={styles.overrideNote}>Shown because you allowed it</Text>
            <TouchableOpacity onPress={() => change(v, false)} hitSlop={8}>
              <Text style={styles.linkText}>Undo</Text>
            </TouchableOpacity>
          </View>
        ) : hiddenByYou ? (
          <View style={styles.footer}>
            <Text style={styles.overrideNote}>You hid this</Text>
            <TouchableOpacity onPress={() => change(v, false)} hitSlop={8}>
              <Text style={styles.linkText}>Undo</Text>
            </TouchableOpacity>
          </View>
        ) : !v.approved ? (
          <View style={styles.footer}>
            <View />
            <TouchableOpacity onPress={() => setConfirming(v)} hitSlop={8}>
              <Text style={styles.showAnyway}>Show anyway…</Text>
            </TouchableOpacity>
          </View>
        ) : !selecting ? (
          <View style={styles.footer}>
            <Text style={styles.detailsHint}>Details ›</Text>
            <TouchableOpacity onPress={() => hideOne(v)} hitSlop={8}>
              <Text style={styles.hideLink}>Hide</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{childName}'s videos</Text>
          {tab === "shown" && shown.length ? (
            <TouchableOpacity onPress={selecting ? stopSelecting : () => setSelecting(true)} hitSlop={8}>
              <Text style={styles.selectText}>{selecting ? "Cancel" : "Select"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {(["shown", "hidden"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => {
                stopSelecting();
                setTab(t);
              }}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === "shown" ? `Shown (${shown.length})` : `Hidden (${hidden.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(v) => v.videoId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === "shown"
              ? "Nothing here yet. Videos appear once a channel finishes analyzing."
              : `Nothing hidden — everything so far fits your answers for ${childName}.`}
          </Text>
        }
      />

      {selecting ? (
        <View style={styles.selectBar}>
          <TouchableOpacity
            style={[styles.selectBarBtn, !selected.size && { opacity: 0.4 }]}
            disabled={!selected.size}
            onPress={hideSelected}
          >
            <Text style={styles.selectBarText}>
              {selected.size ? `Hide ${selected.size} video${selected.size === 1 ? "" : "s"}` : "Tap videos to select"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Details ("learn more") */}
      <Modal visible={!!detailsLive} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetails(null)}>
        {detailsLive && (
          <SafeAreaView style={styles.modal}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <TouchableOpacity onPress={() => setDetails(null)} hitSlop={10} style={{ alignSelf: "flex-end" }}>
                <Text style={styles.linkText}>Done</Text>
              </TouchableOpacity>
              {detailsLive.thumbnail ? (
                <VideoPreview
                  key={detailsLive.videoId}
                  videoId={detailsLive.videoId}
                  thumbnail={detailsLive.thumbnail}
                  style={styles.detailsThumb}
                />
              ) : null}
              <Text style={styles.modalHeading}>{detailsLive.title}</Text>
              {detailsLive.channelName ? (
                <Text style={styles.channel}>
                  {detailsLive.channelName}
                  {detailsLive.madeForKids ? " · Made for kids" : ""}
                </Text>
              ) : null}
              {detailsSummary ? <Text style={styles.detailsSummary}>{detailsSummary}</Text> : null}
              {detailsLive.basis === "metadata" ? (
                <Text style={styles.detailsRating}>
                  No captions — rated from the title, description and a few still images, so less sure than usual.
                </Text>
              ) : null}

              <Text style={[styles.detailsStatus, !detailsLive.approved && styles.detailsStatusHidden]}>
                {detailsLive.parentDecision === "approved"
                  ? "Shown because you allowed it"
                  : detailsLive.parentDecision === "hidden"
                  ? "Hidden — you hid this"
                  : detailsLive.approved
                  ? `✓ Fits all of ${childName}'s settings`
                  : "Hidden by your settings"}
              </Text>
              {!detailsLive.approved && detailsLive.reason ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonTitle}>Why it's hidden</Text>
                  {detailsLive.reason.split("; ").map((r, i) => (
                    <Text key={i} style={styles.reason}>
                      • {r}
                    </Text>
                  ))}
                </View>
              ) : null}

              <Text style={styles.detailsSection}>What's in it</Text>
              {Object.keys(detailsLive.ratings ?? {}).length ? (
                (Object.entries(detailsLive.ratings ?? {}) as [Dim, { level: number | null; evidence: string }][]).map(
                  ([dim, r]) => (
                    <Text key={dim} style={styles.detailsRating}>
                      <Text style={{ fontWeight: "700", color: "#333" }}>
                        {DIM_TITLES[dim] ?? dim}: {r.level === null ? "can't tell" : LEVEL_LABELS[dim]?.[r.level] ?? r.level}
                      </Text>
                      {r.evidence ? ` — "${r.evidence}"` : ""}
                    </Text>
                  )
                )
              ) : (
                <Text style={styles.detailsRating}>Nothing on any of your lists</Text>
              )}

              <View style={{ marginTop: 20 }}>
                {detailsLive.parentDecision ? (
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => change(detailsLive, false)}>
                    <Text style={styles.cancelText}>
                      {detailsLive.parentDecision === "hidden" ? "Undo — show it again" : "Undo — hide it again"}
                    </Text>
                  </TouchableOpacity>
                ) : detailsLive.approved ? (
                  <>
                    <TouchableOpacity style={styles.confirmBtn} onPress={() => hideOne(detailsLive)}>
                      <Text style={styles.confirmText}>Hide this video</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.hyperBtn} onPress={() => tooHyper(detailsLive)} hitSlop={8}>
                      <Text style={styles.hyperText}>Too hyper? Hide it and tell us</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() => {
                      const v = detailsLive;
                      setDetails(null);
                      setConfirming(v);
                    }}
                  >
                    <Text style={styles.confirmText}>Show anyway…</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      {/* Confirmation screen for "Show anyway" */}
      <Modal visible={!!confirming} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setConfirming(null)}>
        {confirming && (
          <SafeAreaView style={styles.modal}>
            <Text style={styles.modalHeading}>Show this video to {childName}?</Text>
            <Text style={styles.modalVideo}>{confirming.title}</Text>
            <View style={styles.reasonBox}>
              <Text style={styles.reasonTitle}>It was hidden because</Text>
              {confirming.reason.split("; ").map((r, i) => (
                <Text key={i} style={styles.reason}>
                  • {r}
                </Text>
              ))}
            </View>
            <Text style={styles.modalNote}>
              Only this one video will appear in {childName}'s feed. Your answers stay the same, and you can undo
              this anytime from the Shown tab.
            </Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirming(null)}>
              <Text style={styles.cancelText}>Keep it hidden</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={async () => {
                const v = confirming;
                setConfirming(null);
                await change(v, true);
              }}
            >
              <Text style={styles.confirmText}>Yes, show it to {childName}</Text>
            </TouchableOpacity>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: "#6C63FF", fontWeight: "600", marginBottom: 8 },
  heading: { fontSize: 26, fontWeight: "800", color: "#1A1A2E", marginBottom: 12 },
  tabs: { flexDirection: "row", backgroundColor: "#E8E8F0", borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 14, fontWeight: "600", color: "#888" },
  tabTextActive: { color: "#1A1A2E" },
  list: { padding: 20, paddingBottom: 48 },
  empty: { textAlign: "center", color: "#888", marginTop: 40, fontSize: 15, lineHeight: 22 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  selectText: { fontSize: 15, fontWeight: "700", color: "#6C63FF", marginBottom: 12 },
  cardSelected: { borderColor: "#6C63FF", backgroundColor: "#F4F3FF" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#C9C6F5",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  checkOn: { backgroundColor: "#6C63FF", borderColor: "#6C63FF" },
  checkMark: { color: "#fff", fontWeight: "900", fontSize: 13 },
  detailsHint: { fontSize: 12, color: "#999", fontWeight: "600" },
  hideLink: { fontSize: 13, color: "#B23B3B", fontWeight: "700" },
  selectBar: { padding: 16, borderTopWidth: 1, borderTopColor: "#E8E8F0", backgroundColor: "#fff" },
  selectBarBtn: { backgroundColor: "#D9534F", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  selectBarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  detailsThumb: { borderRadius: 12, marginTop: 12 },
  detailsSummary: { fontSize: 15, color: "#333", lineHeight: 22, marginTop: 12 },
  detailsStatus: { fontSize: 14, fontWeight: "800", color: "#1E7A44", marginTop: 16, marginBottom: 6 },
  detailsStatusHidden: { color: "#B23B3B" },
  detailsSection: { fontSize: 13, fontWeight: "800", color: "#1A1A2E", marginTop: 16, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  detailsRating: { fontSize: 13, color: "#666", lineHeight: 19, marginBottom: 6 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#E8E8F0" },
  row: { flexDirection: "row", marginBottom: 10 },
  thumb: { width: 112, height: 63, borderRadius: 8, backgroundColor: "#E8E8F0", marginRight: 12 },
  title: { fontSize: 15, fontWeight: "700", color: "#1A1A2E" },
  channel: { fontSize: 12, color: "#888", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  chip: { backgroundColor: "#F0F0F5", borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 6 },
  chipText: { fontSize: 12, color: "#555" },
  noRatings: { fontSize: 12, color: "#999" },
  reasonBox: { backgroundColor: "#FFF4F4", borderRadius: 10, padding: 10, marginTop: 6 },
  reasonTitle: { fontSize: 12, fontWeight: "800", color: "#B23B3B", marginBottom: 4 },
  reason: { fontSize: 13, color: "#444", lineHeight: 19 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  overrideNote: { fontSize: 12, color: "#6C63FF", fontWeight: "600" },
  linkText: { fontSize: 13, color: "#6C63FF", fontWeight: "700" },
  showAnyway: { fontSize: 13, color: "#999", fontWeight: "600" },
  modal: { flex: 1, backgroundColor: "#F7F7FF", padding: 24 },
  modalHeading: { fontSize: 22, fontWeight: "800", color: "#1A1A2E", marginTop: 12, marginBottom: 10 },
  modalVideo: { fontSize: 16, fontWeight: "600", color: "#333", marginBottom: 12 },
  modalNote: { fontSize: 14, color: "#666", lineHeight: 20, marginVertical: 16 },
  cancelBtn: { backgroundColor: "#6C63FF", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 12 },
  cancelText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  confirmBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#D9534F" },
  confirmText: { color: "#D9534F", fontSize: 15, fontWeight: "700" },
  hyperBtn: { alignItems: "center", paddingVertical: 12 },
  hyperText: { color: "#6C63FF", fontSize: 14, fontWeight: "600" },
});
