// ─────────────────────────────────────────────────────────────
// Kideos for Parents — ChannelReview
//
// Shown after checkChannel, BEFORE a channel is added: what the channel is, what
// people say (with sources), what its thumbnails show, and what conflicts with
// this child's settings. Nothing is added until the parent taps the button.
// Used by ChannelsScreen (inside its add sheet) and onboarding AddChannelsScreen.
// ─────────────────────────────────────────────────────────────

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Linking, ActivityIndicator } from "react-native";
import type { CheckChannelResult } from "../services/firebase";

const VERDICTS = {
  good: { label: "✅ Looks like a good fit", color: "#2E7D32", bg: "#E8F5E9" },
  caution: { label: "⚠️ Use caution", color: "#B26A00", bg: "#FFF4E0" },
  not_recommended: { label: "⛔ Not recommended for kids", color: "#C62828", bg: "#FDECEA" },
  unchecked: { label: "We couldn't check this channel", color: "#555", bg: "#F0F0F5" },
} as const;

interface Props {
  result: CheckChannelResult;
  childName: string;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ChannelReview({ result, childName, confirming, onConfirm, onCancel }: Props) {
  const { channel, report, conflicts, ageNote } = result;
  const verdict = VERDICTS[report?.verdict ?? "unchecked"];
  const thumbConcerns = report?.concerns.filter((c) => c.basis === "thumbnails") ?? [];
  const warn = !report || report.verdict !== "good" || conflicts.length > 0 || Boolean(ageNote);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          {channel.thumbnail ? <Image source={{ uri: channel.thumbnail }} style={styles.avatar} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{channel.name}</Text>
            <Text style={styles.subs}>{channel.subscriberCount.toLocaleString()} subscribers</Text>
          </View>
        </View>

        <View style={[styles.verdict, { backgroundColor: verdict.bg }]}>
          <Text style={[styles.verdictText, { color: verdict.color }]}>{verdict.label}</Text>
        </View>

        {!report ? (
          <Text style={styles.text}>
            Something went wrong checking it. You can still add it — its videos are checked one by one either way.
          </Text>
        ) : (
          <>
            {report.summary ? <Text style={styles.text}>{report.summary}</Text> : null}

            {conflicts.length || ageNote ? (
              <View style={styles.conflictBox}>
                <Text style={styles.conflictTitle}>Conflicts with {childName}'s settings</Text>
                {ageNote ? <Text style={styles.conflict}>• {ageNote}</Text> : null}
                {conflicts.map((c, i) => (
                  <Text key={i} style={styles.conflict}>
                    • {c}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text style={styles.section}>What people say</Text>
            <Text style={styles.text}>
              {report.reputation ||
                (report.wellKnown ? "Nothing notable found." : "Small channel — we couldn't find much about it online.")}
            </Text>
            {report.sources.map((s, i) => (
              <TouchableOpacity key={i} onPress={() => Linking.openURL(s.uri)} hitSlop={6}>
                <Text style={styles.source} numberOfLines={1}>
                  ↗ {s.title}
                </Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.section}>Thumbnails ({report.thumbnailsChecked} checked)</Text>
            {thumbConcerns.length ? (
              thumbConcerns.map((c, i) => (
                <Text key={i} style={styles.text}>
                  • {c.what}
                </Text>
              ))
            ) : (
              <Text style={styles.text}>Nothing concerning in the latest thumbnails.</Text>
            )}

            <Text style={styles.note}>
              {report.wellKnown ? "" : "We can't verify small channels fully yet. "}
              Every video is still checked one by one after you add it — anything past {childName}'s limits stays
              hidden.
            </Text>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.addBtn, warn && styles.addBtnWarn, confirming && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={confirming}
        >
          {confirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addText}>{warn ? "Add anyway" : "Add channel"}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={confirming}>
          <Text style={styles.cancelText}>{warn ? "Don't add it" : "Cancel"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: 12, backgroundColor: "#E8E8F0" },
  name: { fontSize: 18, fontWeight: "800", color: "#1A1A2E" },
  subs: { fontSize: 13, color: "#888", marginTop: 2 },
  verdict: { borderRadius: 12, padding: 12, marginBottom: 12 },
  verdictText: { fontSize: 15, fontWeight: "800" },
  text: { fontSize: 14, color: "#444", lineHeight: 20, marginBottom: 6 },
  section: { fontSize: 15, fontWeight: "800", color: "#1A1A2E", marginTop: 14, marginBottom: 6 },
  source: { fontSize: 13, color: "#6C63FF", marginBottom: 4 },
  conflictBox: { backgroundColor: "#FDECEA", borderRadius: 12, padding: 12, marginTop: 8 },
  conflictTitle: { fontSize: 14, fontWeight: "800", color: "#C62828", marginBottom: 6 },
  conflict: { fontSize: 13, color: "#7A1E1E", lineHeight: 19, marginBottom: 4 },
  note: { fontSize: 12, color: "#888", lineHeight: 17, marginTop: 14 },
  footer: { paddingTop: 10 },
  addBtn: { backgroundColor: "#6C63FF", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  addBtnWarn: { backgroundColor: "#D9534F" },
  addText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelBtn: { paddingVertical: 14, alignItems: "center" },
  cancelText: { color: "#6C63FF", fontSize: 15, fontWeight: "700" },
});
