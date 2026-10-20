// ─────────────────────────────────────────────────────────────
// Kideos Kid App — "Who's watching?"
//
// Shown on a device more than one child uses (users/{p}/kidDevices/{uid}.childIds):
// after a full restart, and when the app has been away longer than the parent's
// setting (src/gate.ts). Big avatar tiles, Netflix style; a child with a profile PIN
// (set in the parent app — src/pin.ts) types it on a number pad first. 🌙 = a parent
// ended that child's session (they can still pick it — they'll see Time's up).
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from "react";
import { Animated, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, useLayout } from "../theme";
import { PIN_LENGTH, hashPin } from "../pin";
import Tap, { useReduceMotion } from "../components/Tap";
import BackButton from "../components/BackButton";
import type { DeviceChild } from "../types";

const TILE_COLORS = [colors.brand, colors.action, colors.success, colors.focus, colors.brandOnDark, colors.error];
const MAX_TRIES = 5;
const WAIT_MS = 30_000;

// Wrong tries per child — survives going back to the tiles (not a restart)
const tries: Record<string, { fails: number; until: number }> = {};

interface Props {
  kids: DeviceChild[];
  locked: Record<string, boolean>;
  onChoose: (childId: string) => void;
}

export default function WhoScreen({ kids, locked, onChoose }: Props) {
  const [pinFor, setPinFor] = useState<DeviceChild | null>(null);
  const layout = useLayout();
  const insets = useSafeAreaInsets();

  if (pinFor) {
    return (
      <PinPad
        kid={pinFor}
        onBack={() => setPinFor(null)}
        onOk={() => {
          setPinFor(null);
          onChoose(pinFor.id);
        }}
      />
    );
  }

  const tile = layout.phone ? 112 : 160;
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingHorizontal: layout.margin },
      ]}
    >
      <StatusBar hidden />
      <Text style={[styles.title, { fontSize: layout.phone ? 32 : 44 }]}>Who's watching?</Text>
      <View style={[styles.tiles, { gap: layout.phone ? 20 : 32 }]}>
        {kids.map((k, i) => (
          <Tap
            key={k.id}
            style={styles.tileWrap}
            onPress={() => (k.pinHash ? setPinFor(k) : onChoose(k.id))}
            accessibilityLabel={`${k.name}${k.pinHash ? ", needs a PIN" : ""}${locked[k.id] ? ", time's up" : ""}`}
          >
            <View
              style={[
                styles.tile,
                { width: tile, height: tile, backgroundColor: TILE_COLORS[i % TILE_COLORS.length] },
              ]}
            >
              <Text style={{ fontSize: tile * 0.52 }}>{k.avatar || "🙂"}</Text>
              {k.pinHash ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>🔒</Text>
                </View>
              ) : null}
              {locked[k.id] ? (
                <View style={[styles.badge, styles.badgeLeft]}>
                  <Text style={styles.badgeText}>🌙</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.name, { maxWidth: tile + 24 }]} numberOfLines={1}>
              {k.name}
            </Text>
          </Tap>
        ))}
      </View>
    </View>
  );
}

// ── PIN pad ──────────────────────────────────────────────────

