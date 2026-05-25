// ─────────────────────────────────────────────────────────────
// Kideos for Parents — Firebase service layer
//
// All Firestore reads/writes and Cloud Function calls live here.
// Cloud Functions are called via authenticated fetch (no extra SDK needed).
// ─────────────────────────────────────────────────────────────

import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import type {
  ValueFilters,
  ChildProfile,
  WhitelistedChannel,
  FlaggedContent,
  ChannelSuggestion,
  WeeklyDigest,
  NowPlaying,
} from "../types";

const REGION = "us-central1";
const PROJECT_ID = "kideos-io";
const CF_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

// ─── Auth ────────────────────────────────────────────────────

export const signIn = (email: string, password: string) =>
  auth().signInWithEmailAndPassword(email, password);

export const signUp = (email: string, password: string) =>
  auth().createUserWithEmailAndPassword(email, password);

export const signOut = () => auth().signOut();

export const onAuthStateChanged = auth().onAuthStateChanged.bind(auth());

// ─── Helper: call a Gen-2 callable Cloud Function ────────────

async function callFunction<T>(name: string, data: object): Promise<T> {
  const idToken = await auth().currentUser?.getIdToken();
  const res = await fetch(`${CF_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloud Function ${name} failed: ${text}`);
  }
  const json = (await res.json()) as { result: T };
  return json.result;
}

// ─── Children ────────────────────────────────────────────────

export async function createChild(
  parentId: string,
  profile: ChildProfile
): Promise<string> {
  const ref = await firestore()
    .collection(`users/${parentId}/children`)
    .add({
      ...profile,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
  return ref.id;
}

export async function updateChild(
  parentId: string,
  childId: string,
  updates: Partial<ChildProfile>
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}`)
    .update(updates);
}

export function subscribeToChildren(
  parentId: string,
  onUpdate: (children: { id: string; profile: ChildProfile }[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children`)
    .onSnapshot((snap) => {
      const children = snap.docs.map((doc) => ({
        id: doc.id,
        profile: doc.data() as ChildProfile,
      }));
      onUpdate(children);
    });
}

// ─── Value Filters ───────────────────────────────────────────

export async function saveValueFilters(
  parentId: string,
  childId: string,
  filters: ValueFilters
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
    .set(filters, { merge: true });
}

export async function getValueFilters(
  parentId: string,
  childId: string
): Promise<ValueFilters | null> {
  const snap = await firestore()
    .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
    .get();
  return snap.exists ? (snap.data() as ValueFilters) : null;
}

// ─── Whitelisted Channels ────────────────────────────────────

export function subscribeToWhitelistedChannels(
  parentId: string,
  childId: string,
  onUpdate: (channels: WhitelistedChannel[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children/${childId}/whitelistedChannels`)
    .orderBy("addedAt", "desc")
    .onSnapshot((snap) => {
      const channels = snap.docs.map((doc) => doc.data() as WhitelistedChannel);
      onUpdate(channels);
    });
}

export async function addChannel(
  parentId: string,
  childId: string,
  input: string
): Promise<{ channelId: string; name: string }> {
  return callFunction<{ channelId: string; name: string }>(
    "resolveAndAddChannel",
    { parentId, childId, input }
  );
}

export async function removeChannel(
  parentId: string,
  childId: string,
  channelId: string
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/whitelistedChannels/${channelId}`)
    .delete();
}

// ─── Now Playing / Remote Control ────────────────────────────

export function subscribeToNowPlaying(
  parentId: string,
  childId: string,
  onUpdate: (nowPlaying: NowPlaying | null) => void
): () => void {
  return firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/nowPlaying`)
    .onSnapshot((snap) => {
      onUpdate(snap.exists ? (snap.data() as NowPlaying) : null);
    });
}

export async function sendPlaySignal(
  parentId: string,
  childId: string,
  action: "play" | "pause" | "stop"
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/currentSession/parentCommand`)
    .set({
      action,
      sentAt: firestore.FieldValue.serverTimestamp(),
    });
}

// ─── Flagged Content ─────────────────────────────────────────

export function subscribeToFlaggedContent(
  parentId: string,
  childId: string,
  onUpdate: (items: FlaggedContent[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children/${childId}/flaggedContent`)
    .orderBy("timestamp", "desc")
    .limit(20)
    .onSnapshot((snap) => {
      const items = snap.docs.map((doc) => doc.data() as FlaggedContent);
      onUpdate(items);
    });
}

export async function markFlaggedViewed(
  parentId: string,
  childId: string,
  contentId: string
): Promise<void> {
  await firestore()
    .doc(
      `users/${parentId}/children/${childId}/flaggedContent/${contentId}`
    )
    .update({ parentViewed: true });
}

// ─── Channel Suggestions ─────────────────────────────────────

export function subscribeToChannelSuggestions(
  parentId: string,
  childId: string,
  onUpdate: (suggestions: ChannelSuggestion[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children/${childId}/suggestions`)
    .where("parentResponse", "==", "pending")
    .orderBy("generatedAt", "desc")
    .onSnapshot((snap) => {
      const suggestions = snap.docs.map(
        (doc) => doc.data() as ChannelSuggestion
      );
      onUpdate(suggestions);
    });
}

export async function respondToSuggestion(
  parentId: string,
  childId: string,
  channelId: string,
  response: "approved" | "denied"
): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/suggestions/${channelId}`)
    .update({ parentResponse: response });

  // If approved, kick off seeding — the document ID is the channelId
  if (response === "approved") {
    await addChannel(parentId, childId, channelId);
  }
}

// ─── Weekly Digests ──────────────────────────────────────────

export function subscribeToDigests(
  parentId: string,
  onUpdate: (digests: WeeklyDigest[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/digests`)
    .orderBy("generatedAt", "desc")
    .limit(10)
    .onSnapshot((snap) => {
      const digests = snap.docs.map((doc) => doc.data() as WeeklyDigest);
      onUpdate(digests);
    });
}

// ─── Pairing ─────────────────────────────────────────────────

export async function claimPairingCode(
  code: string,
  parentId: string,
  childId: string,
  childName: string,
  childAge: number
): Promise<void> {
  const ref = firestore().doc(`pairingCodes/${code.toUpperCase()}`);
  const snap = await ref.get();

  if (!snap.exists) throw new Error("Invalid code. Please try again.");

  const data = snap.data()!;
  if (data.claimed) throw new Error("This code has already been used.");

  const expiresAt = data.expiresAt?.toDate?.() as Date | undefined;
  if (expiresAt && expiresAt < new Date()) {
    throw new Error("This code has expired. Ask the child to generate a new one.");
  }

  await ref.update({
    claimed: true,
    parentId,
    childId,
    childName,
    childAge,
    claimedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ─── Data deletion ───────────────────────────────────────────

export async function deleteChildData(
  parentId: string,
  childId: string
): Promise<void> {
  await callFunction("deleteChildData", { parentId, childId });
}
