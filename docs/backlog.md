# Backlog

What's next, in rough priority order. Update this file as things land.

## 0. Next up (agreed Oct 17–19 — rough order, reorder freely)

1. **Compilations switch** — waiting for the sister's examples of the compilations she means (Ms Rachel's
   "+ MORE Nursery Rhymes" ones are fine). Likely reupload channels stitching others' clips ("BEST Peppa Pig
   moments 3 HOURS"). Needs a profile field → one `PROFILE_VERSION` bump.
2. **Kid screen layout** (agreed Oct 20): YouTube Kids style — a "New" row, one row per channel (tap the
   name → all its videos), a separate Shorts row; still live-updating.
3. **Several kids on one device** (agreed Oct 20): pairing links the device to the family (parent picks which
   children use it), a "Who's watching?" screen, optional 4-digit PIN per profile (so a younger sibling
   can't use an older one's looser settings), "Switch profile" in the kid app; remote control / history
   stay per child.
4. **Kid player: standard YouTube player + a grown-up gate** (agreed Oct 18) instead of hiding YouTube's
   buttons (`HIDE_IN_PLAYER`, against YouTube's terms — see Security → kid player): links (share, Watch on
   YouTube, More videos, title) work again but first ask a grown-up question / passcode, then open the
   YouTube app. Apple *requires* a parental gate before links leave a Kids-category app. Plus a short
   "lock your kid's phone to Kideos" guide in parent setup (Guided Access on iPhone, screen pinning on
   Android — free, built in).
5. **Watch history screen** in the parent app (Home → "{child}'s history": what, when, how long). The kid
   app already writes `watchHistory` sessions (kept 90 days); there's just no screen for them.
6. **Fix the weekly digest** (see Confirmed bugs) and build it **in code, without AI**: watch time, top
   channels, shown/hidden counts. Today it sends a child's watch history to OpenAI — avoid that (COPPA:
   children's data to a third party). In-app screen only, no push.
7. **Redo device binding** (see Security).
8. **Compliance pack before launch** — see section 7.

