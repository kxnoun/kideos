// ─────────────────────────────────────────────────────────────
// Kideos — suggestChannels Cloud Function
//
// Two modes:
// 1. Parent types a natural language query → GPT-4o-mini generates
//    specific channel handles → verified via channels.list (1 unit each)
//    This replaces search.list (100 units) entirely.
//
// 2. Weekly scheduled batch → generates suggestions for all Premium
//    parents based on their child's value filters.
//
// Verified channels are written to:
//   users/{parentId}/children/{childId}/suggestions/{suggestionId}
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import OpenAI from "openai";
import { YOUTUBE_API_KEY, OPENAI_API_KEY } from "./config";
import { APP_CONFIG } from "./config";
import { verifyChannelHandles } from "./youtube";
import { describePrefs, normalizePrefs } from "./prefs";
import type {
  ValueFilters,
  ChannelSuggestion,
  SuggestChannelsRequest,
} from "./types";

// ── GPT-4o-mini: generate channel handle recommendations ───────
// Returns @handles like ["@HoffmanAcademy", "@PianoTV"]
// Claude/GPT generates from training knowledge — no search.list needed.

async function generateChannelHandles(
  filters: ValueFilters,
  naturalLanguageQuery: string | undefined,
  openAiApiKey: string
): Promise<string[]> {
  const client = new OpenAI({ apiKey: openAiApiKey });

  const queryContext = naturalLanguageQuery
    ? `The parent is specifically looking for: "${naturalLanguageQuery}"`
    : `Generate general suggestions based on the child's profile and filters.`;

  const prompt = `You are helping a parent find appropriate YouTube channels for their ${filters.ageGroup}-year-old child.

${queryContext}

Parent's content preferences:
${describePrefs(filters)}

Return a JSON array of 8 specific YouTube channel handles (with @ prefix) that would be appropriate for this child.
Base your recommendations on your training knowledge of real YouTube channels.
Prioritize well-known, established channels with large libraries of appropriate content.

Response format — JSON array only, no other text:
["@ChannelHandle1", "@ChannelHandle2", ...]`;

  const completion = await client.chat.completions.create({
    model: APP_CONFIG.AI_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 256,
    temperature: 0.7, // Slightly higher for variety in suggestions
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw);
    // Handle both {"channels": [...]} and direct array responses
    const handles: unknown = Array.isArray(parsed) ? parsed : (parsed.channels ?? parsed.handles ?? []);
    if (!Array.isArray(handles)) return [];

    return handles
      .filter((h): h is string => typeof h === "string")
      .map((h) => (h.startsWith("@") ? h : `@${h}`))
      .slice(0, 10); // cap at 10
  } catch {
    logger.error("[suggestChannels] Failed to parse AI response:", raw);
    return [];
  }
}

// ── Generate suggestion reason for each channel ────────────────

async function generateSuggestionReason(
  channelName: string,
  filters: ValueFilters,
  openAiApiKey: string
): Promise<string> {
  const client = new OpenAI({ apiKey: openAiApiKey });

  const completion = await client.chat.completions.create({
    model: APP_CONFIG.AI_MODEL,
    messages: [
      {
        role: "user",
        content: `In one sentence (max 20 words), explain why "${channelName}" is appropriate for a ${filters.ageGroup}-year-old with these preferences:\n${describePrefs(filters)}`,
      },
    ],
    max_tokens: 64,
    temperature: 0.5,
  });

  return completion.choices[0]?.message?.content?.trim() ?? `Age-appropriate content for ${filters.ageGroup}-year-olds.`;
}

// ── Core suggestion pipeline ───────────────────────────────────

