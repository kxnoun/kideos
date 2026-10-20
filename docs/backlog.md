# Backlog

What's next, in rough priority order. Update this file as things land.

## 0. Next up (agreed Oct 17)

1. **Watch history screen** in the parent app (Home → "{child}'s history": what, when, how long). The kid
   app already writes `watchHistory` sessions (kept 90 days); there's just no screen for them.
2. **Fix the weekly digest** (see Confirmed bugs) and build it **in code, without AI**: watch time, top
   channels, shown/hidden counts. Today it sends a child's watch history to OpenAI — avoid that (COPPA:
   children's data to a third party). In-app screen only, no push.
3. **Redo device binding** (see Security).
4. **Compliance pack before launch** — COPPA's amended rule is in force since Apr 22, 2026 (not legal
   advice; get it checked):
   - a written, published **data retention policy** (watch history 90 days, verdicts, profiles…);
   - a written **security program** (device binding is part of "reasonable security");
   - a **privacy notice** naming the third parties that receive data (OpenAI, Supadata, YouTube/Google);
   - **verifiable parental consent** at parent sign-up;
   - **"Made for Kids" videos must have tracking off** in the embed (YouTube Developer Policies III.E.4.j);
   - the **kid player decision** (hiding YouTube's buttons is against their terms — see kid player below).

### Also agreed Oct 18 (top priority from the sister)

- **YouTube Premium → "Premium mode" (opt-in per child).** Our player can't see a Google login (in-app web
  views have their own cookie jar, and Google blocks signing in there; there's no API to pass Premium in,
  and copying cookies would hand over the parent's whole Google account — never). Premium mode plays the
  video as YouTube's **embed page in the system browser** (Chrome Custom Tab on Android, Safari View
  Controller on iPhone — Google allows sign-in there), signed in once, ideally with the kid's
  **supervised account under Premium Family** (Google: supervised kids get ad-free; if they tap out,
  YouTube's own supervised settings apply). Trade-off: no hiding YouTube's buttons, no remote pause (End
  Session / Hide still close it). **First: 2-minute test** — youtube.com/embed/<id> in Chrome signed in vs
  Incognito; ads gone signed in → build it.
- ✅ **Pace & stimulation** (Oct 19, profile v5, branch `pace-and-stimulation`): a 0–4 ladder (calm →
  gentle → lively → high energy → overstimulating) from code-counted pace stats (words/min, [Music]-style
  tags/min, repeated phrases), title style, the 4 stills and the channel's reputation. Defaults by age
  2/3/3/4/4. Parents' **"Too hyper"** (Home hide dialog, video details) hides it for that child and
  reports it; from 2 families on a video counts as overstimulating everywhere (`onPaceReport`).
  Limits: we can't measure cut speed (needs the video itself) — a quiet video with frantic cuts can slip.
  Research: Lillard & Peterson 2011.
- ✅ **Profile v6** (Oct 19): **junk** ladder (low effort → clickbait/knock-offs → looped "effects" spam →
  Elsagate), defaults 1/1/1/2/2. **Videos without captions are now rated** from title, description, tags and
  the stills (`basis: "metadata"`, noted in video details) instead of "couldn't check" — the "can't tell"
  setting now only covers ratings the AI leaves null. Known-channel pace floor (`KNOWN_STIMULATION` in
  aiAnalysis.ts: CoComelon, Little Baby Bum, ChuChu TV, Blippi, MrBeast → 3; Skibidi → 4) because the AI
  rated a CoComelon song "gentle". Supadata requests now start 1.1s apart instead of one-at-a-time
  (a 50-video channel was outlasting the 9-minute limit).
- ✅ **Profile v7** (Oct 19): a "Cougar MacDowall" video with a sexual scene passed because the words were
  innocent ("wanna do it again") and the profile AI leaned on them. Now every still also goes through
  **OpenAI's image moderation** (`visualCheck.ts`, free): its scores are a floor the profile AI can't lower
  (sexual ≥25% → 2, ≥50% → 3, ≥85% → 4, + nudity; minors ≥10% → 4 + junk 4; graphic ≥40% → violence 4;
  violent ≥50% → 3; self-harm ≥50% → 3). Frames are now 480×360 (`hq1–3.jpg`, were 120×90). The prompt says
  images only raise ratings and win over innocent-sounding words. Thresholds are a first guess — tune from
  the `visual=` numbers in the logs. Also **"No Shorts"** switch per child (`isShort`: youtube.com/shorts/{id}
  answers 200 for a Short; fallback ≤60s or #shorts).
- ✅ **Channel check before adding** (Oct 19, `channelCheck.ts` → `checkChannel`): the parent types a
  channel → review sheet BEFORE it's added ("Add anyway" / "Don't add it"). One shared report per channel
  (`channelChecks/{id}`), made once and re-made only when `CHECK_VERSION` changes (e.g. a new dimension).
  Gemini Flash-Lite (`gemini-3.5-flash-lite`) looks at the latest 50 thumbnails + titles and searches
  Google for the channel's reputation (news, parents, Elsagate lists) → verdict, who it's for, concerns on
  our 0–4 ladders, sources; small channels are labelled "couldn't find much". Conflicts with the child's
  settings are computed in code from the concerns (no AI per family). Cost estimate ~0.4¢ thumbnails +
  one grounded search (~1–3.5¢) per channel, once. Per-video checks unchanged. Not yet on the Suggestions
  swipe cards (those come from analyzed channels already). Later: short Gemini clips (clip offsets + fps
  are controllable, ~0.3¢ for 3×1 min).
- ✅ Channel check v3 (Oct 19): the saved channel profile records **everything a video profile records**
  (every 0–4 rating with evidence + where it came from — thumbnails / what people say — framing, faith,
  holidays, music, LGBTQ+, value flags, topics, purpose), so any filter is answered from saved data.
  Per child it goes through the SAME `evaluateProfile` as videos → conflicts + a per-child badge
  (✅ fits / ⚠️ some concerns / ⛔ not a fit), with the AI's general opinion as one smaller line.
  Low media resolution measured 15.9k tokens per channel (vs 57.7k default). Free-text boxes (religion,
  "anything else?") capped at 300 characters (app + server).
- ✅ Channel check v4 (Oct 19): uses the video check's exact ladder definitions/examples (`LADDER_GUIDE`
  — MrBeast came out 4 and Vsauce 3 without them), targeted searches ("<channel> swearing / controversy /
  inappropriate"), and **floors from videos already analyzed** for any family (`channelCatalog`: a level
  reached by ≥2 checked videos raises the channel's rating — IShowSpeed's search said "mild swearing").
  Review sheet: calm yellow "⚠️ N things to know for <child>" with a normal Add button; red + "Add anyway"
  only for ⛔ Not a fit.
- Backlog (Oct 19): **clean up a removed channel's results** — removing a channel keeps its
  `videoVerdicts` (hidden in the parent app since Oct 19, never in the kid feed). Delete them ~1 month
  after removal if the channel wasn't re-added (re-adding within that time keeps the parent's
  Hide / Show anyway choices).