Smaller follow-ups:
- **Clean up a removed channel's results**: removing a channel keeps its `videoVerdicts` (hidden in the
  parent app since Oct 19, never in the kid feed). Delete them ~1 month after removal if the channel wasn't
  re-added (re-adding within that time keeps the parent's Hide / Show anyway choices).
- **Tune the image-moderation thresholds** (`visualCheck.ts`) from the `visual=` numbers in real logs —
  they're a first guess, and the moderation model is trained mostly on photos (cartoons may score lower).
- **Tune pace**: watch for calm explainers rated 3 or hyper channels rated 2; add channels to
  `KNOWN_STIMULATION` only for well-known, consistent styles.

## 1. Check the AI against people (labeling) — *on the backburner, do before real families use it*

Everything depends on the AI rating videos correctly, and we haven't measured it yet. Include the new
ladders (pace & stimulation, junk) and some no-caption videos (rated from metadata + images) in the round.

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
grows by itself as families add channels). One-time cost ≈ $110–130: one month of Supadata **Mega** ($47,
30k credits — cancel after) for ~25k transcripts + ~$60–75 OpenAI (profiles now include 4 images, ≈ $0.0025
per video) + the channel checks (~500 × 1–4¢ ≈ $5–20, Gemini). Needs: a channel list sorted by age and
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
- ~~Verdicts for removed channels show in the Videos screen~~ — fixed Oct 19 (the screen only shows
  channels still on the list); deleting them later is in Next up → smaller follow-ups.
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
  **Decided Oct 18:** go back to the standard player and put a grown-up gate in front of links (Next up #4). Also: "Made for
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
- *Looked into, parked (Oct 17–18):* **YouTube Premium (no ads) in the kid app** — the sister's top ask.
  What we found:
  - Premium only applies where the viewer's browser is signed in to a Premium Google account. Our player
    is an in-app web view with its own cookie jar, and Google blocks signing in inside embedded web views
    (since 2021). There's no API to pass Premium status in (the YouTube Data API has no Premium or
    monetization field, and can't play video). Copying the parent's Google session onto a kid's device
    would hand over their whole account — never.
  - The system browser (Chrome Custom Tab / Safari View Controller, where sign-in is allowed) or a
    Trusted Web Activity (Chrome running our page full screen on Android, sharing Chrome's sign-in) could
    carry a Premium sign-in — **but Adam's test (Oct 18) suggests embedded players show ads even when
    signed in to Premium**, and the B-Side app developer found the same (Premium works on the watch page,
    not the embed). Only YouTube's own watch page / app is reliably ad-free, and both let kids wander off
    the approved list. So: no in-app Premium path.
  - What we tell parents instead: **"made for kids" videos rarely carry ads** in our player (seen: Ms
    Rachel, SciShow Kids no ads; regular SciShow 2 ads) → the "made for kids only" switch. Never call it
    "ad-free" — YouTube's API policy forbids estimating a video's monetization. An "ads seen" tracker was
    dropped for the same reason.
  - Also ruled out: pulling video streams to skip ads (against YouTube's terms, gets the app pulled),
    faking a desktop browser to sign in to Google in the web view (circumvents Google's protection),
    Vimeo (the kids' channels families use aren't there). Possible later: a "send this list to YouTube
    Kids" helper for Premium families who prefer YouTube Kids' "approved content only" mode (ad-free with
    Premium, but no remote control, history or ratings).
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
- Visual signals: since profile v7 each video's thumbnail + 3 frames are seen by the profile AI and
  checked by image moderation, and channels get a 50-thumbnail check before adding — but a scene between
  frames can still slip (the per-video check never sees the whole video). Watching whole videos with Gemini
  was built and **reverted on cost** (~2¢ per 10-min video ≈ $1 per channel, Oct 19). If needed: Gemini on
  short clips (controllable start/end + fps, ~0.3¢ for 3×1 min), only for risky videos (no captions,
  borderline image scores, not made for kids, junk). Music / who's singing are still best effort.
- Clickbait deliberately left out (even trained human coders couldn't agree on it).
- YouTube's embedded player shows ads; there's no allowed way to remove them (Premium findings: section 4).

## 6. Tech debt

- Migrate to React Native Firebase's modular API (removes the deprecation spam; v23 will drop the old API).
  Keep the 22.4.0 pin until the iOS build issue is understood.
- Add a real automated test suite for `functions/` (the mock harnesses used during development were
  throwaway): `contentFilter`, `prefs`, the pipeline's Supadata/AI call counts.
- `prefs.ts` is duplicated in `functions/` and `apps/KideosParent/` — move to a shared package or a
  build-time copy with a check.
- `channelCheck.ts` hard-codes `GEMINI_MODEL` and `aiAnalysis.ts` derives `LADDER_GUIDE` by slicing the
  profile prompt between two markers — keep the markers, or move the ladder text into its own constant.
- `apps/Kideos` and the parent app call the Gemini/OpenAI-backed callables with no App Check
  (`"app": "MISSING"` in logs) — add App Check before launch so only our apps can call them.
- Remove the unused `seedChannelLibrary` callable and unused `APP_CONFIG` constants
  (`CACHE_HIT_TARGET_MS`, `PIPELINE_TIMEOUT_MS`, `PRE_ANALYSIS_BATCH_SIZE`).
- Legacy `flaggedContent` docs and `@react-native-firebase/messaging` are no longer used — delete the
  collection data and consider dropping the dependency.

## 7. Compliance before launch (not legal advice — get it checked)

COPPA's amended rule is in force since Apr 22, 2026:
- a written, published **data retention policy** (watch history 90 days, verdicts, profiles…);
- a written **security program** (device binding is part of "reasonable security");
- a **privacy notice** naming the third parties that receive data (OpenAI, Google/Gemini, Supadata,
  YouTube);
- **verifiable parental consent** at parent sign-up; parents can delete their data (within 30 days);
- **"Made for Kids" videos must have tracking off** in the embed (YouTube Developer Policies III.E.4.j).

YouTube API Services policies (reviewed Oct 18 with Adam — he accepts the risk at 100–200 families, but
these are the known gaps):
- **Player changes** — hiding share / YouTube logo / More videos and blocking links breaks "don't modify or
  block the standard player". Plan: Next up #4 (standard player + grown-up gate).
- **"Safe / suitable" claims and custom scores** — the policies forbid claiming a video/channel is safe or
  suitable, custom channel scores, and inferring content categories. Ratings are our own analysis of what's
  said and shown; word them as findings ("mentions gambling, shown once"), not verdicts ("safe"). Adam
  will fix the wording. An **API Compliance Audit** (YouTube's own form) is the official way to get a
  parental-control use case approved.
- **No monetization estimates** — never "ad-free"; the made-for-kids label is YouTube's own data and fine.
- **Transcripts via Supadata** — YouTube's main terms forbid automated collection; known risk, accepted.
- Free-text rules stay (300-char cap): a parent's text only affects their own kids (answers cached per
  exact rules), so prompt tricks can't reach other families.

## Done (Oct 2026)

Oct 20 (same branch): **Load more limits** — 20 videos per tap, only while the child has < 20 shown from
the channel and YouTube has more, once per channel per day, 10 per family per day. **Ages = who a channel
suits** (youngest age it's suitable & interesting for), not "made for" — SmarterEveryDay / MrBeast came out
12+; saved channel-check ages preferred (`OVERVIEW_VERSION` 4, `CHECK_VERSION` 5).

Oct 20 (same branch): **long videos first** — a channel is seeded with its 40 latest long videos + 10
latest Shorts (YouTube's `UULF…` / `UUSH…` playlists) instead of its 50 newest uploads (~90% Shorts);
suggestions are scored on long videos (Shorts on their own line, ignored with "No Shorts" — they were
counting as "doesn't fit": Mark Rober was 12% for Simon); `Not suggested` logs list the hidden reasons;
**"Load more videos"** per channel (next 50 older long videos); one-time nightly long-video top-up for
channels added earlier.

Oct 19 (branch `channel-check-everywhere`): every way of adding a channel shows the channel check review
(suggested-channel cards and the older AI suggestions too); suggestions use saved channel checks ("not a
fit" → not suggested, otherwise "things to know" on the card); the Channels screen shows "⚠️ N things to
know" / "⛔ Not a fit with current settings" from saved checks vs current settings (`getChannelFits`). No
new AI calls.

Oct 19 (branch `cooldowns`): **minimum time on a video per child** (Settings → Viewing: "Before switching
videos, stay at least" Off / 30 s / 1 min / 2 min / Whole). Back / Android back keep the kid on the video
with "Watch a little more! 0:12 left"; timed = from when it starts playing (pauses count), whole = ~90%
actually played; dragging to the end → "Nice try 😄"; reopens after a restart if still owed; Hide / End
Session always get the kid out. Stored on the child doc; Android back now returns to the feed instead of
closing the app. (A "Take a breather" break screen was built first and dropped — Adam wanted a minimum
watch time, not a wait.)

Oct 18–19 (branch `pace-and-stimulation`, includes `parent-video-preview` and `embed-blocked-videos`):
- **Parent app: tap a video's thumbnail to watch it** (now-watching card + video details).
- **Embedding-blocked videos** (owner disabled playback in other apps — common for label music) are hidden
  automatically; the kid player closes gracefully if one slips through.
- **Pace & stimulation** ladder (calm → overstimulating) from code-counted pace stats + title style +
  images + reputation; "Too hyper" button (2+ families → overstimulating everywhere, `onPaceReport`);
  `KNOWN_STIMULATION` floor because a CoComelon song came out "gentle". Research: Lillard & Peterson 2011.
- **Junk & knock-offs** ladder (low effort → clickbait → looped effects spam → Elsagate).
- **Videos without captions are rated** from title, description, tags and images (most CoComelon songs
  and spam like "preview 2 effects" have no captions).
- **Images (profile v7)**: thumbnail + 3 frames at 480×360 seen by the profile AI, plus OpenAI image
  moderation as a floor — a "Cougar MacDowall" sexual scene passed on innocent dialogue before this.
- **"Made for kids only"** and **"No Shorts"** switches per child; "Made for kids" shown in video details.
- **Channel check before adding** (`checkChannel`, Gemini Flash-Lite, low-res thumbnails + Google Search):
  one shared full channel profile per channel, same ladders/definitions as videos, floors from videos
  already analyzed, per-child fit in code; review sheet with calm yellow "N things to know" vs red "Not a
  fit". Tested: Cougar MacDowall ⛔, Lemon Comics ⛔ (small channel, thumbnails only), Ms Rachel /
  Veritasium / Vsauce / Mark Rober / SmarterEveryDay ✅, MrBeast / IShowSpeed ⚠️.
- Supadata requests run side by side (starting ≥1.1s apart) — 50-video channels no longer time out.
- Free-text boxes capped at 300 characters; Videos screen only shows channels still on the list.
- Profile v8 (Gemini watching every whole video) was built without sign-off and reverted the same day —
  too expensive; see questionnaire follow-ups.

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
