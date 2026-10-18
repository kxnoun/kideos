// ─────────────────────────────────────────────────────────────
// Kideos for Parents — HomeScreen
//
// Main dashboard. Shows:
// - Child selector (if multiple children)
// - Now Watching card with real-time Firestore subscription
// - Remote pause / stop controls
// - Link to the child's Videos screen (what's shown / hidden, and why)
// - Pairing a new device button
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
} from "react-native";
import type { NowPlaying, RootStackParamList } from "../../types";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  subscribeToNowPlaying,
  sendPlaySignal,
  subscribeToPlaySignal,
  claimPairingCode,
} from "../../services/firebase";
import { useStore, useSelectedChild } from "../../store/useStore";

export default function HomeScreen() {
  const user = useStore((s) => s.user);
  const children = useStore((s) => s.children);
  const selectedChildId = useStore((s) => s.selectedChildId);
  const setSelectedChildId = useStore((s) => s.setSelectedChildId);
  const selectedChild = useSelectedChild();

  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [lastSignal, setLastSignal] = useState<"play" | "pause" | "stop" | null>(null);
  const watchingOff = lastSignal === "stop";
  const [sendingSignal, setSendingSignal] = useState(false);

  // Pairing modal
  const [pairingVisible, setPairingVisible] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairChildId, setPairChildId] = useState(selectedChildId ?? "");
  const [pairing, setPairing] = useState(false);

  const parentId = user?.uid;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Subscribe to now playing
  useEffect(() => {
    if (!parentId || !selectedChildId) return;
    const unsub = subscribeToNowPlaying(parentId, selectedChildId, setNowPlaying);
    const unsub2 = subscribeToPlaySignal(parentId, selectedChildId, setLastSignal);
    return () => {
      unsub();
      unsub2();
    };
  }, [parentId, selectedChildId]);


  const handleSignal = useCallback(
    async (action: "play" | "pause" | "stop") => {
      if (!parentId || !selectedChildId) return;
      setSendingSignal(true);
      try {
        await sendPlaySignal(parentId, selectedChildId, action);
      } catch {
        Alert.alert("Could not send command. Check your connection.");
      } finally {
        setSendingSignal(false);
      }
    },
    [parentId, selectedChildId]
  );

  const handlePair = useCallback(async () => {
    if (children.length === 0) {
      Alert.alert("Add a child first", "Go to Settings → Add Another Child, then pair their device.");
      return;
    }
    if (!parentId || !pairCode.trim() || !pairChildId) {
      Alert.alert("Enter a code and select a child.");
      return;
    }
    const child = children.find((c) => c.id === pairChildId);
    if (!child) return;

    setPairing(true);
    try {
      await claimPairingCode(
        pairCode,
        parentId,
        pairChildId,
        child.profile.name,
        child.profile.age
      );
      setPairingVisible(false);
      setPairCode("");
      Alert.alert("Paired!", `${child.profile.name}'s device is now connected.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Pairing failed.";
      Alert.alert("Pairing Failed", msg);
    } finally {
      setPairing(false);
    }
  }, [parentId, pairCode, pairChildId, children]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting()} 👋</Text>
            <Text style={styles.appName}>Kideos for Parents</Text>
          </View>
          <TouchableOpacity
            style={styles.pairBtn}
            onPress={() => {
              setPairChildId(selectedChildId ?? children[0]?.id ?? "");
              setPairingVisible(true);
            }}
          >
            <Text style={styles.pairBtnText}>+ Pair Device</Text>
          </TouchableOpacity>
        </View>

        {/* Child selector */}
        {children.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.childSelectorRow}
          >
            {children.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.childChip,
                  c.id === selectedChildId && styles.childChipActive,
                ]}
                onPress={() => setSelectedChildId(c.id)}
              >
                <Text style={styles.childChipAvatar}>{c.profile.avatar}</Text>
                <Text
                  style={[
                    styles.childChipName,
                    c.id === selectedChildId && styles.childChipNameActive,
                  ]}
                >
                  {c.profile.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* No children */}
        {children.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👶</Text>
            <Text style={styles.emptyTitle}>No child profiles yet</Text>
            <Text style={styles.emptyText}>
              Go to Settings to add a child profile.
            </Text>
          </View>
        )}

        {/* Now Watching Card */}
        {selectedChild && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {selectedChild.profile.name}'s Screen
            </Text>

            {watchingOff ? (
              <View style={styles.notWatchingCard}>
                <Text style={styles.notWatchingEmoji}>🌙</Text>
                <Text style={styles.notWatchingText}>
                  Watching is off for {selectedChild.profile.name}. Their app shows "Time's up".
                </Text>
                <TouchableOpacity
                  style={[styles.controlBtn, styles.pauseBtn, styles.unlockBtn]}
                  onPress={() => handleSignal("play")}
                  disabled={sendingSignal}
                >
                  <Text style={styles.controlBtnText}>▶ Let them watch again</Text>
                </TouchableOpacity>
              </View>
            ) : nowPlaying ? (
              <View style={styles.nowPlayingCard}>
                <Image
                  source={{ uri: nowPlaying.thumbnail }}
                  style={styles.nowPlayingThumb}
                  resizeMode="cover"
                />
                <View style={styles.nowPlayingInfo}>
                  <Text style={styles.nowPlayingLabel}>NOW WATCHING</Text>
                  <Text style={styles.nowPlayingTitle} numberOfLines={2}>
                    {nowPlaying.title}
                  </Text>
                  <Text style={styles.nowPlayingChannel}>
                    {nowPlaying.channelName}
                  </Text>

                  {/* Remote controls */}
                  <View style={styles.controls}>
                    <TouchableOpacity
                      style={[styles.controlBtn, styles.pauseBtn]}
                      onPress={() => handleSignal("pause")}
                      disabled={sendingSignal}
                    >
                      <Text style={styles.controlBtnText}>⏸ Pause</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.controlBtn, styles.pauseBtn]}
                      onPress={() => handleSignal("play")}
                      disabled={sendingSignal}
                    >
                      <Text style={styles.controlBtnText}>▶ Resume</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.controlBtn, styles.stopBtn]}
                      onPress={() =>
                        Alert.alert(
                          "End Session",
                          `This stops ${selectedChild.profile.name}'s video and shows a "time's up" screen until you let them watch again.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "End Session",
                              style: "destructive",
                              onPress: () => handleSignal("stop"),
                            },
                          ]
                        )
                      }
                      disabled={sendingSignal}
                    >
                      <Text style={[styles.controlBtnText, styles.stopBtnText]}>
                        ⏹ End
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.notWatchingCard}>
                <Text style={styles.notWatchingEmoji}>😴</Text>
                <Text style={styles.notWatchingText}>
                  {selectedChild.profile.name} isn't watching anything right now.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Videos: what's shown / hidden for this child, and why */}
        {selectedChild && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.videosCard}
              onPress={() =>
                navigation.navigate("Videos", { childId: selectedChild.id, childName: selectedChild.profile.name })
              }
            >
              <Text style={styles.videosTitle}>📺 {selectedChild.profile.name}'s videos</Text>
              <Text style={styles.videosSub}>See what's shown and what's hidden, and why →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.videosCard, { marginTop: 12 }]}
              onPress={() =>
                navigation.navigate("Suggestions", { childId: selectedChild.id, childName: selectedChild.profile.name })
              }
            >
              <Text style={styles.videosTitle}>✨ Suggested channels</Text>
              <Text style={styles.videosSub}>Channels that fit your answers for {selectedChild.profile.name} →</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Pairing Modal */}
      <Modal
        visible={pairingVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPairingVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Pair a Device</Text>
            <TouchableOpacity onPress={() => setPairingVisible(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalSub}>
              On the child's device, open the Kideos app and get a pairing code.
              Enter it below.
            </Text>

            <Text style={styles.label}>Pairing code</Text>
            <TextInput
              style={styles.codeInput}
              value={pairCode}
              onChangeText={(t) => setPairCode(t.toUpperCase())}
              placeholder="ABC123"
              placeholderTextColor="#aaa"
              autoCapitalize="characters"
              maxLength={6}
              keyboardType="default"
            />

            {children.length > 1 && (
              <>
                <Text style={styles.label}>Link to child</Text>
                {children.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.childOption,
                      pairChildId === c.id && styles.childOptionActive,
                    ]}
                    onPress={() => setPairChildId(c.id)}
                  >
                    <Text style={styles.childOptionAvatar}>{c.profile.avatar}</Text>
                    <Text style={styles.childOptionName}>{c.profile.name}</Text>
                    {pairChildId === c.id && (
                      <Text style={styles.childOptionCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            <TouchableOpacity
              style={[styles.pairConfirmBtn, pairing && styles.btnDisabled]}
              onPress={handlePair}
              disabled={pairing}
            >
              {pairing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.pairConfirmText}>Pair Device</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  videosCard: { backgroundColor: "#fff", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#E8E8F0" },
  videosTitle: { fontSize: 17, fontWeight: "800", color: "#1A1A2E" },
  videosSub: { fontSize: 14, color: "#6C63FF", marginTop: 4, fontWeight: "600" },
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  greeting: { fontSize: 22, fontWeight: "800", color: "#1A1A2E" },
  appName: { fontSize: 13, color: "#999", marginTop: 2 },
  pairBtn: {
    backgroundColor: "#EEECff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pairBtnText: { color: "#6C63FF", fontWeight: "700", fontSize: 13 },

  childSelectorRow: { paddingHorizontal: 20, marginBottom: 8 },
  childChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  childChipActive: { borderColor: "#6C63FF", backgroundColor: "#EEECff" },
  childChipAvatar: { fontSize: 18 },
  childChipName: { fontSize: 14, fontWeight: "600", color: "#666" },
  childChipNameActive: { color: "#6C63FF" },

  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 12,
  },

  nowPlayingCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#6C63FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  nowPlayingThumb: { width: "100%", height: 180 },
  nowPlayingInfo: { padding: 16 },
  nowPlayingLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6C63FF",
    letterSpacing: 1,
    marginBottom: 4,
  },
  nowPlayingTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 4,
  },
  nowPlayingChannel: { fontSize: 14, color: "#888", marginBottom: 16 },
  controls: { flexDirection: "row", gap: 10 },
  controlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  pauseBtn: { backgroundColor: "#EEECff" },
  stopBtn: { backgroundColor: "#FFF0F0", borderWidth: 1, borderColor: "#FFD0D0" },
  controlBtnText: { fontSize: 15, fontWeight: "700", color: "#6C63FF" },
  stopBtnText: { color: "#FF5252" },
  unlockBtn: { flex: 0, alignSelf: "stretch", marginTop: 16, paddingHorizontal: 16 },

  notWatchingCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
  },
  notWatchingEmoji: { fontSize: 40, marginBottom: 10 },
  notWatchingText: {
    fontSize: 15,
    color: "#888",
    textAlign: "center",
    lineHeight: 22,
  },


  emptyState: {
    alignItems: "center",
    padding: 40,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#1A1A2E", marginBottom: 8 },
  emptyText: { fontSize: 15, color: "#666", textAlign: "center" },

  // Pairing Modal
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
  modalSub: { fontSize: 15, color: "#666", lineHeight: 22, marginBottom: 28 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 8 },
  codeInput: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 28,
    fontWeight: "800",
    color: "#1A1A2E",
    letterSpacing: 8,
    textAlign: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  childOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: "transparent",
    gap: 12,
  },
  childOptionActive: { borderColor: "#6C63FF" },
  childOptionAvatar: { fontSize: 24 },
  childOptionName: { flex: 1, fontSize: 16, fontWeight: "600", color: "#1A1A2E" },
  childOptionCheck: { fontSize: 18, color: "#6C63FF" },
  pairConfirmBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  pairConfirmText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
