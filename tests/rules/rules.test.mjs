// Firestore security rules tests — run via `firebase emulators:exec` (see README.md)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, deleteField, serverTimestamp } from "firebase/firestore";

const rules = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
const env = await initializeTestEnvironment({ projectId: "demo-kideos", firestore: { rules } });

const P = "parentA", C = "kid1", KID = "kidDevice1", STRANGER = "strangerDevice", OTHER_PARENT = "parentB";
const base = `users/${P}/children/${C}`;

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${P}`), { email: "a@x" });
    await setDoc(doc(db, base), { name: "Simon", age: 14, kidDeviceUids: [KID] });
    await setDoc(doc(db, `${base}/valueFilters/current`), { version: 2 });
    await setDoc(doc(db, `${base}/whitelistedChannels/CH`), { seedingStatus: "ready", name: "Chan" });
    await setDoc(doc(db, `${base}/videoVerdicts/v1`), { videoId: "v1", status: "hidden", approved: false, reason: "x" });
    await setDoc(doc(db, `${base}/videoVerdicts/v2`), { videoId: "v2", status: "approved", approved: true, reason: "" });
    await setDoc(doc(db, `${base}/currentSession/playSignal`), { action: "play" });
    await setDoc(doc(db, `${base}/watchHistory/s1`), { videoId: "v2", endedAt: null, durationSeconds: null });
    await setDoc(doc(db, `pairingCodes/ABC123`), { code: "ABC123", claimed: false, deviceUid: "newDevice" });
  });
}

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
let fails = 0;
async function t(name, fn) {
  await seed();
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    fails++;
    console.log(`FAIL  ${name}  — ${e.message?.split("\n")[0]}`);
  }
}

// ── Paired kid device ──
await t("paired kid reads its child's approved verdicts (feed query)", () =>
  assertSucceeds(getDocs(query(collection(as(KID), `${base}/videoVerdicts`), where("approved", "==", true)))));
await t("paired kid reads whitelist", () => assertSucceeds(getDocs(collection(as(KID), `${base}/whitelistedChannels`))));
await t("paired kid reads playSignal", () => assertSucceeds(getDoc(doc(as(KID), `${base}/currentSession/playSignal`))));
await t("paired kid writes nowPlaying", () => assertSucceeds(setDoc(doc(as(KID), `${base}/currentSession/nowPlaying`), { videoId: "v2" })));
await t("paired kid creates a watch session", () => assertSucceeds(setDoc(doc(as(KID), `${base}/watchHistory/s2`), { videoId: "v2" })));
await t("paired kid ends a watch session", () =>
  assertSucceeds(updateDoc(doc(as(KID), `${base}/watchHistory/s1`), { endedAt: serverTimestamp(), durationSeconds: 30 })));
await t("paired kid can't change other watch-session fields", () => assertFails(updateDoc(doc(as(KID), `${base}/watchHistory/s1`), { videoId: "x" })));
await t("paired kid can't read questionnaire answers", () => assertFails(getDoc(doc(as(KID), `${base}/valueFilters/current`))));
await t("paired kid can't 'Show anyway'", () => assertFails(updateDoc(doc(as(KID), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: true })));
await t("paired kid can't send parent commands", () => assertFails(setDoc(doc(as(KID), `${base}/currentSession/parentCommand`), { action: "play" })));
await t("paired kid reads its child doc", () => assertSucceeds(getDoc(doc(as(KID), base))));

// ── Unpaired anonymous device / strangers ──
await t("unpaired device can't read verdicts", () => assertFails(getDocs(collection(as(STRANGER), `${base}/videoVerdicts`))));
await t("unpaired device can't read whitelist", () => assertFails(getDocs(collection(as(STRANGER), `${base}/whitelistedChannels`))));
await t("unpaired device can't read session", () => assertFails(getDoc(doc(as(STRANGER), `${base}/currentSession/playSignal`))));
await t("unpaired device can't write nowPlaying", () => assertFails(setDoc(doc(as(STRANGER), `${base}/currentSession/nowPlaying`), { videoId: "v" })));
await t("unpaired device can't create watch history", () => assertFails(setDoc(doc(as(STRANGER), `${base}/watchHistory/s9`), { videoId: "v" })));
await t("unpaired device can't read the child doc", () => assertFails(getDoc(doc(as(STRANGER), base))));
await t("signed-out user can't read verdicts", () => assertFails(getDocs(collection(anon(), `${base}/videoVerdicts`))));
await t("another parent can't read this child", () => assertFails(getDocs(collection(as(OTHER_PARENT), `${base}/videoVerdicts`))));
await t("another parent can't add their device to this child", () =>
  assertFails(updateDoc(doc(as(OTHER_PARENT), base), { kidDeviceUids: [KID, "theirs"] })));

// ── Parent ──
await t("parent reads verdicts", () => assertSucceeds(getDocs(collection(as(P), `${base}/videoVerdicts`))));
await t("parent reads/writes answers", () => assertSucceeds(setDoc(doc(as(P), `${base}/valueFilters/current`), { version: 2 })));
await t("parent 'Show anyway' (approved + parentDecision)", () =>
  assertSucceeds(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: true })));
await t("parent can't set approved without matching decision", () =>
  assertFails(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: false })));
await t("parent can't flip approved alone", () => assertFails(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { approved: true })));
await t("parent can't edit other verdict fields", () =>
  assertFails(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: true, reason: "" })));
await t("parent undo (clear decision, approved back to status)", async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: true }));
  await assertSucceeds(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { parentDecision: deleteField(), approved: false }));
});
await t("parent undo must restore approved to match status", async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), `${base}/videoVerdicts/v1`), { parentDecision: "approved", approved: true }));
  await assertFails(updateDoc(doc(as(P), `${base}/videoVerdicts/v1`), { parentDecision: deleteField(), approved: true }));
});
await t("parent adds a paired device to their child", () =>
  assertSucceeds(updateDoc(doc(as(P), base), { kidDeviceUids: [KID, "newDevice"] })));

// ── Pairing codes ──
await t("kid device creates a code with its own UID", () =>
  assertSucceeds(setDoc(doc(as("dev9"), "pairingCodes/ZZZ999"), { code: "ZZZ999", claimed: false, deviceUid: "dev9" })));
await t("can't create a code for another device's UID", () =>
  assertFails(setDoc(doc(as("dev9"), "pairingCodes/ZZZ998"), { code: "ZZZ998", claimed: false, deviceUid: "someoneElse" })));
await t("signed-out can't create a code", () =>
  assertFails(setDoc(doc(anon(), "pairingCodes/ZZZ997"), { code: "ZZZ997", claimed: false, deviceUid: "x" })));
await t("parent claims a code as themselves", () =>
  assertSucceeds(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: P, childId: C })));
await t("can't claim a code in someone else's name", () =>
  assertFails(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: OTHER_PARENT, childId: C })));
await t("can't swap the device UID while claiming", () =>
  assertFails(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: P, childId: C, deviceUid: "evil" })));
await t("can't re-claim a claimed code", async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "pairingCodes/ABC123"), { claimed: true, parentId: P }));
  await assertFails(updateDoc(doc(as(OTHER_PARENT), "pairingCodes/ABC123"), { claimed: true, parentId: OTHER_PARENT }));
});

// ── "Too hyper" reports ──
await t("parent reports a video as too hyper", () =>
  assertSucceeds(setDoc(doc(as(P), `videoProfiles/v1/paceReports/${P}`), { childId: C })));
await t("can't report in another parent's name", () =>
  assertFails(setDoc(doc(as(P), `videoProfiles/v1/paceReports/${OTHER_PARENT}`), { childId: C })));
await t("can't read others' reports", () => assertFails(getDoc(doc(as(OTHER_PARENT), `videoProfiles/v1/paceReports/${P}`))));
await t("parent can't write the profile itself", () =>
  assertFails(setDoc(doc(as(P), "videoProfiles/v1"), { tooHyperReports: 99 })));

await env.cleanup();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
