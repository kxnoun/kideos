// Kideos Kid App — TypeScript types

import { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
type Timestamp = FirebaseFirestoreTypes.Timestamp;

export interface ChildSession {
  parentId: string;
  childId: string;
  childName: string;
  childAge: number;
  paired: boolean;
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
