// Kideos Kid App — window controls (Android native module: KideosWindowModule.kt).
// iOS: no-ops for now (iPad landscape lock needs AppDelegate work — docs/kid-app-design.md).

import { NativeModules, Platform } from "react-native";

const native = Platform.OS === "android" ? NativeModules.KideosWindow : null;
if (Platform.OS === "android" && !native) {
  // Landscape lock + hidden bars won't work — the app was built before KideosWindowModule existed
  console.warn("[device] KideosWindow native module missing — rebuild the kid app with Gradle");
}

// Young mode: landscape only (either way up). Older kids: free to rotate.
export function setLandscapeOnly(on: boolean): void {
  if (__DEV__) console.log(`[device] landscape only: ${on}`);
  native?.setLandscapeOnly(on);
}

// Bars back to hidden (MainActivity also does this whenever the app gets focus)
export function hideSystemBars(): void {
  native?.hideSystemBars();
}
