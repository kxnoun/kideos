// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SettingsScreen
//
// - Child profile management (view / add / delete)
// - Content filter editing per child
// - Data & Privacy: delete child watch history
// - Sign out
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Alert,
  Switch,
  TextInput,
  Modal,
  ActivityIndicator,
} from "react-native";
import type { ValueFilters } from "../../types";
import {
  signOut,
  saveValueFilters,
  getValueFilters,
  deleteChildData,
} from "../../services/firebase";
import { useStore } from "../../store/useStore";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types";

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

const DEFAULT_FILTERS: ValueFilters = {
  violence: "none",
  language: "none",
  sexualContent: "none",
  religiousSensitivity: false,
  religion: "",
  political: "block_all",
  customRules: "",
  ageGroup: 8,
};

export default function SettingsScreen() {
  const user = useStore((s) => s.user);
  const children = useStore((s) => s.children);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [filtersModalChildId, setFiltersModalChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ValueFilters>(DEFAULT_FILTERS);
  const [savingFilters, setSavingFilters] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);

  const set = <K extends keyof ValueFilters>(key: K, value: ValueFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const openFilters = useCallback(
    async (childId: string) => {
      if (!user) return;
      setLoadingFilters(true);
      setFiltersModalChildId(childId);
      try {
        const loaded = await getValueFilters(user.uid, childId);
        if (loaded) {
          setFilters(loaded);
        } else {
          // First time: use child's actual age as the ageGroup default
          const child = children.find((c) => c.id === childId);
          setFilters({ ...DEFAULT_FILTERS, ageGroup: child?.profile.age ?? 8 });
        }
      } finally {
        setLoadingFilters(false);
      }
    },
    [user, children]
  );

  const handleSaveFilters = useCallback(async () => {
    if (!user || !filtersModalChildId) return;
    setSavingFilters(true);
    try {
      await saveValueFilters(user.uid, filtersModalChildId, filters);
      setFiltersModalChildId(null);
      Alert.alert("Saved", "Filters updated. New videos will be analyzed with the new settings.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save.";
      Alert.alert("Error", msg);
    } finally {
      setSavingFilters(false);
    }
  }, [user, filtersModalChildId, filters]);

  const handleDeleteChild = useCallback(
    (childId: string, childName: string) => {
      Alert.alert(
        "Delete Child Profile",
        `This will permanently delete all data for ${childName}, including watch history, channels, and flagged content. This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete Everything",
            style: "destructive",
            onPress: async () => {
              if (!user) return;
              try {
                await deleteChildData(user.uid, childId);
                Alert.alert("Deleted", `${childName}'s data has been removed.`);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : "Delete failed.";
                Alert.alert("Error", msg);
              }
            },
          },
        ]
      );
    },
    [user]
  );

  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.heading}>Settings</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        {/* Child Profiles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Child Profiles</Text>
          {children.map((c) => (
            <View key={c.id} style={styles.childCard}>
              <Text style={styles.childAvatar}>{c.profile.avatar}</Text>
              <View style={styles.childInfo}>
                <Text style={styles.childName}>{c.profile.name}</Text>
                <Text style={styles.childAge}>
                  Age {c.profile.age} · {c.profile.mode === "young" ? "Young mode" : "Older mode"}
                </Text>
              </View>
              <View style={styles.childActions}>
                <TouchableOpacity
                  style={styles.childActionBtn}
                  onPress={() => openFilters(c.id)}
                >
                  <Text style={styles.childActionText}>Filters</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.childActionBtn, styles.childActionBtnDanger]}
                  onPress={() => handleDeleteChild(c.id, c.profile.name)}
                >
                  <Text style={styles.childActionTextDanger}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={styles.addChildBtn}
            onPress={() => navigation.navigate("CreateChild")}
          >
            <Text style={styles.addChildBtnText}>+ Add Another Child</Text>
          </TouchableOpacity>
        </View>

        {/* Data & Privacy */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data & Privacy</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Watch History Retention</Text>
            <Text style={styles.infoText}>
              Watch history is automatically deleted after 90 days (COPPA
              compliant). Use the "Delete" button on a child profile to remove
              all data immediately.
            </Text>
          </View>
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Filters Edit Modal */}
      <Modal
        visible={filtersModalChildId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFiltersModalChildId(null)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setFiltersModalChildId(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Content Filters</Text>
            <TouchableOpacity
              onPress={handleSaveFilters}
              disabled={savingFilters}
            >
              {savingFilters ? (
                <ActivityIndicator size="small" color="#6C63FF" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          {loadingFilters ? (
            <View style={styles.loadingCenter}>
              <ActivityIndicator size="large" color="#6C63FF" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent}>
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
                <Text style={styles.fieldLabel}>Custom rules</Text>
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
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  heading: { fontSize: 28, fontWeight: "800", color: "#1A1A2E" },
  email: { fontSize: 14, color: "#888", marginTop: 4 },

  section: { paddingHorizontal: 20, marginBottom: 28 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#999",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 12,
    marginTop: 8,
  },

  childCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  childAvatar: { fontSize: 32 },
  childInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: "700", color: "#1A1A2E" },
  childAge: { fontSize: 13, color: "#888", marginTop: 2 },
  childActions: { flexDirection: "row", gap: 8 },
  childActionBtn: {
    backgroundColor: "#EEECff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  childActionBtnDanger: { backgroundColor: "#FFEBEE" },
  childActionText: { fontSize: 13, fontWeight: "600", color: "#6C63FF" },
  childActionTextDanger: { fontSize: 13, fontWeight: "600", color: "#FF5252" },
  addChildBtn: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E8E8F0",
    borderStyle: "dashed",
  },
  addChildBtnText: { color: "#6C63FF", fontWeight: "700", fontSize: 15 },

  infoCard: {
    backgroundColor: "#EEF0FF",
    borderRadius: 14,
    padding: 16,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6C63FF",
    marginBottom: 6,
  },
  infoText: { fontSize: 14, color: "#555", lineHeight: 20 },

  signOutBtn: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FFD0D0",
  },
  signOutText: { color: "#FF5252", fontWeight: "700", fontSize: 16 },

  // Modal
  modal: { flex: 1, backgroundColor: "#F7F7FF" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E8F0",
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A2E" },
  modalCancel: { fontSize: 16, color: "#888" },
  modalSave: { fontSize: 16, color: "#6C63FF", fontWeight: "700" },
  modalContent: { padding: 24, paddingBottom: 48 },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },

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
  segmentBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
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
});
