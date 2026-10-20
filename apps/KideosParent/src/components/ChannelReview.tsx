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
import KideosNotes from "./KideosNotes";

// The big badge is about THIS child's settings (worked out from the saved channel profile).
// YouTube's policy: never say a channel is "safe / suitable / recommended" — only whether it
// matches the parent's own settings. Calm yellow for "things to know"; red only for a mismatch.
const FIT = {
  good: { label: (n: string, _c: number) => `✅ Matches ${n}'s settings`, color: "#2E7D32", bg: "#E8F5E9", boxBg: "#E8F5E9", boxText: "#1B5E20" },
  caution: {
    label: (n: string, c: number) => `⚠️ ${c} ${c === 1 ? "thing" : "things"} to know for ${n}`,
    color: "#8A5A00",
    bg: "#FFF6E0",
    boxBg: "#FFF6E0",
    boxText: "#6B4600",
  },
  not_fit: { label: (n: string, _c: number) => `⛔ Doesn't match ${n}'s settings`, color: "#C62828", bg: "#FDECEA", boxBg: "#FDECEA", boxText: "#7A1E1E" },
  unchecked: { label: (_n: string, _c: number) => "We couldn't check this channel", color: "#555", bg: "#F0F0F5", boxBg: "#F0F0F5", boxText: "#444" },
} as const;

interface Props {
  result: CheckChannelResult;
  childName: string;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ChannelReview({ result, childName, confirming, onConfirm, onCancel }: Props) {
  const { channel, report, conflicts, findings } = result;
  // "things to know" only when there's something to list (older saved checks could be
  // "caution" for an AI-guessed audience age alone — never shown: policy, no audience estimates)
  const fit = result.fit === "caution" && conflicts.length === 0 ? "good" : result.fit;
  const badge = FIT[fit ?? "unchecked"];
  const thumbFindings = findings.filter((f) => f.basis === "thumbnails" || f.basis === "both");
  const videoFindings = findings.filter((f) => f.basis === "videos");
  const count = conflicts.length;
  const strong = !report || fit === "not_fit"; // red "Add anyway" only here

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

        <View style={[styles.verdict, { backgroundColor: badge.bg }]}>
          <Text style={[styles.verdictText, { color: badge.color }]}>{badge.label(childName, count)}</Text>
        </View>

        {!report ? (
          <Text style={styles.text}>
            Something went wrong checking it. You can still add it — its videos are checked one by one either way.
          </Text>
        ) : (
          <>
            {report.summary ? <Text style={styles.text}>{report.summary}</Text> : null}

            {conflicts.length ? (
              <View style={[styles.conflictBox, { backgroundColor: badge.boxBg }]}>
                <Text style={[styles.conflictTitle, { color: badge.color }]}>
                  {fit === "not_fit" ? `Doesn't match ${childName}'s settings` : `Past ${childName}'s settings`}
                </Text>
                {conflicts.map((c, i) => (
                  <Text key={i} style={[styles.conflict, { color: badge.boxText }]}>
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
            {thumbFindings.length ? (
              thumbFindings.map((f, i) => (
                <Text key={i} style={styles.text}>
                  • {f.what}
                </Text>
              ))
            ) : (
              <Text style={styles.text}>Nothing concerning in the latest thumbnails.</Text>
            )}

            {videoFindings.length ? (
              <>
                <Text style={styles.section}>From its videos we've already checked</Text>
                {videoFindings.map((f, i) => (
                  <Text key={i} style={styles.text}>
                    • {f.what}
                  </Text>
                ))}
              </>
            ) : null}

            <KideosNotes />
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
          style={[styles.addBtn, strong && styles.addBtnWarn, confirming && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={confirming}
        >
          {confirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addText}>{strong ? "Add anyway" : "Add channel"}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={confirming}>
          <Text style={styles.cancelText}>{strong ? "Don't add it" : "Cancel"}</Text>
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
  overall: { fontSize: 12, color: "#666", marginTop: 4 },
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
