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
    await setDoc(doc(db, base), { name: "Simon", age: 14 });
    await setDoc(doc(db, `users/${P}/children/kid2`), { name: "Jamal", age: 4 });
    await setDoc(doc(db, `users/${P}/children/kid2/whitelistedChannels/CH`), { seedingStatus: "ready" });
    // KID may use Simon only
    await setDoc(doc(db, `users/${P}/kidDevices/${KID}`), { childIds: [C], askWhoAfterMinutes: 5 });
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
await t("another parent can't add a device to this family", () =>
  assertFails(setDoc(doc(as(OTHER_PARENT), `users/${P}/kidDevices/theirs`), { childIds: [C] })));
await t("paired kid can't read a sibling it isn't paired to", () =>
  assertFails(getDocs(collection(as(KID), `users/${P}/children/kid2/whitelistedChannels`))));
await t("paired kid can't read the sibling's child doc", () => assertFails(getDoc(doc(as(KID), `users/${P}/children/kid2`))));

// ── Kid devices ──
await t("kid device reads its own device doc", () => assertSucceeds(getDoc(doc(as(KID), `users/${P}/kidDevices/${KID}`))));
await t("kid device can't read another device's doc", () =>
  assertFails(getDoc(doc(as(STRANGER), `users/${P}/kidDevices/${KID}`))));
await t("kid device can't add children to itself", () =>
  assertFails(updateDoc(doc(as(KID), `users/${P}/kidDevices/${KID}`), { childIds: [C, "kid2"] })));
await t("parent lists their kid devices", () => assertSucceeds(getDocs(collection(as(P), `users/${P}/kidDevices`))));
await t("after the parent adds the sibling, the device can read it", async () => {
  await assertSucceeds(updateDoc(doc(as(P), `users/${P}/kidDevices/${KID}`), { childIds: [C, "kid2"] }));
  await assertSucceeds(getDoc(doc(as(KID), `users/${P}/children/kid2`)));
});
await t("after unpairing (doc deleted), the device reads nothing", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `users/${P}/kidDevices/${KID}`), { childIds: [] }));
  await assertFails(getDocs(collection(as(KID), `${base}/whitelistedChannels`)));
});

// ── Moving over old pairings ──
await t("device asks to be moved over (own UID)", () =>
  assertSucceeds(setDoc(doc(as("old1"), "deviceMigrations/old1"), { parentId: P, childId: C, createdAt: serverTimestamp() })));
await t("can't ask in another device's name", () =>
  assertFails(setDoc(doc(as("old1"), "deviceMigrations/old2"), { parentId: P, childId: C })));
await t("can't add extra fields to the request", () =>
  assertFails(setDoc(doc(as("old1"), "deviceMigrations/old1"), { parentId: P, childId: C, status: "done" })));

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
await t("parent pairs a device (writes its kidDevices doc)", () =>
  assertSucceeds(setDoc(doc(as(P), `users/${P}/kidDevices/newDevice`), { childIds: [C, "kid2"], askWhoAfterMinutes: 5 })));

// ── Pairing codes ──
await t("kid device creates a code with its own UID", () =>
  assertSucceeds(setDoc(doc(as("dev9"), "pairingCodes/ZZZ999"), { code: "ZZZ999", claimed: false, deviceUid: "dev9" })));
await t("can't create a code for another device's UID", () =>
  assertFails(setDoc(doc(as("dev9"), "pairingCodes/ZZZ998"), { code: "ZZZ998", claimed: false, deviceUid: "someoneElse" })));
await t("signed-out can't create a code", () =>
  assertFails(setDoc(doc(anon(), "pairingCodes/ZZZ997"), { code: "ZZZ997", claimed: false, deviceUid: "x" })));
await t("parent claims a code as themselves", () =>
  assertSucceeds(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: P, childIds: [C] })));
await t("can't claim a code in someone else's name", () =>
  assertFails(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: OTHER_PARENT, childIds: [C] })));
await t("can't swap the device UID while claiming", () =>
  assertFails(updateDoc(doc(as(P), "pairingCodes/ABC123"), { claimed: true, parentId: P, childIds: [C], deviceUid: "evil" })));
await t("signed-out can't read codes", () => assertFails(getDoc(doc(anon(), "pairingCodes/ABC123"))));
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
