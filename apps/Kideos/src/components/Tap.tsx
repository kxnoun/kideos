// Kideos Kid App — Tap: every tappable thing in the kid app.
// Feedback on press-IN (kids lift slowly or slide off): a gentle squish plus a light
// "lit up" wash over the button while the finger is on it.
// Generous hit area. No long-press / double-tap anywhere. With Reduce Motion on, no
// squish — the light still shows.
// highlight={false} where a wash would look wrong (thumbnails, the round channel
// bubbles, the profile switcher, the "Who's watching?" tiles which light their own square).

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

let reduceMotion = false;
const listeners = new Set<(v: boolean) => void>();
AccessibilityInfo.isReduceMotionEnabled().then((v) => {
  reduceMotion = v;
  listeners.forEach((l) => l(v));
});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
  reduceMotion = v;
  listeners.forEach((l) => l(v));
});

export function useReduceMotion(): boolean {
  const [v, setV] = useState(reduceMotion);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

export const LIT = "rgba(255, 255, 255, 0.2)"; // the pressed wash

interface Props extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>; // the squishing box
  outerStyle?: StyleProp<ViewStyle>; // placement in the parent (margins, flex)
  scaleTo?: number;
  highlight?: boolean; // light up while pressed (default on)
  children: React.ReactNode;
}

export default function Tap({
  style,
  outerStyle,
  scaleTo = 0.95,
  highlight = true,
  children,
  hitSlop = 12,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const [lit, setLit] = useState(false);

  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 8 : 0 }).start();

  const pressIn = (e: GestureResponderEvent) => {
    if (!reduce) to(scaleTo);
    if (highlight) setLit(true);
    onPressIn?.(e);
  };
  const pressOut = (e: GestureResponderEvent) => {
    if (!reduce) to(1);
    if (highlight) setLit(false);
    onPressOut?.(e);
  };

  const radius = StyleSheet.flatten(style)?.borderRadius ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      style={outerStyle}
      onPressIn={pressIn}
      onPressOut={pressOut}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
        {lit ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: LIT }]} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
