// ─────────────────────────────────────────────────────────────
// Kideos — kid devices (which children a device may use)
//
// users/{parentId}/kidDevices/{deviceUid} = { name, childIds, askWhoAfterMinutes, pairedAt }
// The parent app writes it when pairing; firestore.rules → isKid() reads it.
//
// onDeviceMigration: kid devices paired before Oct 20, 2026 only know one
// {parentId, childId} (their old saved session) and have no kidDevices doc, so the
// rules would lock them out. The new kid app asks once (deviceMigrations/{uid}); if
// that parent really claimed a pairing code for that child, the device is moved over.
// Accepted until MIGRATION_CUTOFF only — after that, old devices re-pair.
// ─────────────────────────────────────────────────────────────

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { APP_CONFIG } from "./config";

const MIGRATION_CUTOFF = new Date("2026-12-31T23:59:59Z");
export const DEFAULT_ASK_WHO_MINUTES = 5;

export const onDeviceMigration = onDocumentCreated(
  { document: "deviceMigrations/{deviceUid}", region: APP_CONFIG.FUNCTIONS_REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const { deviceUid } = event.params;
    const { parentId, childId } = snap.data() as { parentId?: unknown; childId?: unknown };
    const db = getFirestore();
    const refuse = async (reason: string) => {
      logger.warn(`[onDeviceMigration] refused ${deviceUid}: ${reason}`);
      await snap.ref.update({ status: "refused", reason, decidedAt: FieldValue.serverTimestamp() });
    };

    if (typeof parentId !== "string" || typeof childId !== "string" || !parentId || !childId) {
      return refuse("bad request");
    }
    if (new Date() > MIGRATION_CUTOFF) return refuse("too late — pair again");

    const child = await db.doc(`users/${parentId}/children/${childId}`).get();
    if (!child.exists) return refuse("no such child");

    // Proof the old pairing happened: a claimed code for this parent + child
    const claimed = await db
      .collection("pairingCodes")
      .where("parentId", "==", parentId)
      .where("childId", "==", childId)
      .where("claimed", "==", true)
      .limit(1)
      .get();
    if (claimed.empty) return refuse("no pairing found");

    await db.doc(`users/${parentId}/kidDevices/${deviceUid}`).set(
      {
        name: "Kid device",
        childIds: FieldValue.arrayUnion(childId),
        askWhoAfterMinutes: DEFAULT_ASK_WHO_MINUTES,
        pairedAt: FieldValue.serverTimestamp(),
        movedOver: true,
      },
      { merge: true }
    );
    await snap.ref.update({ status: "done", decidedAt: FieldValue.serverTimestamp() });
    logger.info(`[onDeviceMigration] moved ${deviceUid} over for ${parentId}/${childId}`);
  }
);

// A deleted child disappears from every device it was on
export async function removeChildFromDevices(parentId: string, childId: string): Promise<void> {
  const db = getFirestore();
  const devices = await db
    .collection(`users/${parentId}/kidDevices`)
    .where("childIds", "array-contains", childId)
    .get();
  await Promise.all(devices.docs.map((d) => d.ref.update({ childIds: FieldValue.arrayRemove(childId) })));
}