function PinPad({ kid, onBack, onOk }: { kid: DeviceChild; onBack: () => void; onOk: () => void }) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [digits, setDigits] = useState("");
  const [wrong, setWrong] = useState(false);
  const [now, setNow] = useState(Date.now());
  const shake = useRef(new Animated.Value(0)).current;

  const t = (tries[kid.id] ??= { fails: 0, until: 0 });
  const waiting = t.until > now;

  // Count down the wait after too many wrong tries
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const press = (d: string) => {
    if (waiting) return;
    setWrong(false);
    const next = (digits + d).slice(0, PIN_LENGTH);
    setDigits(next);
    if (next.length < PIN_LENGTH) return;
    if (hashPin(kid.id, next) === kid.pinHash) {
      t.fails = 0;
      onOk();
      return;
    }
    t.fails += 1;
    if (t.fails >= MAX_TRIES) {
      t.fails = 0;
      t.until = Date.now() + WAIT_MS;
      setNow(Date.now());
    }
    setWrong(true);
    setDigits("");
    if (!reduceMotion) {
      shake.setValue(0);
      Animated.sequence(
        [14, -14, 10, -10, 5, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 50, useNativeDriver: true }))
      ).start();
    }
  };

  // Phones in landscape: the number pad goes beside the name, not under it
  const sideBySide = layout.landscape && layout.height < 600;
  const gap = 12;
  const maxKey = layout.phone ? 72 : 88;
  const usableH = layout.height - insets.top - insets.bottom - 48;
  const key = Math.floor(Math.min(maxKey, (sideBySide ? usableH : usableH - 260) / 4 - gap));

  const message = waiting
    ? `Too many tries — wait ${Math.ceil((t.until - now) / 1000)} s`
    : wrong
      ? "Not quite — try again"
      : "Type your PIN";

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom, paddingHorizontal: layout.margin },
        sideBySide && styles.row,
      ]}
    >
      <StatusBar hidden />
      <BackButton
        size={layout.touch}
        onPress={onBack}
        label="Back to Who's watching"
        outerStyle={[styles.back, { top: insets.top + 12, left: insets.left + layout.margin }]}
      />

      <View style={[styles.who, sideBySide && { marginRight: 48 }]}>
        <Text style={{ fontSize: layout.phone ? 56 : 72 }}>{kid.avatar || "🙂"}</Text>
        <Text style={styles.pinName}>{kid.name}</Text>
        <Text style={[styles.pinMessage, (wrong || waiting) && { color: colors.error }]}>{message}</Text>
        <Animated.View style={[styles.dots, { transform: [{ translateX: shake }] }]}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <View key={i} style={[styles.dot, i < digits.length && styles.dotOn]} />
          ))}
        </Animated.View>
        <Text style={styles.forgot}>Forgot it? Ask a grown-up to change it in Kideos for Parents.</Text>
      </View>

      <View style={[styles.keypad, { width: key * 3 + gap * 2, gap }]}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
          k === "" ? (
            <View key={i} style={{ width: key, height: key }} />
          ) : (
            <Tap
              key={i}
              disabled={waiting}
              style={[
                styles.key,
                { width: key, height: key, borderRadius: key / 2 },
                waiting && { backgroundColor: colors.disabled },
              ]}
              onPress={() => (k === "⌫" ? setDigits((d) => d.slice(0, -1)) : press(k))}
              accessibilityLabel={k === "⌫" ? "Delete" : k}
            >
              <Text style={[styles.keyText, { fontSize: key * 0.4 }]}>{k}</Text>
            </Tap>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row" },
  title: { color: colors.text, fontFamily: fonts.displayBold, textAlign: "center", marginBottom: 32 },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  tileWrap: { alignItems: "center" },
  tile: { borderRadius: 32, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.bg,
  },
  badgeLeft: { right: undefined, left: -8 },
  badgeText: { fontSize: 18 },
  name: { color: colors.text, fontFamily: fonts.display, fontSize: 22, marginTop: 12, textAlign: "center" },

  back: { position: "absolute", zIndex: 2 },
  who: { alignItems: "center", marginBottom: 24, maxWidth: 360 },
  pinName: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 28, marginTop: 6 },
  pinMessage: { color: colors.textSecondary, fontFamily: fonts.display, fontSize: 19, marginTop: 10 },
  dots: { flexDirection: "row", gap: 16, marginTop: 18 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: colors.brandOnDark },
  dotOn: { backgroundColor: colors.focus, borderColor: colors.focus },
  forgot: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: "center",
    marginTop: 18,
    opacity: 0.8,
  },
  keypad: { flexDirection: "row", flexWrap: "wrap" },
  key: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.text, fontFamily: fonts.display },
});
