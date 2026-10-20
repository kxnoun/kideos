// Kideos Kid App — window controls (Android native module: KideosWindowModule.kt).
// iOS: no-ops for now (iPad landscape lock needs AppDelegate work — docs/kid-app-design.md).

import { NativeModules, Platform } from "react-native";

const native = Platform.OS === "android" ? NativeModules.KideosWindow : null;

// Young mode: landscape only (either way up). Older kids: free to rotate.
export function setLandscapeOnly(on: boolean): void {
  native?.setLandscapeOnly(on);
}

// Bars back to hidden (MainActivity also does this whenever the app gets focus)
export function hideSystemBars(): void {
  native?.hideSystemBars();
}