- Backlog (Oct 19): **channel conflicts after filter changes** — a ⚠️ badge on the Channels screen next to
  channels whose saved check conflicts with the child's CURRENT settings (code only, from
  `channelChecks/{id}` concerns; no AI).
- Next (agreed Oct 19): **compilations** switch (waiting for the sister's examples — Ms Rachel's "+ MORE"
  ones are fine), **cooldowns** (break between videos: off/30s/1m/2m; "must finish each video": Back/Up
  next show "Finish this one first! 3:12 left", only real play time counts, parent Hide/End Session is
  the escape hatch).
- ✅ **4 stills** (thumbnail + YouTube's 3 auto frames, low detail, ~$0.002/video) go into the same AI call
  and count for every category, not just pace. If an image won't load, the call retries text-only.
- ✅ **"Made for kids only"** switch per child (YouTube's own `madeForKids` label, stored on profiles and
  verdicts; shown in video details). Kids' videos carry far fewer ads — but we don't claim "ad-free"
  (YouTube's API policy forbids estimating monetization). Premium itself: embedded players seem to show
  ads even signed in to Premium (Adam's test, Oct 18) — so no in-app Premium path; parked.
- Embedding-blocked videos (common for record-label music) are now hidden automatically; already-analyzed
  ones get caught on the next re-analysis (and the kid player closes them gracefully meanwhile).

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

- **Kid app closed by itself once** (Oct 17, after End Session, while testing remote control). Not seen
  again after the End Session rework. If it happens: `adb -s <phone> logcat -b crash -d` right after.
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
- *Looked into, not possible (Oct 17):* using a parent's **YouTube Premium** to skip ads in the kid app.
  Premium only applies inside another app if you're signed in to Google in that app's browser, and Google
  blocks sign-in in embedded web views (since 2021); there's no API to pass Premium status. Copying the
  parent's Google session onto a kid's device would be a security/COPPA problem — don't.
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

Oct 17–18 (`player-and-remote-control`): kid player hides share / YouTube button / More videos and makes
title + channel untappable (two library patches; ⚠️ terms — see kid player above); fullscreen rotates to
landscape; remote pause actually works on Android; Resume; End Session locks the whole kid app until "Let
them watch again"; now-watching card shows Paused / Playing, summary, ratings with evidence, "Hide this
video" (closes it on the kid's phone); Videos screen details sheet, Hide, multi-select hide.


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
