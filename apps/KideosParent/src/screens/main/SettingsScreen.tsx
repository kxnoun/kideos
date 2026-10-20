// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SettingsScreen
//
// - Child profile management (view / add / delete)
// - Content filter editing per child
// - Viewing rules per child (minimum time on a video before switching)
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
  Modal,
  ActivityIndicator,
} from "react-native";
import type { ValueFilters, ViewingRules } from "../../types";
import {
  signOut,
  saveValueFilters,
  getValueFilters,
  deleteChildData,
  updateChild,
} from "../../services/firebase";

const MIN_WATCH: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 30, label: "30 s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: -1, label: "Whole" },
];
import { useStore } from "../../store/useStore";
import FiltersForm from "../../components/FiltersForm";
import { defaultPrefs, normalizePrefs } from "../../prefs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types";

export default function SettingsScreen() {
  const user = useStore((s) => s.user);
  const children = useStore((s) => s.children);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [filtersModalChildId, setFiltersModalChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ValueFilters>(() => defaultPrefs(8));
  const [savingFilters, setSavingFilters] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [viewingChildId, setViewingChildId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewingRules>({ minWatchSeconds: 0 });
  const [savingViewing, setSavingViewing] = useState(false);

  const openViewing = useCallback(
    (childId: string) => {
      const v = children.find((c) => c.id === childId)?.profile.viewing as
        | (ViewingRules & { mustFinish?: boolean })
        | undefined;
      const n = Number(v?.minWatchSeconds);
      setViewing({ minWatchSeconds: [0, 30, 60, 120, -1].includes(n) ? n : v?.mustFinish ? -1 : 0 });
      setViewingChildId(childId);
    },
    [children]
  );

  const handleSaveViewing = useCallback(async () => {
    if (!user || !viewingChildId) return;
    setSavingViewing(true);
    try {
      await updateChild(user.uid, viewingChildId, { viewing });
      setViewingChildId(null);
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingViewing(false);
    }
  }, [user, viewingChildId, viewing]);
  const viewingChildName = children.find((c) => c.id === viewingChildId)?.profile.name ?? "your child";

  const openFilters = useCallback(
    async (childId: string) => {
      if (!user) return;
      setLoadingFilters(true);
      setFiltersModalChildId(childId);
      try {
        const loaded = await getValueFilters(user.uid, childId);
        const child = children.find((c) => c.id === childId);
        // Converts the old filter format too; first time → age defaults
        setFilters(normalizePrefs(loaded ?? undefined, child?.profile.age ?? 8));
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
      Alert.alert("Saved", "Filters updated. Your child's feed will update with the new settings in a moment.");
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
                <TouchableOpacity style={styles.childActionBtn} onPress={() => openViewing(c.id)}>
                  <Text style={styles.childActionText}>Viewing</Text>
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

      {/* Viewing rules Modal */}
      <Modal
        visible={viewingChildId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setViewingChildId(null)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setViewingChildId(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Viewing rules</Text>
            <TouchableOpacity onPress={handleSaveViewing} disabled={savingViewing}>
              {savingViewing ? (
                <ActivityIndicator size="small" color="#6C63FF" />
              ) : (
                <Text style={styles.modalSave}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Before switching videos, stay at least</Text>
              <View style={styles.segment}>
                {MIN_WATCH.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.segmentBtn, viewing.minWatchSeconds === m.value && styles.segmentBtnActive]}
                    onPress={() => setViewing({ minWatchSeconds: m.value })}
                  >
                    <Text style={[styles.segmentText, viewing.minWatchSeconds === m.value && styles.segmentTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>
                {viewing.minWatchSeconds === 0
                  ? `${viewingChildName} can switch videos any time.`
                  : viewing.minWatchSeconds === -1
                  ? `${viewingChildName} can't leave a video until most of it has actually played — skipping ahead doesn't count.`
                  : `Counts from when the video starts playing — pausing counts too. Until then, Back keeps ${viewingChildName} on the video with a “Watch a little more!” message.`}
                {viewing.minWatchSeconds !== 0
                  ? " To get them out sooner, use Hide this video or End Session on Home."
                  : ""}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
              <FiltersForm value={filters} onChange={setFilters} />
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
  hint: { fontSize: 13, color: "#888", lineHeight: 19, marginTop: 8 },
});
