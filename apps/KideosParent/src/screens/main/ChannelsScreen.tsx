// ─────────────────────────────────────────────────────────────
// Kideos for Parents — ChannelsScreen
//
// Manages the whitelisted channel list for the selected child.
// - Shows all whitelisted channels with seeding status
// - Lets parent add channels by URL / @handle
// - Shows pending AI channel suggestions
// - Long-press to remove a channel
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
} from "react-native";
import type { WhitelistedChannel, ChannelSuggestion } from "../../types";
import {
  subscribeToWhitelistedChannels,
  subscribeToChannelSuggestions,
  addChannel,
  checkChannel,
  getChannelFits,
  loadMoreVideos,
  type CheckChannelResult,
  type ChannelFit,
  removeChannel,
  respondToSuggestion,
} from "../../services/firebase";
import { useStore, useSelectedChild } from "../../store/useStore";
import ChannelReview from "../../components/ChannelReview";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Analyzing…", color: "#FF9800" },
  ready: { label: "Ready", color: "#4CAF50" },
  error: { label: "Error", color: "#FF5252" },
};

export default function ChannelsScreen() {
  const user = useStore((s) => s.user);
  const selectedChildId = useStore((s) => s.selectedChildId);
  const selectedChild = useSelectedChild();

  const [channels, setChannels] = useState<WhitelistedChannel[]>([]);
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false); // checking the channel
  const [review, setReview] = useState<CheckChannelResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [fromSuggestion, setFromSuggestion] = useState<string | null>(null); // old AI suggestion being added
  const [fits, setFits] = useState<Record<string, ChannelFit>>({});

  const parentId = user?.uid;
  const closeAdd = () => {
    setAddModalVisible(false);
    setReview(null);
    setFromSuggestion(null);
  };

  // Saved channel checks vs the child's CURRENT settings (refreshed when the tab is opened,
  // e.g. after changing filters in Settings, and when the channel list changes)
  const channelIdsKey = useMemo(() => channels.map((c) => c.channelId).sort().join(","), [channels]);
  const loadFits = useCallback(() => {
    if (!parentId || !selectedChildId) return;
    getChannelFits(parentId, selectedChildId)
      .then(setFits)
      .catch(() => {});
  }, [parentId, selectedChildId]);
  useFocusEffect(loadFits);
  useEffect(loadFits, [loadFits, channelIdsKey]);

  const moreVideos = (channel: WhitelistedChannel) => {
    if (!parentId || !selectedChildId) return;
    Alert.alert(
      "Load more videos?",
      `We'll check ${channel.name}'s next 20 older videos. Ones that fit ${selectedChild?.profile.name ?? "your child"}'s settings show up in a few minutes.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Load more",
          onPress: async () => {
            try {
              const r = await loadMoreVideos(parentId, selectedChildId, channel.channelId);
              const msg: Record<string, [string, string]> = {
                no_more: ["That's everything", `We've already checked all of ${channel.name}'s videos.`],
                busy: ["Still working", `${channel.name} is still being analyzed — try again in a few minutes.`],
                enough: ["Plenty already", `${channel.name} already has 20 or more videos in the feed.`],
                today: ["Once a day", `You loaded more from ${channel.name} today — try again tomorrow.`],
                daily_limit: ["That's today's limit", "You can load more videos for up to 10 channels a day. Try again tomorrow."],
              };
              if (r.reason && msg[r.reason]) Alert.alert(...msg[r.reason]);
            } catch {
              Alert.alert("Couldn't do that", "Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const showFit = (name: string, f: ChannelFit) =>
    Alert.alert(
      f.fit === "not_fit" ? `${name}: not a fit anymore` : `${name}: things to know`,
      `With ${selectedChild?.profile.name ?? "your child"}'s current settings:\n\n${f.conflicts.map((c) => `• ${c}`).join("\n")}\n\nVideos past the settings are hidden either way.`
    );

  useEffect(() => {
    if (!parentId || !selectedChildId) return;
    const unsub1 = subscribeToWhitelistedChannels(
      parentId,
      selectedChildId,
      setChannels
    );
    const unsub2 = subscribeToChannelSuggestions(
      parentId,
      selectedChildId,
      setSuggestions
    );
    return () => {
      unsub1();
      unsub2();
    };
  }, [parentId, selectedChildId]);

  // Step 1: check the channel and show the review (nothing is added yet)
  const handleAdd = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !parentId || !selectedChildId) return;
    setAdding(true);
    try {
      const result = await checkChannel(parentId, selectedChildId, trimmed);
      if (result.alreadyAdded) Alert.alert("Already added", `${result.channel.name} is already on the list.`);
      else setReview(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not find that channel.";
      Alert.alert("Not Found", msg);
    } finally {
      setAdding(false);
    }
  }, [input, parentId, selectedChildId]);

  // Step 2: the parent confirmed
  const confirmAdd = useCallback(async () => {
    if (!review || !parentId || !selectedChildId) return;
    setConfirming(true);
    try {
      // An old AI suggestion is marked approved (which also adds it)
      if (fromSuggestion === review.channel.channelId) {
        await respondToSuggestion(parentId, selectedChildId, review.channel.channelId, "approved");
      } else {
        await addChannel(parentId, selectedChildId, review.channel.channelId);
      }
      setInput("");
      closeAdd();
    } catch (e: unknown) {
      Alert.alert("Couldn't add it", e instanceof Error ? e.message : "Check your connection.");
    } finally {
      setConfirming(false);
    }
  }, [review, parentId, selectedChildId, fromSuggestion]);

  const handleRemove = useCallback(
    (channel: WhitelistedChannel) => {
      Alert.alert(
        "Remove Channel",
        `Remove "${channel.name}" from ${selectedChild?.profile.name ?? "this child"}'s list?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              if (!parentId || !selectedChildId) return;
              await removeChannel(parentId, selectedChildId, channel.channelId);
            },
          },
        ]
      );
    },
    [parentId, selectedChildId, selectedChild]
  );

  const handleSuggestion = useCallback(
    async (suggestion: ChannelSuggestion, response: "approved" | "denied") => {
      if (!parentId || !selectedChildId) return;
      // Adding goes through the same channel check review as typing a channel in
      if (response === "approved") {
        setInput(suggestion.channelName);
        setFromSuggestion(suggestion.channelId);
        setAddModalVisible(true);
        setAdding(true);
        try {
          const result = await checkChannel(parentId, selectedChildId, suggestion.channelId);
          if (result.alreadyAdded) {
            closeAdd();
            Alert.alert("Already added", `${result.channel.name} is already on the list.`);
          } else setReview(result);
        } catch (e: unknown) {
          closeAdd();
          Alert.alert("Error", e instanceof Error ? e.message : "Couldn't check that channel.");
        } finally {
          setAdding(false);
        }
        return;
      }
      try {
        await respondToSuggestion(
          parentId,
          selectedChildId,
          suggestion.channelId,
          response
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Action failed.";
        Alert.alert("Error", msg);
      }
    },
    [parentId, selectedChildId]
  );

  const renderChannel = ({ item }: { item: WhitelistedChannel }) => {
    const status = STATUS_LABELS[item.seedingStatus] ?? STATUS_LABELS.pending;
    return (
      <TouchableOpacity
        style={styles.channelCard}
        onLongPress={() => handleRemove(item)}
        activeOpacity={0.85}
      >
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.channelThumb}
          />
        ) : (
          <View style={[styles.channelThumb, styles.channelThumbPlaceholder]}>
            <Text style={styles.channelThumbPlaceholderText}>📺</Text>
          </View>
        )}
        <View style={styles.channelInfo}>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.channelMeta}>
            <View
              style={[styles.statusDot, { backgroundColor: status.color }]}
            />
            <Text style={[styles.statusLabel, { color: status.color }]}>
              {status.label}
            </Text>
            {item.seedingStatus === "ready" && (
              <Text style={styles.videoCount}> · {item.videoCount} videos</Text>
            )}
          </View>
          {/* Only when it'd help: fewer than 20 videos shown, YouTube has more, not already today */}
          {item.seedingStatus === "ready" && item.videoCount < 20 && !item.moreExhausted ? (
            item.moreRequestedAt && Date.now() - item.moreRequestedAt.toMillis() < 24 * 60 * 60 * 1000 ? (
              <Text style={styles.moreDone}>More videos available tomorrow</Text>
            ) : (
              <TouchableOpacity onPress={() => moreVideos(item)} hitSlop={6}>
                <Text style={styles.moreLink}>＋ Load more videos</Text>
              </TouchableOpacity>
            )
          ) : null}
          {fits[item.channelId] && fits[item.channelId].fit !== "good" ? (
            <TouchableOpacity onPress={() => showFit(item.name, fits[item.channelId])} hitSlop={6}>
              <Text style={[styles.fitBadge, fits[item.channelId].fit === "not_fit" && styles.fitBadgeBad]}>
                {fits[item.channelId].fit === "not_fit"
                  ? "⛔ Not a fit with current settings"
                  : `⚠️ ${fits[item.channelId].conflicts.length} ${fits[item.channelId].conflicts.length === 1 ? "thing" : "things"} to know`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.removeHint}>hold to remove</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />

      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Channels</Text>
          {selectedChild && (
            <Text style={styles.subheading}>
              {selectedChild.profile.avatar} {selectedChild.profile.name}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setAddModalVisible(true)}
        >
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionsSection}>
          <Text style={styles.suggestionsTitle}>
            ✨ AI Suggestions for {selectedChild?.profile.name}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {suggestions.map((s) => (
              <View key={s.channelId} style={styles.suggestionCard}>
                {s.thumbnail ? (
                  <Image
                    source={{ uri: s.thumbnail }}
                    style={styles.suggestionThumb}
                  />
                ) : (
                  <View style={[styles.suggestionThumb, styles.channelThumbPlaceholder]}>
                    <Text>📺</Text>
                  </View>
                )}
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {s.channelName}
                </Text>
                <Text style={styles.suggestionReason} numberOfLines={2}>
                  {s.reason}
                </Text>
                <View style={styles.suggestionActions}>
                  <TouchableOpacity
                    style={styles.denyBtn}
                    onPress={() => handleSuggestion(s, "denied")}
                  >
                    <Text style={styles.denyBtnText}>✕</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => handleSuggestion(s, "approved")}
                  >
                    <Text style={styles.approveBtnText}>✓ Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Channel list */}
      {channels.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📺</Text>
          <Text style={styles.emptyTitle}>No channels yet</Text>
          <Text style={styles.emptyText}>
            Add a YouTube channel by URL or @handle and our AI will start
            analyzing videos automatically.
          </Text>
          <TouchableOpacity
            style={styles.emptyAddBtn}
            onPress={() => setAddModalVisible(true)}
          >
            <Text style={styles.emptyAddBtnText}>+ Add First Channel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={channels}
          renderItem={renderChannel}
          keyExtractor={(item) => item.channelId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add Channel Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAdd}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{review ? "Before you add it" : "Add Channel"}</Text>
            <TouchableOpacity onPress={closeAdd}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {review ? (
            <View style={[styles.modalContent, { flex: 1 }]}>
              <ChannelReview
                result={review}
                childName={selectedChild?.profile.name ?? "your child"}
                confirming={confirming}
                onConfirm={confirmAdd}
                onCancel={() => setReview(null)}
              />
            </View>
          ) : (
          <View style={styles.modalContent}>
            <Text style={styles.modalSub}>
              Paste a YouTube channel URL, @handle, or channel name. Our AI
              will analyze every video and only show the approved ones.
            </Text>
            <Text style={styles.exampleLabel}>Examples:</Text>
            {[
              "youtube.com/@NationalGeographic",
              "@SciShow",
              "SciShow",
            ].map((ex) => (
              <TouchableOpacity key={ex} onPress={() => setInput(ex)}>
                <Text style={styles.example}>{ex}</Text>
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.modalInput}
              value={input}
              onChangeText={setInput}
              placeholder="Paste URL or @handle"
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.confirmBtn, adding && styles.btnDisabled]}
              onPress={handleAdd}
              disabled={adding}
            >
              {adding ? (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={[styles.confirmBtnText, { marginLeft: 10 }]}>Checking the channel…</Text>
                </View>
              ) : (
                <Text style={styles.confirmBtnText}>Check & Add</Text>
              )}
            </TouchableOpacity>
          </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  heading: { fontSize: 28, fontWeight: "800", color: "#1A1A2E" },
  subheading: { fontSize: 14, color: "#888", marginTop: 2 },
  addBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  suggestionsSection: { paddingLeft: 20, marginBottom: 16 },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
  },
  suggestionCard: {
    width: 160,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginRight: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  suggestionThumb: {
    width: "100%",
    height: 90,
    borderRadius: 8,
    backgroundColor: "#E0E0FF",
    marginBottom: 8,
  },
  suggestionName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 4,
  },
  suggestionReason: { fontSize: 11, color: "#888", lineHeight: 16, marginBottom: 10 },
  suggestionActions: { flexDirection: "row", gap: 8 },
  denyBtn: {
    flex: 1,
    backgroundColor: "#FFF0F0",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  denyBtnText: { fontSize: 14, color: "#FF5252", fontWeight: "700" },
  approveBtn: {
    flex: 2,
    backgroundColor: "#6C63FF",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  approveBtnText: { fontSize: 13, color: "#fff", fontWeight: "700" },

  list: { paddingHorizontal: 20, paddingBottom: 24 },
  channelCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 12,
  },
  channelThumb: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E0E0FF",
  },
  channelThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  channelThumbPlaceholderText: { fontSize: 24 },
  channelInfo: { flex: 1 },
  channelName: { fontSize: 15, fontWeight: "700", color: "#1A1A2E", marginBottom: 4 },
  channelMeta: { flexDirection: "row", alignItems: "center" },
  fitBadge: { fontSize: 12, fontWeight: "700", color: "#8A5A00", marginTop: 4 },
  moreLink: { fontSize: 12, fontWeight: "700", color: "#6C63FF", marginTop: 4 },
  moreDone: { fontSize: 12, color: "#999", marginTop: 4 },
  fitBadgeBad: { color: "#C62828" },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  statusLabel: { fontSize: 12, fontWeight: "600" },
  videoCount: { fontSize: 12, color: "#888" },
  removeHint: { fontSize: 10, color: "#ccc" },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyAddBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyAddBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  modal: { flex: 1, backgroundColor: "#F7F7FF" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E8F0",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A2E" },
  modalClose: { fontSize: 16, color: "#6C63FF", fontWeight: "600" },
  modalContent: { padding: 24 },
  modalSub: { fontSize: 15, color: "#666", lineHeight: 22, marginBottom: 20 },
  exampleLabel: { fontSize: 13, fontWeight: "600", color: "#333", marginBottom: 8 },
  example: {
    fontSize: 14,
    color: "#6C63FF",
    marginBottom: 6,
    textDecorationLine: "underline",
  },
  modalInput: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A2E",
    borderWidth: 1,
    borderColor: "#E8E8F0",
    marginTop: 16,
    marginBottom: 20,
  },
  confirmBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
