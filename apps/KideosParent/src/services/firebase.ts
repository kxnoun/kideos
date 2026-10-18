// ─────────────────────────────────────────────────────────────
// Kideos for Parents — Firebase service layer
//
// All Firestore reads/writes and Cloud Function calls live here.
// Cloud Functions are called via authenticated fetch (no extra SDK needed).
// ─────────────────────────────────────────────────────────────

import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import appleAuth from "@invertase/react-native-apple-authentication";
import type {
  ValueFilters,
  ChildProfile,
  WhitelistedChannel,
  VideoVerdict,
  WeeklyDigest,
  NowPlaying,
  ChannelSuggestion,
  SuggestedChannel,
} from "../types";

// TODO: paste your Web Client ID from Firebase Console →
//       Project Settings → Your apps → Web app → OAuth 2.0 client_id
const GOOGLE_WEB_CLIENT_ID = "530175410554-ma7s33gove3f3esp8l1o2ckdtuu9snrv.apps.googleusercontent.com";

// Configure once at module load — must happen before any GoogleSignin call
GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

const REGION = "us-central1";
const PROJECT_ID = "kideos-io";
const CF_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

// ─── Auth ────────────────────────────────────────────────────

export const signIn = (email: string, password: string) =>
  auth().signInWithEmailAndPassword(email, password);

export const signUp = (email: string, password: string) =>
  auth().createUserWithEmailAndPassword(email, password);

export async function signOut() {
  await auth().signOut();
  // Also clear the cached Google account so the next sign-in shows the account picker
  await GoogleSignin.signOut();
}

export const onAuthStateChanged = auth().onAuthStateChanged.bind(auth());

export async function createUserProfile(uid: string, email: string): Promise<void> {
  await firestore().doc(`users/${uid}`).set(
    { email, createdAt: firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  // v13+ returns { data: { idToken } }; v10-12 returns { idToken } directly
  const idToken =
    (response as { data?: { idToken?: string } }).data?.idToken ??
    (response as { idToken?: string }).idToken;
  if (!idToken) throw new Error("Google Sign-In failed — no ID token returned.");
  const credential = auth.GoogleAuthProvider.credential(idToken);
  const userCred = await auth().signInWithCredential(credential);
  if (userCred.additionalUserInfo?.isNewUser) {
    await createUserProfile(userCred.user.uid, userCred.user.email ?? "");
  }
  return userCred;
}

export async function signInWithApple() {
  const response = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
  });
  if (!response.identityToken) {
    throw new Error("Apple Sign-In failed — no identity token returned.");
  }
  const credential = auth.AppleAuthProvider.credential(
    response.identityToken,
    response.nonce
  );
  const userCred = await auth().signInWithCredential(credential);
  if (userCred.additionalUserInfo?.isNewUser) {
    await createUserProfile(userCred.user.uid, userCred.user.email ?? "");
  }
  return userCred;
}

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
    .onSnapshot(
      (snap) => {
        const children = snap.docs.map((doc) => ({
          id: doc.id,
          profile: doc.data() as ChildProfile,
        }));
        onUpdate(children);
      },
      (err) => {
        console.warn("[children] listener error:", err);
        // Unblock the loading state so the app doesn't hang if Firestore
        // is temporarily unavailable or rules are not yet deployed.
        onUpdate([]);
      }
    );
}

// ─── Value Filters ───────────────────────────────────────────

export async function saveValueFilters(
  parentId: string,
  childId: string,
  filters: ValueFilters
): Promise<void> {
  // Full overwrite: drops fields from the old (v1) filter format
  await firestore()
    .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
    .set(filters);
}

export async function getValueFilters(
  parentId: string,
  childId: string
): Promise<Record<string, unknown> | null> {
  const snap = await firestore()
    .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
    .get();
  // Raw doc (may be the old v1 format) — callers pass it through normalizePrefs()
  return snap.exists() ? (snap.data() ?? null) : null;
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

// ─── Suggested channels ──────────────────────────────────────

export async function getChannelSuggestions(parentId: string, childId: string): Promise<SuggestedChannel[]> {
  const res = await callFunction<{ suggestions: SuggestedChannel[] }>("getChannelSuggestions", { parentId, childId });
  return res.suggestions;
}

// "Not for us" — this channel is never suggested to this child again
export async function dismissSuggestion(parentId: string, childId: string, channelId: string): Promise<void> {
  await firestore()
    .doc(`users/${parentId}/children/${childId}/dismissedSuggestions/${channelId}`)
    .set({ dismissedAt: firestore.FieldValue.serverTimestamp() });
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
      onUpdate(snap.exists() ? (snap.data() as NowPlaying) : null);
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

// ─── Videos (per-child verdicts) ─────────────────────────────

// Everything analyzed for this child, newest first — the Videos screen splits it
// into Shown (approved) and Hidden.
export function subscribeToVerdicts(
  parentId: string,
  childId: string,
  onUpdate: (verdicts: VideoVerdict[]) => void
): () => void {
  return firestore()
    .collection(`users/${parentId}/children/${childId}/videoVerdicts`)
    .orderBy("publishedAt", "desc")
    .limit(500)
    .onSnapshot(
      (snap) => onUpdate(snap.docs.map((doc) => doc.data() as VideoVerdict)),
      (err) => console.warn("[videoVerdicts] listener error:", err)
    );
}

// "Show anyway" (decision = "approved") or undo it (decision = null → back to
// what the child's answers decided). Security rules only allow these two fields.
export async function setShowAnyway(
  parentId: string,
  childId: string,
  verdict: VideoVerdict,
  show: boolean
): Promise<void> {
  const ref = firestore().doc(`users/${parentId}/children/${childId}/videoVerdicts/${verdict.videoId}`);
  if (show) {
    await ref.update({ parentDecision: "approved", approved: true });
  } else {
    await ref.update({ parentDecision: firestore.FieldValue.delete(), approved: verdict.status === "approved" });
  }
}

// Free-text "anything else?" → concrete questionnaire changes (parent confirms before applying)
export interface RuleChange {
  key: string;
  value: string | number;
  explanation: string;
}
export async function parseCustomRules(
  parentId: string,
  text: string
): Promise<{ changes: RuleChange[]; remaining: string }> {
  return callFunction("parseCustomRules", { parentId, text });
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

  if (!snap.exists()) throw new Error("Invalid code. Please try again.");

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
