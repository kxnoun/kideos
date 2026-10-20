// ─────────────────────────────────────────────────────────────
// Kideos for Parents — KideosNotes
//
// YouTube's API policy (Developer Policies III.E.4.h): anything shown that isn't
// YouTube's own data needs "a clear and prominent disclosure" that it's ours, not
// YouTube's. Put this under every block of Kideos analysis — ratings, reasons,
// summaries, channel checks, suggestion notes. Wording rules: docs/backlog.md →
// YouTube policy. Never "safe / suitable", never scores or audience ages.
// ─────────────────────────────────────────────────────────────

import React from "react";
import { Text, StyleSheet, type StyleProp, type TextStyle } from "react-native";

export const KIDEOS_NOTES = "ⓘ Kideos' own notes, from our analysis — not from YouTube";

export default function KideosNotes({ style }: { style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.note, style]}>{KIDEOS_NOTES}</Text>;
}

const styles = StyleSheet.create({
  note: { fontSize: 12, color: "#8A8AA0", marginTop: 6, fontStyle: "italic" },
});
