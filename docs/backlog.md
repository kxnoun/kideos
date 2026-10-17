# Backlog

What's next, in rough priority order. Update this file as things land.

## 1. Check the AI against people (labeling) — *on the backburner, do before real families use it*

Everything depends on the AI rating videos correctly, and we haven't measured it yet.

1. Pick ~100 videos across a mix of channels (calm ones and edgy ones like Casually Explained).
2. Rate each yourself on the same ladders as the questionnaire (skim + title is usually enough;
   ~1–2 min/video, 2–3 hours total, can be split).
3. Compare with the AI's profiles per dimension (weighted kappa; target ≥ 0.7, the bar trained human
   coders hit in the Common Sense/Michigan study). Research recommends 300–500 videos and 2–3 raters
   eventually.
4. Act per dimension: reliable → keep as a hard filter; unreliable → improve that part of the prompt,
   and/or default its action to "Ask me first" so mistakes land in the review queue.

Plan: build a small labeling page (one video at a time, same questions, saves answers, outputs the
agreement table). See [questionnaire-research.md](questionnaire-research.md) → Known limits.

## 2. Confirmed bugs

- **Weekly digest broken end to end.** `generateWeeklyDigest` writes `users/{p}/children/{c}/digests/{week}`,
  the parent app reads `users/{p}/digests`, and `firestore.rules` has no rule for the child-level path (so
  the parent couldn't read it anyway). Fix the path (per child), the rule, and DigestScreen's per-child view.
- **Re-apply skips videos with an old profile version** (they keep their old verdict until the channel is
  re-added). Could regenerate missing/old profiles in the background instead.
- **Verdicts for removed channels linger.** The kid feed filters them out, but `videoVerdicts` for a
  removed channel stay (and show in the Videos screen). Clean up on whitelist delete.
- **Weekly digest push** would need an FCM token, which the app never registers — fine for now (no
  notifications by design), but decide when fixing the digest.
- **`cleanupExpiredData`** still deletes the legacy analysis cache (`collectionGroup("results")`) — remove
  that part, and add a TTL/cleanup for `triggerEvents`.
- **Kid app type error:** `PlayerScreen.tsx(111)` implicit `any` (pre-existing).

## 3. Security

- `pairingCodes`: expired codes are never deleted, and there's no rate limiting on creating/claiming.
- No way to see or remove paired kid devices in the parent app (`kidDeviceUids` can only be edited in the
  console).

## 4. Missing features (from the May review, still open)

- Free vs Premium gating in the UI (digest, remote pause/stop, AI suggestions are Premium per spec).
- "Suggest channels by description" mode in ChannelsScreen (`suggestChannels` already exists).
- Kid feed: orientation changes / tablet layout (`Dimensions.get` at module load).
- Player: "watch something else?" at the end, progress/duration, an action on the "time's up" screen.
- Digest: watch time by channel.
- Loading skeletons (ChannelsScreen).

## 5. Questionnaire follow-ups

- **Time-of-day rules** ("no gaming after 5pm"): the AI ignores time; enforcing it needs the kid app to
  hide matching videos by schedule.
- One-tap "should have been hidden / this was fine" feedback on reviewed videos → suggest threshold changes.
- Re-check borderline videos (within one level of a parent's limit) with a stronger model.
- Prefer educational content (ranking boost in the feed) — not built; the feed is newest-first.
- Visual signals (nudity, gore, music, who's singing) are best effort from transcripts — would need
  frame/audio analysis.
- Clickbait deliberately left out (even trained human coders couldn't agree on it).
- YouTube's embedded player shows ads; there's no allowed way to remove them.

## 6. Tech debt

- Migrate to React Native Firebase's modular API (removes the deprecation spam; v23 will drop the old API).
  Keep the 22.4.0 pin until the iOS build issue is understood.
- Add a real automated test suite for `functions/` (the mock harnesses used during development were
  throwaway): `contentFilter`, `prefs`, the pipeline's Supadata/AI call counts.
- `prefs.ts` is duplicated in `functions/` and `apps/KideosParent/` — move to a shared package or a
  build-time copy with a check.
- Remove the unused `seedChannelLibrary` callable and unused `APP_CONFIG` constants
  (`CACHE_HIT_TARGET_MS`, `PIPELINE_TIMEOUT_MS`, `PRE_ANALYSIS_BATCH_SIZE`).
- Legacy `flaggedContent` docs and `@react-native-firebase/messaging` are no longer used — delete the
  collection data and consider dropping the dependency.

## Done (Oct 2026)

Fixed from the May list: kid feed channel names, "Add Another Child" getting stuck. Plus: Google
sign-in/sign-out account picker, `snap.exists()` crashes and the pairing-code check, kid-app anonymous-auth
race, analysis running as its own function (no more stalls), transcripts actually used and cached,
Supadata cost controls, per-child verdicts (fixed approvals being shared between families), content
profiles + the research-based questionnaire, free text → settings. Oct 17: nightly refresh fixed (no
stagger); "Ask me first" + review queue + push notifications replaced by the Videos screen (Shown / Hidden
with reasons, confirmed "Show anyway"); kid devices bound to their child at pairing (`kidDeviceUids`) with
emulator-tested rules.
