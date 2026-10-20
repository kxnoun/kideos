// ─────────────────────────────────────────────────────────────
// Kideos Kid App — BreakScreen
//
// The parent's "break between videos" (Settings → Viewing rules): a calm
// full-screen countdown with nothing to tap. When it reaches 0, onDone.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { SafeAreaView, Text, StyleSheet, StatusBar } from "react-native";
import { formatLeft } from "../viewing";

export default function BreakScreen({ until, onDone }: { until: number; onDone: () => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (now >= until) onDone();
  }, [now, until, onDone]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#EAF6EF" />
      <Text style={styles.emoji}>🌿</Text>
      <Text style={styles.title}>Take a breather</Text>
      <Text style={styles.text}>Next video in</Text>
      <Text style={styles.time}>{formatLeft((until - now) / 1000)}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EAF6EF", alignItems: "center", justifyContent: "center", padding: 40 },
  emoji: { fontSize: 80, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: "800", color: "#24543A", marginBottom: 10 },
  text: { fontSize: 17, color: "#4A7A5E" },
  time: { fontSize: 44, fontWeight: "800", color: "#24543A", marginTop: 6, fontVariant: ["tabular-nums"] },
});
