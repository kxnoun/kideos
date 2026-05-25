// ─────────────────────────────────────────────────────────────
// Kideos for Parents — CreateChildScreen
//
// First onboarding step. Creates the child profile in Firestore.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types";
import { createChild } from "../../services/firebase";
import { useStore } from "../../store/useStore";

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "CreateChild">;
}

const AVATARS = ["🐱", "🐶", "🐸", "🐼", "🦁", "🐯", "🐨", "🦊", "🐻", "🐮"];
const AGE_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 3); // 3–16

export default function CreateChildScreen({ navigation }: Props) {
  const user = useStore((s) => s.user);
  const [name, setName] = useState("");
  const [age, setAge] = useState(8);
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert("Please enter your child's name.");
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      const mode = age <= 9 ? "young" : "older";
      const childId = await createChild(user.uid, {
        name: name.trim(),
        age,
        avatar,
        mode,
      });
      navigation.navigate("SetFilters", { childId, childAge: age });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create profile.";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [name, age, avatar, user, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>Step 1 of 3</Text>
        <Text style={styles.heading}>Who is this for?</Text>
        <Text style={styles.sub}>Set up a profile for your child.</Text>

        {/* Avatar picker */}
        <Text style={styles.sectionLabel}>Choose an avatar</Text>
        <View style={styles.avatarGrid}>
          {AVATARS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[
                styles.avatarBtn,
                avatar === emoji && styles.avatarBtnSelected,
              ]}
              onPress={() => setAvatar(emoji)}
            >
              <Text style={styles.avatarEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Name */}
        <Text style={styles.sectionLabel}>Child's name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Emma"
          placeholderTextColor="#aaa"
          maxLength={30}
        />

        {/* Age */}
        <Text style={styles.sectionLabel}>Age</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.ageRow}
        >
          {AGE_OPTIONS.map((a) => (
            <TouchableOpacity
              key={a}
              style={[styles.ageBtn, age === a && styles.ageBtnSelected]}
              onPress={() => setAge(a)}
            >
              <Text style={[styles.ageBtnText, age === a && styles.ageBtnTextSelected]}>
                {a}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {age <= 9 && (
          <Text style={styles.modeHint}>
            Young mode (age 3–9): stricter content filters
          </Text>
        )}
        {age > 9 && (
          <Text style={styles.modeHint}>
            Older mode (age 10+): slightly relaxed where appropriate
          </Text>
        )}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleCreate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Continue →</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  content: { padding: 24, paddingBottom: 48 },
  step: { fontSize: 13, color: "#6C63FF", fontWeight: "600", marginBottom: 8 },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1A1A2E",
    marginBottom: 6,
  },
  sub: { fontSize: 16, color: "#666", marginBottom: 32 },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
  },
  avatarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 28,
  },
  avatarBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  avatarBtnSelected: { borderColor: "#6C63FF", backgroundColor: "#EEECff" },
  avatarEmoji: { fontSize: 28 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A2E",
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  ageRow: { marginBottom: 12 },
  ageBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  ageBtnSelected: { backgroundColor: "#6C63FF", borderColor: "#6C63FF" },
  ageBtnText: { fontSize: 16, fontWeight: "600", color: "#333" },
  ageBtnTextSelected: { color: "#fff" },
  modeHint: {
    fontSize: 13,
    color: "#6C63FF",
    marginBottom: 32,
    fontStyle: "italic",
  },
  btn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
