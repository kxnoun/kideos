// Kideos Kid App — BackButton: a round button with a drawn chevron (text arrows
// render thin and off-centre). "action" = orange (feed pages), "quiet" = see-through
// (over the black around a playing video).

import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Tap from "./Tap";
import { colors } from "../theme";

interface Props {
  size: number;
  onPress: () => void;
  label: string;
  direction?: "left" | "down";
  variant?: "action" | "quiet";
  outerStyle?: StyleProp<ViewStyle>;
}

export default function BackButton({ size, onPress, label, direction = "left", variant = "action", outerStyle }: Props) {
  const quiet = variant === "quiet";
  const arm = Math.round(size * 0.3); // chevron arm length
  const stroke = Math.max(4, Math.round(size * 0.085));
  return (
    <Tap
      outerStyle={outerStyle}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: quiet ? "rgba(255, 255, 255, 0.16)" : colors.action,
        alignItems: "center",
        justifyContent: "center",
      }}
      onPress={onPress}
      accessibilityLabel={label}
    >
      {/* An "L" of two borders turned 45° = a chevron; nudged so it looks centred */}
      <View
        style={{
          width: arm,
          height: arm,
          borderLeftWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: quiet ? colors.text : colors.ink,
          borderRadius: stroke / 2,
          marginLeft: direction === "left" ? arm * 0.35 : 0,
          marginTop: direction === "down" ? -arm * 0.35 : 0,
          transform: [{ rotate: direction === "left" ? "45deg" : "-45deg" }],
        }}
      />
    </Tap>
  );
}
