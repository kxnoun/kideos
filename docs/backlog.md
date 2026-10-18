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
   and/or make its default limit more conservative. Bump `PROFILE_VERSION` → `reprofileOutdated` re-rates
   everything from cached transcripts (OpenAI only).

Plan: build a small labeling page (one video at a time, same questions, saves answers, outputs the
agreement table). See [questionnaire-research.md](questionnaire-research.md) → Known limits.

Found in real data (Oct 17): gambling was present/absent only, so passing mentions counted as the worst
level — SciShow's "Power Pose" video (a study using a bet), Casually Explained's "Sports II" ("mention of
gambling on golf"). Fixed in profile v4 with a 0–4 gambling ladder (mentioned → discussed → shown →
promoted). Include a few gambling-mention videos in the labeling round to confirm.

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
- Re-apply skips videos with *no* usable profile (older than v3). Older-version profiles are now upgraded
  nightly by `reprofileOutdated` (cached transcripts only).
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

- **Kid player — decide before launch.** Inside YouTube's player we hide the share button, the YouTube
  logo / "Watch on YouTube" button and "More videos" (`HIDE_IN_PLAYER` in
  `apps/Kideos/src/screens/PlayerScreen.tsx`; on Android it reaches YouTube's iframe through
  `apps/Kideos/patches/react-native-webview+13.16.1.patch`, applied on `npm install`). Everything else
  (controls, fullscreen, skip ad, title) is YouTube's as normal. **Changing the player is against YouTube's
  terms** (Required Minimum Functionality: "You must not make changes to the YouTube player that are not
  explicitly described by the API documentation") — risks at launch: losing API access, store rejection.
  Before going public: ask YouTube API compliance / a lawyer, or remove `HIDE_IN_PLAYER`. Also: "Made for
  Kids" videos must have tracking off (Developer Policies III.E.4.j); the player page is hosted on the
  library author's GitHub Pages (`lonelycpp.github.io`) — host our own.
  The title, channel name and channel picture are untappable; YouTube links never open (web view level
  too); ad links still open normally (left alone on purpose — don't interfere with ads). There is no
  YouTube Kids API or embeddable YouTube Kids player.

## 4. Missing features (from the May review, still open)

- Free vs Premium gating in the UI (digest, remote pause/stop, AI suggestions are Premium per spec).
- Kid feed: orientation changes / tablet layout (`Dimensions.get` at module load).
- *Backburner:* landscape-only kid app for younger kids (YouTube Kids was landscape-only on phones until
  it added portrait in Dec 2024). Also: Shorts get rotated to landscape in fullscreen — keep them upright.
- *Backburner:* the player's settings (gear) menu — "Stats for nerds" fills the screen and kids tap
  everything. Hide or disable it (or just that item), or make it a parent setting.
- UI polish on both apps.
- Player: "watch something else?" at the end, progress/duration, an action on the "time's up" screen.
- Digest: watch time by channel.
- Loading skeletons (ChannelsScreen).

- **Suggested channels: re-check channels over time.** A channel's content can drift. Re-analyse catalog
  channels every 6–12 months (channels someone follows already get new uploads analysed nightly).
- Suggested channels don't apply custom rules / religion text (they apply once the channel is added).
  Could run the values check on a channel's sample videos before suggesting.
- Audience ages come from one AI guess per channel — spot-check them in the labeling round.

## 5. Questionnaire follow-ups

- **Time-of-day rules** ("no gaming after 5pm"): the AI ignores time; enforcing it needs the kid app to
  hide matching videos by schedule.
- One-tap "should have been hidden / this was fine" feedback in the Videos screen → suggest threshold changes.
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
profiles + the research-based questionnaire, free text → settings.

Oct 17 (merged as `videos-and-suggestions`):
- Nightly refresh fixed (no stagger between channels).
- "Ask me first", the review queue and push notifications replaced by the **Videos screen** (Shown /
  Hidden with plain-words reasons and ratings; "Show anyway" behind a confirmation, with Undo).
- **Suggested channels**: shared channel profiles (`channelCatalog`), swipe cards, ≥75% fit, ≤2 severe
  (warned on the card), ≥10 checked videos, made for the child's age ±1, honest overviews.
- **Gambling ladder** (profile v4) and **`reprofileOutdated`** (upgrades old profiles from cached
  transcripts; first run: 149 videos, no Supadata).
- Deleting a child is recursive; fixed parent onboarding looping back to "Who is this for?" after Done.
- Device binding built, then reverted (see Security) — so a kid device still doesn't notice its child was
  deleted until it's re-paired.
