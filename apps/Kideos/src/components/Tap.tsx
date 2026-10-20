// Kideos Kid App — Tap: every tappable thing in the kid app.
// Feedback on press-IN (kids lift slowly or slide off), a gentle squish, generous
// hit area. No long-press / double-tap anywhere. With Reduce Motion on, it dims
// instead of squishing.

import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

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

interface Props extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>; // the squishing box
  outerStyle?: StyleProp<ViewStyle>; // placement in the parent (margins, flex)
  scaleTo?: number;
  children: React.ReactNode;
}

export default function Tap({ style, outerStyle, scaleTo = 0.95, children, hitSlop = 12, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 8 : 0 }).start();

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      style={outerStyle}
      onPressIn={() => !reduce && to(scaleTo)}
      onPressOut={() => !reduce && to(1)}
      {...rest}
    >
      {({ pressed }) => (
        <Animated.View style={[style, { transform: [{ scale }] }, reduce && pressed ? { opacity: 0.6 } : null]}>
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}
