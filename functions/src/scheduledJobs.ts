// ─────────────────────────────────────────────────────────────
// Kideos — Scheduled background jobs + Firestore triggers
//
// 1. cleanupExpiredData — nightly COPPA compliance cleanup
//    90-day watch history + 30-day AI cache
//
// 2. generateWeeklyDigest — every Monday 8am UTC
//    GPT-4o-mini natural language summary of the child's week
//    + push notification to parent
//
// 3. handleParentCommand — Firestore trigger (Premium feature)
//    Parent app writes pause/stop → kid app reads it in real time
//
// 4. deleteChildData — onCall (COPPA hard delete)
// ─────────────────────────────────────────────────────────────

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import OpenAI from "openai";
import { OPENAI_API_KEY } from "./config";
import { APP_CONFIG } from "./config";
import type { WatchSession, DeleteChildDataRequest } from "./types";

// ── 1. cleanupExpiredData ──────────────────────────────────────
// Runs nightly at 2am UTC.
// Deletes watch history > 90 days (COPPA).
// Deletes video analysis cache > 30 days.

export const cleanupExpiredData = onSchedule(
  {
    schedule: "0 2 * * *", // 2am UTC daily
    region: APP_CONFIG.FUNCTIONS_REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    logger.info("[cleanupExpiredData] Starting nightly cleanup");

    let totalDeleted = 0;

    // Watch history — 90-day TTL (COPPA)
    const expiredWatchSnap = await db
      .collectionGroup("watchHistory")
      .where("expiresAt", "<", now)
      .limit(500)
      .get();

    if (!expiredWatchSnap.empty) {
      const batch: WriteBatch = db.batch();
      expiredWatchSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += expiredWatchSnap.docs.length;
      logger.info(
        `[cleanupExpiredData] Deleted ${expiredWatchSnap.docs.length} watch history records`
      );
    }

    // Video analysis cache — 30-day TTL
    const expiredCacheSnap = await db
      .collectionGroup("results")
      .where("expiresAt", "<", now)
      .limit(500)
      .get();

    if (!expiredCacheSnap.empty) {
      const batch: WriteBatch = db.batch();
      expiredCacheSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += expiredCacheSnap.docs.length;
      logger.info(
        `[cleanupExpiredData] Deleted ${expiredCacheSnap.docs.length} expired cache entries`
      );
    }

    logger.info(`[cleanupExpiredData] Total deleted: ${totalDeleted}`);
  }
);

// ── 2. generateWeeklyDigest ────────────────────────────────────
// Runs every Monday at 8am UTC.
// Summarises the past 7 days for each Premium child.
// Sends push notification to parent.

