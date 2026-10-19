// ─────────────────────────────────────────────────────────────
// Kideos — parents' "Too hyper" reports
//
// The parent app hides the video for that child and writes
// videoProfiles/{videoId}/paceReports/{parentId}. This trigger counts the
// families who reported it into the profile's tooHyperReports; from
// TOO_HYPER_REPORTS families on, the video counts as overstimulating
// (contentFilter.ts effectiveDims) — for other families from their next
// filter re-apply (questionnaire change, or the nightly reprofile).
// ─────────────────────────────────────────────────────────────

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { APP_CONFIG } from "./config";

export const onPaceReport = onDocumentWritten(
  { document: "videoProfiles/{videoId}/paceReports/{parentId}", region: APP_CONFIG.FUNCTIONS_REGION },
  async (event) => {
    const { videoId, parentId } = event.params;
    const db = getFirestore();
    // Only real parent accounts count (kid devices are signed in anonymously, without a users doc)
    if (event.data?.after.exists && !(await db.doc(`users/${parentId}`).get()).exists) {
      await event.data.after.ref.delete();
      return;
    }
    const profileRef = db.doc(`videoProfiles/${videoId}`);
    if (!(await profileRef.get()).exists) return;
    const count = (await db.collection(`videoProfiles/${videoId}/paceReports`).count().get()).data().count;
    await profileRef.update({ tooHyperReports: count });
    logger.info(`[onPaceReport] ${videoId}: ${count} "too hyper" report(s)`);
  }
);
