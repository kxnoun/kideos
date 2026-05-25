// ─────────────────────────────────────────────────────────────
// Kideos for Parents — DigestScreen
//
// Shows weekly AI-generated digests summarizing what the child
// watched. Digests are generated every Monday at 8am UTC
// for Premium users. Free users see an upgrade prompt.
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from "react-native";
import type { WeeklyDigest } from "../../types";
import { subscribeToDigests } from "../../services/firebase";
import { useStore } from "../../store/useStore";

function DigestCard({ digest }: { digest: WeeklyDigest }) {
  const date = new Date(digest.weekOf);
  const formatted = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardDate}>Week of {formatted}</Text>
      <Text style={styles.cardSummary}>{digest.summary}</Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {digest.totalHours.toFixed(1)}h
          </Text>
          <Text style={styles.statLabel}>Watch time</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{digest.videoCount}</Text>
          <Text style={styles.statLabel}>Videos</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text
            style={[
              styles.statValue,
              digest.flaggedCount > 0 && styles.statValueWarning,
            ]}
          >
            {digest.flaggedCount}
          </Text>
          <Text style={styles.statLabel}>Flagged</Text>
        </View>
      </View>
    </View>
  );
}

export default function DigestScreen() {
  const user = useStore((s) => s.user);
  const [digests, setDigests] = useState<WeeklyDigest[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToDigests(user.uid, setDigests);
    return unsub;
  }, [user]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F7FF" />

      <View style={styles.header}>
        <Text style={styles.heading}>Weekly Digest</Text>
        <Text style={styles.subheading}>
          AI-generated summaries of your child's viewing
        </Text>
      </View>

      {digests.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📊</Text>
          <Text style={styles.emptyTitle}>No digests yet</Text>
          <Text style={styles.emptyText}>
            Your first weekly digest will appear here after your child
            has been watching for a week. Digests are generated every
            Monday morning.
          </Text>
        </View>
      ) : (
        <FlatList
          data={digests}
          renderItem={({ item }) => <DigestCard digest={item} />}
          keyExtractor={(item) => item.weekOf}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  heading: { fontSize: 28, fontWeight: "800", color: "#1A1A2E" },
  subheading: { fontSize: 14, color: "#888", marginTop: 4 },

  list: { paddingHorizontal: 20, paddingBottom: 32 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 20,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardDate: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6C63FF",
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  cardSummary: {
    fontSize: 15,
    color: "#333",
    lineHeight: 23,
    marginBottom: 18,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "#F7F7FF",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A2E",
  },
  statValueWarning: { color: "#FF9800" },
  statLabel: { fontSize: 11, color: "#888", marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: "#E0E0F0" },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 23,
  },
});