export const generateWeeklyDigest = onSchedule(
  {
    schedule: "0 8 * * 1", // Monday 8am UTC
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

    logger.info("[generateWeeklyDigest] Starting weekly digest generation");

    // Get all Premium parents
    const parentsSnap = await db
      .collectionGroup("subscription")
      .where("tier", "==", "premium")
      .get();

    const parentIds = new Set<string>();
    for (const doc of parentsSnap.docs) {
      const parentId = doc.ref.parent.parent?.id;
      if (parentId) parentIds.add(parentId);
    }

    // Past 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = Timestamp.fromDate(sevenDaysAgo);
    const weekLabel = sevenDaysAgo.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    for (const parentId of parentIds) {
      const childrenSnap = await db
        .collection(`users/${parentId}/children`)
        .get();

      for (const childDoc of childrenSnap.docs) {
        const childId = childDoc.id;
        const childName: string =
          (childDoc.data() as { name?: string }).name ?? "Your child";

        try {
          // Fetch this week's watch sessions
          const sessionsSnap = await db
            .collection(`users/${parentId}/children/${childId}/watchHistory`)
            .where("startedAt", ">=", weekStart)
            .get();

          // Fetch this week's flagged content
          const flaggedSnap = await db
            .collection(`users/${parentId}/children/${childId}/flaggedContent`)
            .where("timestamp", ">=", weekStart)
            .get();

          const sessions = sessionsSnap.docs.map((d) => d.data() as WatchSession);
          const flaggedCount = flaggedSnap.docs.length;

          if (sessions.length === 0) {
            logger.info(
              `[generateWeeklyDigest] No activity this week for child ${childId}`
            );
            continue;
          }

          // Total watch time
          const totalSeconds = sessions.reduce(
            (sum, s) => sum + (s.durationSeconds ?? 0),
            0
          );
          const totalHours = (totalSeconds / 3600).toFixed(1);

          // Group by channel for breakdown
          const channelCounts: Record<string, { count: number; name: string }> = {};
          for (const s of sessions) {
            const key = s.channelId || s.channel;
            if (!channelCounts[key]) {
              channelCounts[key] = { count: 0, name: s.channel };
            }
            channelCounts[key].count++;
          }

          // Top channels for the prompt
          const topChannels = Object.values(channelCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((c) => `${c.name} (${c.count} video${c.count !== 1 ? "s" : ""})`)
            .join(", ");

          const flaggedSummary =
            flaggedCount > 0
              ? `${flaggedCount} video${flaggedCount !== 1 ? "s were" : " was"} blocked before reaching the feed.`
              : "No videos were flagged this week.";

          const prompt = `Write a warm, brief weekly summary (2–4 sentences) for a parent about their child's YouTube viewing this week.

Child: ${childName}
Week of: ${weekLabel}
Total watch time: ${totalHours} hours across ${sessions.length} video${sessions.length !== 1 ? "s" : ""}
Top channels: ${topChannels}
${flaggedSummary}

Style: warm, informative, parent-to-parent tone. Mention specific channels. Be natural, not clinical.

Example: "This week Yusuf watched 3.2 hours of YouTube. His favourite channel was Mark Rober — 6 science videos, all approved. One video from a new channel was blocked before reaching his feed due to mild profanity."`;

          const completion = await client.chat.completions.create({
            model: APP_CONFIG.AI_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.6,
          });

          const digestText =
            completion.choices[0]?.message?.content?.trim() ??
            `${childName} watched ${totalHours} hours this week. ${flaggedSummary}`;

          // Write digest to Firestore
          const weekKey = sevenDaysAgo.toISOString().slice(0, 10);
          await db
            .doc(`users/${parentId}/children/${childId}/digests/${weekKey}`)
            .set({
              weekOf: weekKey,
              summary: digestText,
              totalHours: parseFloat(totalHours),
              videoCount: sessions.length,
              flaggedCount,
              channelBreakdown: channelCounts,
              generatedAt: Timestamp.now(),
            });

          // Push notification to parent
          const fcmSnap = await db.doc(`users/${parentId}/devices/primary`).get();
          const fcmToken: string | undefined = fcmSnap.data()?.fcmToken;

          if (fcmToken) {
            await getMessaging().send({
              token: fcmToken,
              notification: {
                title: `📊 ${childName}'s week`,
                body: `${totalHours} hrs watched. ${flaggedCount > 0 ? `${flaggedCount} blocked.` : "All clear."} 5 new channel picks inside.`,
              },
              data: {
                type: "weekly_digest",
                childId,
                weekOf: weekKey,
              },
              apns: {
                payload: { aps: { sound: "default" } },
              },
            });
          }
        } catch (err) {
          logger.error(
            `[generateWeeklyDigest] Failed for parent=${parentId} child=${childId}:`,
            err
          );
        }
      }
    }

    logger.info("[generateWeeklyDigest] Done");
  }
);

// ── 3. handleParentCommand — Firestore trigger (Premium) ───────
// Parent app writes to currentSession/parentCommand.
// This function relays it to the kid app via currentSession/playSignal.
// Kid app has a real-time Firestore listener on playSignal.

export const handleParentCommand = onDocumentWritten(
  "users/{parentId}/children/{childId}/currentSession/parentCommand",
  async (event) => {
    const { parentId, childId } = event.params;
    const newData = event.data?.after?.data();

    if (!newData) return;

    logger.info(
      `[handleParentCommand] parent=${parentId} child=${childId} action=${newData.action}`
    );

    const db = getFirestore();
    const signalRef = db.doc(
      `users/${parentId}/children/${childId}/currentSession/playSignal`
    );

    switch (newData.action) {
      case "pause":
        await signalRef.set({
          action: "pause",
          initiatedBy: "parent",
          updatedAt: Timestamp.now(),
        });
        break;

      case "stop":
        // Child sees a friendly "time's up" screen
        await signalRef.set({
          action: "stop",
          initiatedBy: "parent",
          updatedAt: Timestamp.now(),
        });
        break;

      case "unlock":
        await signalRef.set({
          action: "play",
          initiatedBy: "parent",
          updatedAt: Timestamp.now(),
        });
        break;

      default:
        logger.warn(`[handleParentCommand] Unknown action: ${newData.action}`);
    }
  }
);

// ── 4. deleteChildData — COPPA hard delete ─────────────────────
// Parent taps "Delete all data for {Child}" in Settings.
// Hard-deletes ALL Firestore records for that child profile.

export const deleteChildData = onCall(
  {
    region: APP_CONFIG.FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async (request): Promise<{ success: boolean }> => {
    const { parentId, childId } = request.data as DeleteChildDataRequest;

    if (!parentId || !childId) {
      throw new HttpsError("invalid-argument", "parentId and childId are required");
    }

    if (request.auth?.uid !== parentId) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const db = getFirestore();
    logger.info(
      `[deleteChildData] Hard deleting all data for child ${childId} under parent ${parentId}`
    );

    // recursiveDelete removes the child doc and every subcollection under it,
    // however large (a plain batch caps at 500 writes and would fail midway).
    await db.recursiveDelete(db.doc(`users/${parentId}/children/${childId}`));

    logger.info(`[deleteChildData] Complete for child ${childId}`);
    return { success: true };
  }
);