async function generateSuggestionsForChild(
  parentId: string,
  childId: string,
  filters: ValueFilters,
  naturalLanguageQuery: string | undefined,
  db: FirebaseFirestore.Firestore,
  openAiApiKey: string,
  youtubeApiKey: string
): Promise<number> {
  // 1. Generate channel handles from GPT-4o-mini
  const handles = await generateChannelHandles(filters, naturalLanguageQuery, openAiApiKey);

  if (handles.length === 0) {
    logger.warn("[suggestChannels] No handles generated");
    return 0;
  }

  logger.info(`[suggestChannels] Generated ${handles.length} handles: ${handles.join(", ")}`);

  // 2. Verify via channels.list (1 unit per channel — replaces search.list entirely)
  const verifiedChannels = await verifyChannelHandles(handles, youtubeApiKey);
  logger.info(`[suggestChannels] ${verifiedChannels.length}/${handles.length} channels verified`);

  if (verifiedChannels.length === 0) return 0;

  // 3. Get already-whitelisted channels to avoid suggesting them
  const whitelistSnap = await db
    .collection(`users/${parentId}/children/${childId}/whitelistedChannels`)
    .get();
  const whitelistedIds = new Set(whitelistSnap.docs.map((d) => d.id));

  const newChannels = verifiedChannels.filter((c) => !whitelistedIds.has(c.channelId));

  // 4. Generate reasons and write suggestions
  const suggestionsRef = db.collection(
    `users/${parentId}/children/${childId}/suggestions`
  );

  let written = 0;
  for (const channel of newChannels.slice(0, 8)) {
    const reason = await generateSuggestionReason(channel.name, filters, openAiApiKey);

    const suggestion: ChannelSuggestion = {
      channelId: channel.channelId,
      channelName: channel.name,
      handle: channel.handle,
      thumbnail: channel.thumbnail,
      subscriberCount: channel.subscriberCount,
      description: channel.description.slice(0, 300),
      reason,
      sampleVideoTitles: [], // Could be enriched via playlistItems.list but costs quota
      generatedAt: Timestamp.now(),
      parentResponse: "pending",
    };

    await suggestionsRef.doc(channel.channelId).set(suggestion, { merge: true });
    written++;
  }

  logger.info(`[suggestChannels] Wrote ${written} suggestions for child ${childId}`);
  return written;
}

// ── onCall: parent requests suggestions (natural language) ──────

export const suggestChannels = onCall(
  {
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request): Promise<{ suggestionsGenerated: number }> => {
    const { parentId, childId, naturalLanguageQuery } =
      request.data as SuggestChannelsRequest;

    if (!parentId || !childId) {
      throw new HttpsError("invalid-argument", "parentId and childId are required");
    }

    if (request.auth?.uid !== parentId) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    const db = getFirestore();

    // Load value filters
    const filtersSnap = await db
      .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
      .get();

    if (!filtersSnap.exists) {
      throw new HttpsError("failed-precondition", "Value filters not configured");
    }

    const filters = normalizePrefs(filtersSnap.data());

    const count = await generateSuggestionsForChild(
      parentId,
      childId,
      filters,
      naturalLanguageQuery,
      db,
      OPENAI_API_KEY.value(),
      YOUTUBE_API_KEY.value()
    );

    return { suggestionsGenerated: count };
  }
);

// ── Scheduled: weekly AI suggestions for all Premium parents ───

export const weeklyChannelSuggestions = onSchedule(
  {
    schedule: "0 10 * * 1", // Every Monday at 10am UTC
    region: APP_CONFIG.FUNCTIONS_REGION,
    secrets: [YOUTUBE_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    logger.info("[weeklyChannelSuggestions] Starting weekly suggestion generation");

    // Get all Premium parents
    const parentsSnap = await db
      .collectionGroup("subscription")
      .where("tier", "==", "premium")
      .get();

    // Deduplicate parent IDs
    const parentIds = new Set<string>();
    for (const doc of parentsSnap.docs) {
      // Path: users/{parentId}/subscription/current
      const parentId = doc.ref.parent.parent?.id;
      if (parentId) parentIds.add(parentId);
    }

    logger.info(`[weeklyChannelSuggestions] Processing ${parentIds.size} Premium parents`);

    for (const parentId of parentIds) {
      // Get all children for this parent
      const childrenSnap = await db
        .collection(`users/${parentId}/children`)
        .get();

      for (const childDoc of childrenSnap.docs) {
        const childId = childDoc.id;

        try {
          const filtersSnap = await db
            .doc(`users/${parentId}/children/${childId}/valueFilters/current`)
            .get();

          if (!filtersSnap.exists) continue;

          const filters = normalizePrefs(filtersSnap.data());

          await generateSuggestionsForChild(
            parentId,
            childId,
            filters,
            undefined, // No natural language query for weekly batch
            db,
            OPENAI_API_KEY.value(),
            YOUTUBE_API_KEY.value()
          );

          // Send push notification to parent
          const fcmSnap = await db.doc(`users/${parentId}/devices/primary`).get();
          const fcmToken: string | undefined = fcmSnap.data()?.fcmToken;
          const childName: string = (childDoc.data() as { name?: string }).name ?? "your child";

          if (fcmToken) {
            const { getMessaging } = await import("firebase-admin/messaging");
            await getMessaging().send({
              token: fcmToken,
              notification: {
                title: "✨ New Channel Picks",
                body: `We found channels ${childName} might love. Tap to review.`,
              },
              data: { type: "new_suggestions", childId },
            });
          }
        } catch (err) {
          logger.error(
            `[weeklyChannelSuggestions] Failed for parent=${parentId} child=${childId}:`,
            err
          );
          // Continue with next child
        }
      }
    }

    logger.info("[weeklyChannelSuggestions] Done");
  }
);
