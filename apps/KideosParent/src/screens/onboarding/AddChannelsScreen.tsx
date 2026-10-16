// ─────────────────────────────────────────────────────────────
// Kideos for Parents — AddChannelsScreen
//
// Onboarding step 3. Add first YouTube channels to the whitelist.
// Accepts any of: channel URL, @handle, or channel name.
// Hitting "Done" skips this and goes to the main app.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../../types";
import { addChannel } from "../../services/firebase";
import { useStore } from "../../store/useStore";

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "AddChannels">;
  route: RouteProp<RootStackParamList, "AddChannels">;
}

interface AddedChannel {
  channelId: string;
  name: string;
}

export default function AddChannelsScreen({ navigation, route }: Props) {
  const { childId } = route.params;
  const user = useStore((s) => s.user);
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const inOnboarding = useStore((s) => s.inOnboarding);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<AddedChannel[]>([]);

  const handleAdd = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !user) return;

    setAdding(true);
    try {
      const result = await addChannel(user.uid, childId, trimmed);
      setAdded((prev) => [result, ...prev]);
      setInput("");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Could not find that channel.";
      Alert.alert("Channel Not Found", msg);
    } finally {
      setAdding(false);
    }
  }, [input, user, childId]);

  const handleDone = useCallback(() => {
    if (inOnboarding) {
      // Signal App.tsx that onboarding is complete → switches to Main stack
      completeOnboarding();
    } else {
      // Reached via Settings → "Add Another Child": already in Main stack
      navigation.popToTop();
    }
  }, [inOnboarding, completeOnboarding, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 3 of 3</Text>
        <Text style={styles.heading}>Add Channels</Text>
        <Text style={styles.sub}>
          Paste a YouTube URL, @handle, or channel name.
          {"\n"}Our AI will analyze and approve videos automatically.
        </Text>

        {/* Input row */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="youtube.com/@ or @handle"
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={[styles.addBtn, adding && styles.addBtnDisabled]}
            onPress={handleAdd}
            disabled={adding}
          >
            {adding ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.addBtnText}>Add</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Added channels list */}
        {added.length > 0 && (
          <>
            <Text style={styles.addedLabel}>
              Added ({added.length}) — videos will be ready shortly
            </Text>
            <FlatList
              data={added}
              keyExtractor={(item) => item.channelId}
              style={styles.list}
              renderItem={({ item }) => (
                <View style={styles.channelRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.channelName}>{item.name}</Text>
                </View>
              )}
            />
          </>
        )}

        {added.length === 0 && (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderEmoji}>📺</Text>
            <Text style={styles.placeholderText}>
              No channels added yet.{"\n"}You can always add more later.
            </Text>
          </View>
        )}
      </View>

      {/* Fixed bottom buttons */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
          <Text style={styles.doneBtnText}>
            {added.length > 0 ? "All done! →" : "Skip for now →"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  content: { flex: 1, padding: 24 },
  step: { fontSize: 13, color: "#6C63FF", fontWeight: "600", marginBottom: 8 },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1A1A2E",
    marginBottom: 6,
  },
  sub: { fontSize: 15, color: "#666", marginBottom: 28, lineHeight: 22 },
  inputRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#1A1A2E",
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  addBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  addedLabel: {
    fontSize: 13,
    color: "#6C63FF",
    fontWeight: "600",
    marginBottom: 10,
  },
  list: { flex: 1 },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  checkmark: { fontSize: 18, color: "#4CAF50" },
  channelName: { fontSize: 15, fontWeight: "600", color: "#1A1A2E", flex: 1 },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.5,
  },
  placeholderEmoji: { fontSize: 56, marginBottom: 12 },
  placeholderText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
  footer: { padding: 24, paddingTop: 12 },
  doneBtn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  doneBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
