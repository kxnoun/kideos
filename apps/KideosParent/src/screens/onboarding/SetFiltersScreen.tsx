// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SetFiltersScreen
//
// Onboarding step 2. The per-child questionnaire (components/FiltersForm).
// Answers are applied to every video's content profile.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, ValueFilters } from "../../types";
import { saveValueFilters } from "../../services/firebase";
import FiltersForm from "../../components/FiltersForm";
import { defaultPrefs } from "../../prefs";
import { useStore } from "../../store/useStore";

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "SetFilters">;
  route: RouteProp<RootStackParamList, "SetFilters">;
}

export default function SetFiltersScreen({ navigation, route }: Props) {
  const { childId, childAge } = route.params;
  const user = useStore((s) => s.user);
  const [filters, setFilters] = useState<ValueFilters>(() => defaultPrefs(childAge));
  const [loading, setLoading] = useState(false);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      await saveValueFilters(user.uid, childId, filters);
      navigation.navigate("AddChannels", { childId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save filters.";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [user, childId, filters, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 2 of 3</Text>
        <Text style={styles.heading}>Content Filters</Text>
        <Text style={styles.sub}>
          Tell us what's OK for your child. Every video is checked against these answers, and you can change them anytime.
        </Text>

        <FiltersForm value={filters} onChange={setFilters} />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleSave}
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
  sub: { fontSize: 16, color: "#666", marginBottom: 32, lineHeight: 24 },
  field: { marginBottom: 28 },
  fieldLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "#E8E8F0",
    borderRadius: 10,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentBtnActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentText: { fontSize: 13, fontWeight: "600", color: "#888" },
  segmentTextActive: { color: "#1A1A2E" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  switchLabel: { fontSize: 15, color: "#444", flex: 1, paddingRight: 16 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#1A1A2E",
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  note: {
    backgroundColor: "#EEF0FF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 32,
  },
  noteText: { fontSize: 13, color: "#6C63FF", lineHeight: 18 },
  btn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
