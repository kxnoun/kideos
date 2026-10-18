// ─────────────────────────────────────────────────────────────
// Kideos — upgrade old content profiles after PROFILE_VERSION changes
//
// reprofileOutdated (nightly 04:00 UTC, after the 03:00 refresh; can also be run
// by hand: Google Cloud console → Cloud Scheduler → firebase-schedule-
// reprofileOutdated-… → Force run). For every channel in channelLibraryCache:
// regenerates profiles older than PROFILE_VERSION from CACHED transcripts only —
// it never calls Supadata (a video without a cached transcript is skipped). Then
// rebuilds the channel's catalog entry and re-applies filters for every child
// who has an upgraded channel. Cost: one OpenAI call per outdated video.
// Stops before the time limit; the next run picks up where it left off.
// ─────────────────────────────────────────────────────────────

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { APP_CONFIG, YOUTUBE_API_KEY, OPENAI_API_KEY } from "./config";
import { PROFILE_VERSION } from "./aiAnalysis";
import { getOrCreateProfile, reapplyFiltersForChild } from "./analyzeVideo";
import { buildCatalogEntrySafe } from "./channelCatalog";

const BUDGET_MS = 6.5 * 60 * 1000; // leave room for re-applying filters

export const reprofileOutdated = onSchedule(
  {
    schedule: "0 4 * * *",
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const started = Date.now();
    const keys = { youtubeApiKey: YOUTUBE_API_KEY.value(), supadataApiKey: "", openAiApiKey: OPENAI_API_KEY.value() };
    const channels = await db.collection("channelLibraryCache").select().get();
    const touched = new Set<string>();
    let upgraded = 0;
    let skipped = 0;
    let outOfTime = false;

    for (const ch of channels.docs) {
      if (Date.now() - started > BUDGET_MS) {
        outOfTime = true;
        break;
      }
      const stubs = await db.collection(`channelLibraryCache/${ch.id}/videos`).select().get();
      if (stubs.empty) continue;
      const snaps = await db.getAll(...stubs.docs.map((d) => db.doc(`videoProfiles/${d.id}`)));
      const outdated = snaps.filter((s) => s.exists && (s.data()!.version ?? 0) < PROFILE_VERSION).map((s) => s.id);
      if (!outdated.length) continue;

      for (let i = 0; i < outdated.length; i += 5) {
        if (Date.now() - started > BUDGET_MS) {
          outOfTime = true;
          break;
        }
        const results = await Promise.allSettled(
          outdated.slice(i, i + 5).map((id) => getOrCreateProfile(db, id, keys, { cachedTranscriptsOnly: true }))
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value && r.value.version === PROFILE_VERSION) upgraded++;
          else skipped++;
        }
      }
      touched.add(ch.id);
      await buildCatalogEntrySafe(ch.id, keys.openAiApiKey);
      if (outOfTime) break;
    }

    // Re-apply filters for children who have an upgraded channel (no AI unless a
    // custom-rules check is new)
    if (touched.size) {
      const children = new Set<string>();
      const wl = await db.collectionGroup("whitelistedChannels").select().get();
      for (const d of wl.docs) {
        const [, parentId, , childId, , channelId] = d.ref.path.split("/");
        if (touched.has(channelId)) children.add(`${parentId}/${childId}`);
      }
      for (const key of children) {
        const [parentId, childId] = key.split("/");
        try {
          await reapplyFiltersForChild(parentId, childId, keys.openAiApiKey);
        } catch (err) {
          logger.error(`[reprofileOutdated] Re-apply failed for ${key}:`, err);
        }
      }
    }

    logger.info(
      `[reprofileOutdated] upgraded=${upgraded} skipped=${skipped} channels=${touched.size}` +
        (outOfTime ? " — out of time, the next run continues" : " — done")
    );
  }
);
