// Kideos Kid App — TypeScript types

import { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
type Timestamp = FirebaseFirestoreTypes.Timestamp;

// What the screens get for the child who's watching now
export interface ChildSession {
  parentId: string;
  childId: string;
  childName: string;
  childAge: number;
  paired: boolean;
}

// Saved on the device (AsyncStorage). Since Oct 20, 2026 a device is paired to the
// family; users/{parentId}/kidDevices/{this device's UID} says which children use it.
export interface DeviceSession {
  parentId: string;
  paired: true;
  version: 2;
}

// Devices paired before Oct 20, 2026 saved one child; moved over once (App.tsx)
export interface LegacySession {
  parentId: string;
  childId: string;
  childName: string;
  childAge: number;
  paired: boolean;
}

export type StoredSession = DeviceSession | LegacySession;

export function isLegacySession(s: StoredSession | null): s is LegacySession {
  return Boolean(s && "childId" in s && (s as LegacySession).childId);
}

// users/{parentId}/kidDevices/{uid}
export interface KidDevice {
  childIds: string[];
  // Ask "Who's watching?" after the app has been away this long (0 = every time it opens)
  askWhoAfterMinutes: number;
}

// Live from the child doc (the parent can change it any time); age picks the layout
export interface KidProfile {
  name: string;
  age: number;
  avatar: string; // an emoji
}

// One child on this device (from their child doc)
export interface DeviceChild extends KidProfile {
  id: string;
  pinHash?: string; // a profile PIN is set (src/pin.ts)
  viewing?: unknown; // raw viewing rules → normalizeRules
}

export type SeedingStatus = "pending" | "ready" | "error";

export interface WhitelistedChannel {
  channelId: string;
  name: string;
  thumbnail: string;
  seedingStatus: SeedingStatus;
  videoCount: number;
}

export interface ApprovedVideo {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  thumbnail: string;
  publishedAt: Timestamp;
  durationSeconds: number | null;
  isShort?: boolean; // a YouTube Short (verdicts since profile v7)
}

// Where a tapped thumbnail sits on screen (window coordinates) — the player zooms out of it
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Parent's viewing rules (child doc → viewing): stay at least this long on a video
// before switching — 0 (off) / 30 / 60 / 120 seconds, or -1 = the whole video.
export interface ViewingRules {
  minWatchSeconds: number;
}

export type PlaySignalAction = "play" | "pause" | "stop";

export interface PlaySignal {
  action: PlaySignalAction;
  initiatedBy: "parent";
  updatedAt: Timestamp;
}

export type RootStackParamList = {
  Pairing: undefined;
  Feed: undefined;
  Player: { video: ApprovedVideo };
};
