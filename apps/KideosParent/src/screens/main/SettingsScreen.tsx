// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SettingsScreen
//
// - Child profile management (view / add / delete)
// - Content filter editing per child
// - Viewing rules per child (minimum time on a video before switching) + profile PIN
// - Devices: which children use each kid device, how often it asks "Who's watching?", unpair
// - Data & Privacy: delete child watch history
// - Sign out
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect } from "react";
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
  TextInput,
} from "react-native";
import type { KidDevice, ValueFilters, ViewingRules } from "../../types";
import {
  signOut,
  saveValueFilters,
  getValueFilters,
  deleteChildData,
  updateChild,
  subscribeToKidDevices,
  updateKidDevice,
  unpairKidDevice,
  setChildPinHash,
} from "../../services/firebase";
import { PIN_LENGTH, hashPin, isValidPin } from "../../pin";

// "Ask who's watching" on a shared device: after the app has been away this long
const ASK_WHO: { value: number; label: string }[] = [
  { value: 0, label: "Every time" },
  { value: 1, label: "1 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 20, label: "20 min" },
  { value: 30, label: "30 min" },
];

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
  const [devices, setDevices] = useState<KidDevice[]>([]);
  // PIN entry inside the Viewing sheet: type it, then type it again
  const [pinStep, setPinStep] = useState<"enter" | "confirm" | null>(null);
  const [pinFirst, setPinFirst] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeToKidDevices(user.uid, setDevices);
  }, [user]);

  const closeViewing = useCallback(() => {
    setViewingChildId(null);
    setPinStep(null);
    setPinFirst("");
    setPinInput("");
  }, []);

  const handlePinInput = useCallback(
    async (text: string) => {
      const digits = text.replace(/\D/g, "").slice(0, PIN_LENGTH);
      setPinInput(digits);
      if (!isValidPin(digits) || !user || !viewingChildId) return;
      if (pinStep === "enter") {
        setPinFirst(digits);
        setPinInput("");
        setPinStep("confirm");
        return;
      }
      if (digits !== pinFirst) {
        Alert.alert("PINs don't match", "Type the new PIN again.");
        setPinFirst("");
        setPinInput("");
        setPinStep("enter");
        return;
      }
      setSavingPin(true);
      try {
        await setChildPinHash(user.uid, viewingChildId, hashPin(viewingChildId, digits));
        setPinStep(null);
        setPinFirst("");
        setPinInput("");
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to save the PIN.");
      } finally {
        setSavingPin(false);
      }
    },
    [user, viewingChildId, pinStep, pinFirst]
  );

  const handleRemovePin = useCallback(async () => {
    if (!user || !viewingChildId) return;
    try {
      await setChildPinHash(user.uid, viewingChildId, null);
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to remove the PIN.");
    }
  }, [user, viewingChildId]);

  const toggleDeviceChild = useCallback(
    async (device: KidDevice, childId: string) => {
      if (!user) return;
      const on = device.childIds.includes(childId);
      if (on && device.childIds.length === 1) {
        Alert.alert("A device needs at least one child", `To stop using ${device.name}, unpair it instead.`);
        return;
      }
      const childIds = on ? device.childIds.filter((id) => id !== childId) : [...device.childIds, childId];
      try {
        await updateKidDevice(user.uid, device.id, { childIds });
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to save.");
      }
    },
    [user]
  );

  const setAskWho = useCallback(
    async (device: KidDevice, minutes: number) => {
      if (!user) return;
      try {
        await updateKidDevice(user.uid, device.id, { askWhoAfterMinutes: minutes });
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to save.");
      }
    },
    [user]
  );

  const handleUnpair = useCallback(
    (device: KidDevice) => {
      Alert.alert(
        `Unpair ${device.name}?`,
        "It stops showing videos right away and goes back to its pairing screen.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unpair",
            style: "destructive",
            onPress: async () => {
              if (!user) return;
              try {
                await unpairKidDevice(user.uid, device.id);
              } catch (e: unknown) {
                Alert.alert("Error", e instanceof Error ? e.message : "Failed to unpair.");
              }
            },
          },
        ]
      );
    },
    [user]
  );

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
      closeViewing();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingViewing(false);
    }
  }, [user, viewingChildId, viewing, closeViewing]);
  const viewingChildHasPin = Boolean(children.find((c) => c.id === viewingChildId)?.profile.pinHash);
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
                  {c.profile.pinHash ? " · 🔒 PIN" : ""}
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

        {/* Kid devices */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Devices</Text>
          {devices.length === 0 ? (
            <Text style={styles.emptyText}>No kid devices yet — pair one with "+ Pair Device" on Home.</Text>
          ) : (
            devices.map((d) => (
              <View key={d.id} style={styles.deviceCard}>
                <View style={styles.deviceHeader}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    📱 {d.name}
                  </Text>
                  <TouchableOpacity onPress={() => handleUnpair(d)} hitSlop={8}>
                    <Text style={styles.unpairText}>Unpair</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.deviceLabel}>Who can use it</Text>
                <View style={styles.chipRow}>
                  {children.map((c) => {
                    const on = d.childIds.includes(c.id);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() => toggleDeviceChild(d, c.id)}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {c.profile.avatar} {c.profile.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {d.childIds.length > 1 ? (
                  <>
                    <Text style={styles.deviceLabel}>Ask "Who's watching?"</Text>
                    <View style={styles.chipRow}>
                      {ASK_WHO.map((o) => {
                        const on = d.askWhoAfterMinutes === o.value;
                        return (
                          <TouchableOpacity
                            key={o.value}
                            style={[styles.chip, on && styles.chipOn]}
                            onPress={() => setAskWho(d, o.value)}
                          >
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.hint}>
                      {d.askWhoAfterMinutes === 0
                        ? "Every time the app is opened."
                        : `When the app has been away for ${d.askWhoAfterMinutes} min or more — and always after a restart. Kids with a PIN type it each time.`}
                    </Text>
                  </>
                ) : null}
              </View>
            ))
          )}
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
        onRequestClose={closeViewing}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeViewing}>
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

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Profile PIN {viewingChildHasPin ? "· 🔒 on" : ""}</Text>
              {pinStep ? (
                <>
                  <Text style={styles.hint}>
                    {pinStep === "enter" ? `Type a new ${PIN_LENGTH}-digit PIN` : "Type it again"}
                  </Text>
                  <TextInput
                    style={styles.pinInput}
                    value={pinInput}
                    onChangeText={handlePinInput}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={PIN_LENGTH}
                    autoFocus
                    editable={!savingPin}
                  />
                  <TouchableOpacity onPress={() => setPinStep(null)}>
                    <Text style={styles.pinLink}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.pinRow}>
                  <TouchableOpacity style={styles.childActionBtn} onPress={() => setPinStep("enter")}>
                    <Text style={styles.childActionText}>{viewingChildHasPin ? "Change PIN" : "Set a PIN"}</Text>
                  </TouchableOpacity>
                  {viewingChildHasPin ? (
                    <TouchableOpacity
                      style={[styles.childActionBtn, styles.childActionBtnDanger]}
                      onPress={handleRemovePin}
                    >
                      <Text style={styles.childActionTextDanger}>Remove PIN</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
              <Text style={styles.hint}>
                On a device more than one child uses, {viewingChildName} types it after picking their profile —
                so a younger sibling can't watch with {viewingChildName}'s settings. Forgotten? Change it here.
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

  emptyText: { fontSize: 14, color: "#888", lineHeight: 20 },
  deviceCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 10 },
  deviceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  deviceName: { fontSize: 16, fontWeight: "700", color: "#1A1A2E", flex: 1, paddingRight: 12 },
  unpairText: { fontSize: 14, fontWeight: "600", color: "#FF5252" },
  deviceLabel: { fontSize: 13, fontWeight: "700", color: "#555", marginTop: 10, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#F0F0F7" },
  chipOn: { backgroundColor: "#6C63FF" },
  chipText: { fontSize: 14, fontWeight: "600", color: "#555" },
  chipTextOn: { color: "#fff" },
  pinRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  pinInput: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E8F0",
    padding: 14,
    fontSize: 28,
    letterSpacing: 16,
    textAlign: "center",
    marginVertical: 8,
  },
  pinLink: { fontSize: 15, color: "#888", textAlign: "center", paddingVertical: 8 },
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
