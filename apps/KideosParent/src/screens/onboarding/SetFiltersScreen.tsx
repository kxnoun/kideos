// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SetFiltersScreen
//
// Onboarding step 2. Configure content filters for the child.
// These filters drive the AI video analysis.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, ValueFilters } from "../../types";
import { saveValueFilters } from "../../services/firebase";
import { useStore } from "../../store/useStore";

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "SetFilters">;
  route: RouteProp<RootStackParamList, "SetFilters">;
}

function defaultFilters(ageGroup: number): ValueFilters {
  return {
    violence: "none",
    language: "none",
    sexualContent: "none",
    religiousSensitivity: false,
    religion: "",
    political: "block_all",
    customRules: "",
    ageGroup,
  };
}

function SegmentControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segment}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.segmentBtn,
              value === opt.value && styles.segmentBtnActive,
            ]}
            onPress={() => onChange(opt.value)}
          >
            <Text
              style={[
                styles.segmentText,
                value === opt.value && styles.segmentTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function SetFiltersScreen({ navigation, route }: Props) {
  const { childId, childAge } = route.params;
  const user = useStore((s) => s.user);
  const [filters, setFilters] = useState<ValueFilters>(() => defaultFilters(childAge));
  const [loading, setLoading] = useState(false);

  const set = <K extends keyof ValueFilters>(key: K, value: ValueFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

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
          Tell our AI what's acceptable. These settings drive every video analysis.
        </Text>

        <SegmentControl
          label="Violence"
          options={[
            { value: "none", label: "None" },
            { value: "mild", label: "Mild" },
            { value: "moderate", label: "Moderate" },
          ]}
          value={filters.violence}
          onChange={(v) => set("violence", v)}
        />

        <SegmentControl
          label="Language"
          options={[
            { value: "none", label: "Clean only" },
            { value: "mild", label: "Mild" },
            { value: "anything", label: "Anything" },
          ]}
          value={filters.language}
          onChange={(v) => set("language", v)}
        />

        <SegmentControl
          label="Political content"
          options={[
            { value: "block_all", label: "Block all" },
            { value: "allow_educational", label: "Educational" },
            { value: "allow_all", label: "Allow all" },
          ]}
          value={filters.political}
          onChange={(v) => set("political", v)}
        />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Religious sensitivity</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              Flag content that contradicts our faith
            </Text>
            <Switch
              value={filters.religiousSensitivity}
              onValueChange={(v) => set("religiousSensitivity", v)}
              trackColor={{ true: "#6C63FF" }}
            />
          </View>
          {filters.religiousSensitivity && (
            <TextInput
              style={styles.input}
              value={filters.religion}
              onChangeText={(v) => set("religion", v)}
              placeholder="e.g. Christian, Jewish, Muslim..."
              placeholderTextColor="#aaa"
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Custom rules (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={filters.customRules}
            onChangeText={(v) => set("customRules", v)}
            placeholder="e.g. No gaming content, no fast food ads..."
            placeholderTextColor="#aaa"
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            Sexual content is always blocked. This cannot be changed.
          </Text>
        </View>

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
