// ─────────────────────────────────────────────────────────────
// Kideos Kid App — PairingScreen
//
// Shown before the app is linked to a parent account.
// Generates a 6-character pairing code. Parent enters this code
// in the Kideos for Parents app to link the devices.
//
// Pairing flow:
//   1. This screen writes { code, createdAt, claimed: false }
//      to Firestore at pairingCodes/{code}
//   2. Parent app finds the document by code, writes
//      { parentId, childId } back to it
//   3. This screen detects the update and saves the session
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import firestore from "@react-native-firebase/firestore";
import auth from "@react-native-firebase/auth";
import type { ChildSession } from "../types";

interface Props {
  onPaired: (session: ChildSession) => void;
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
        // This device's anonymous UID — the parent's claim adds it to the child's
        // kidDeviceUids, which the security rules check (App.tsx waits for auth first)
        deviceUid: auth().currentUser?.uid,
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
        if (data?.claimed && data?.parentId && data?.childId) {
          setStatus("paired");
          unsub();
          onPaired({
            parentId: data.parentId,
            childId: data.childId,
            childName: data.childName ?? "Kid",
            childAge: data.childAge ?? 7,
            paired: true,
          });
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

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.logo}>Kideos</Text>

      {status === "generating" && (
        <ActivityIndicator size="large" color="#6C63FF" />
      )}

      {status === "waiting" && (
        <>
          <Text style={styles.instruction}>
            Ask a parent to open{"\n"}
            <Text style={styles.appName}>Kideos for Parents</Text>
            {"\n"}and enter this code:
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.code}>{code}</Text>
          </View>

          <Text style={styles.subtext}>Code expires in 15 minutes</Text>
          <ActivityIndicator
            size="small"
            color="#6C63FF"
            style={styles.spinner}
          />
          <Text style={styles.waiting}>Waiting for parent...</Text>
        </>
      )}

      {status === "paired" && (
        <Text style={styles.paired}>✓ Connected!</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7FF",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: "#6C63FF",
    marginBottom: 48,
    letterSpacing: -0.5,
  },
  instruction: {
    fontSize: 20,
    color: "#333",
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 32,
  },
  appName: {
    fontWeight: "700",
    color: "#6C63FF",
  },
  codeBox: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 40,
    paddingVertical: 24,
    shadowColor: "#6C63FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 16,
  },
  code: {
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 8,
    color: "#1A1A2E",
  },
  subtext: {
    fontSize: 14,
    color: "#999",
    marginBottom: 32,
  },
  spinner: {
    marginBottom: 12,
  },
  waiting: {
    fontSize: 16,
    color: "#666",
  },
  paired: {
    fontSize: 28,
    fontWeight: "700",
    color: "#4CAF50",
  },
});
