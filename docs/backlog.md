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

## 1b. Before launch: fill the suggestions catalog — *after the labeling check*

Analyse ~500 well-known kids' channels up front so suggestions are useful from day one (the catalog then
grows by itself as families add channels). One-time cost ≈ $70–75: one month of Supadata **Mega** ($47,
30k credits — cancel after) for ~25k transcripts + ~$25 OpenAI. Needs: a channel list sorted by age and
topic (draft it, sister trims it), and a batch job that seeds + profiles a list of channels without a
family attached (spread over 2–3 days for the YouTube quota). Do the labeling check first so we don't
analyse 500 channels with a prompt we're about to change.

- At ~500 channels, `getChannelSuggestions` reading the whole catalog per call gets heavy (~40 MB). Then:
  precompute per-child scores (on answers change / catalog change), or pre-filter by age/topic.
- Retire the older AI "suggest by description" feature (`suggestChannels`, Channels tab) once the new one
  is proven.

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
- **Kid devices aren't bound to their child.** Any signed-in device can read any child's whitelist,
  verdicts and session if it knows the IDs. Binding (`kidDeviceUids` on the child, `isKid()` in the rules,
  `deviceUid` in the pairing code) was built Oct 17 and reverted the same day: the parent app's onboarding
  bug (below, fixed) made it look broken, and existing pairings need a re-pair when it ships. Redo it in a
  calm moment: the rules + `tests/rules/` are in git history (commit bdf672f), plus a "paired devices" list
  in the parent app so it can be managed without the console.

## 4. Missing features (from the May review, still open)

- Free vs Premium gating in the UI (digest, remote pause/stop, AI suggestions are Premium per spec).
- "Suggest channels by description" mode in ChannelsScreen (`suggestChannels` already exists).
- Kid feed: orientation changes / tablet layout (`Dimensions.get` at module load).
- Player: "watch something else?" at the end, progress/duration, an action on the "time's up" screen.
- Digest: watch time by channel.
- Loading skeletons (ChannelsScreen).

- **Suggested channels: re-check channels over time.** A channel's content can drift. Re-analyse catalog
  channels every 6–12 months (channels someone follows already get new uploads analysed nightly).

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
with reasons, confirmed "Show anyway"); suggested channels (shared channel profiles, swipe cards); deleting a child is recursive (device binding was
reverted, see Security — so a kid device still doesn't notice its child was deleted until re-paired); fixed parent onboarding looping back to "Who is this for?" after Done.
