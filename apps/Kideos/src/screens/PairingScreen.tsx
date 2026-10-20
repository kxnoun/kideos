// ─────────────────────────────────────────────────────────────
// Kideos Kid App — PairingScreen
//
// Shown before the app is linked to a parent account.
// Generates a 6-character pairing code. Parent enters this code
// in the Kideos for Parents app to link the devices.
//
// Pairing flow:
//   1. This screen writes { code, deviceUid (this device's anonymous UID), deviceName,
//      createdAt, claimed: false } to pairingCodes/{code}
//   2. Parent app finds the document by code, picks which children will use this
//      device, writes { parentId, childIds } back to it and creates
//      users/{parentId}/kidDevices/{deviceUid}
//   3. This screen detects the update and saves the session (the family);
//      App.tsx then reads the kidDevices doc for the children
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ActivityIndicator, StatusBar, Platform } from "react-native";
import auth from "@react-native-firebase/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import firestore from "@react-native-firebase/firestore";
import { colors, fonts, useLayout } from "../theme";
import type { DeviceSession } from "../types";

interface Props {
  onPaired: (session: DeviceSession) => void;
}

// Shown in the parent app's device list until they rename it
function deviceName(): string {
  if (Platform.OS === "ios") return Platform.isPad ? "iPad" : "iPhone";
  const c = Platform.constants as { Brand?: string; Model?: string };
  const brand = c.Brand ? c.Brand.charAt(0).toUpperCase() + c.Brand.slice(1) : "";
  return [brand, c.Model].filter(Boolean).join(" ") || "Android device";
}

function generateCode(): string {
  // 6 uppercase alphanumeric characters, easy to type
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export default function PairingScreen({ onPaired }: Props) {
  const [code, setCode] = useState<string>("");
  const [status, setStatus] = useState<"generating" | "waiting" | "paired">(
    "generating"
  );

  const createPairingCode = useCallback(async () => {
    const newCode = generateCode();
    setCode(newCode);
    setStatus("waiting");

    await firestore()
      .doc(`pairingCodes/${newCode}`)
      .set({
        code: newCode,
        deviceUid: auth().currentUser?.uid ?? "",
        deviceName: deviceName(),
        createdAt: firestore.FieldValue.serverTimestamp(),
        claimed: false,
        expiresAt: firestore.Timestamp.fromDate(
          new Date(Date.now() + 15 * 60 * 1000) // 15 min expiry
        ),
      });

    // Listen for the parent to claim this code
    const unsub = firestore()
      .doc(`pairingCodes/${newCode}`)
      .onSnapshot((snap) => {
        const data = snap.data();
        if (data?.claimed && data?.parentId) {
          setStatus("paired");
          unsub();
          onPaired({ parentId: data.parentId, paired: true, version: 2 });
        }
      });

    // Return cleanup
    return unsub;
  }, [onPaired]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    createPairingCode().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, [createPairingCode]);

  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const box = Math.min(72, Math.floor((layout.width - 2 * layout.margin - 5 * 10) / 6));

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.margin }]}>
      <StatusBar hidden />
      <Text style={styles.logo}>Kideos</Text>

      {status === "generating" && <ActivityIndicator size="large" color={colors.brandOnDark} />}

      {status === "waiting" && (
        <>
          <Text style={styles.instruction}>
            Ask a grown-up to open <Text style={styles.appName}>Kideos for Parents</Text>
            {"\n"}and type this code:
          </Text>

          <View style={styles.codeRow} accessible accessibilityLabel={`Pairing code ${code.split("").join(" ")}`}>
            {code.split("").map((ch, i) => (
              <View key={i} style={[styles.codeBox, { width: box, height: box * 1.25 }]}>
                <Text style={[styles.code, { fontSize: box * 0.6 }]}>{ch}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.subtext}>The code works for 15 minutes</Text>
          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={colors.brandOnDark} />
            <Text style={styles.waiting}>Waiting for a grown-up…</Text>
          </View>
        </>
      )}

      {status === "paired" && <Text style={styles.paired}>✓ Connected!</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  logo: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 48, marginBottom: 40 },
  instruction: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 20,
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 28,
  },
  appName: { color: colors.text, fontFamily: fonts.bodyHeavy },
  codeRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.brandOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  code: { color: colors.text, fontFamily: fonts.displayBold },
  subtext: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 15, marginBottom: 28 },
  waitingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  waiting: { color: colors.text, fontFamily: fonts.display, fontSize: 18 },
  paired: { color: colors.success, fontFamily: fonts.displayBold, fontSize: 32 },
});
