# Backlog

What's next, in rough priority order. Update this file as things land.

## 0. Next up (agreed Oct 17–20 — rough order, reorder freely)

0. **Parent app UI redesign** (agreed Oct 20 — next). Same care as the kid app (research → tokens → build →
   test on the phone). Already known to fix on the way:
   - **Edit a child** (name, age, avatar) — today the age is only set at creation (changing it means editing
     Firestore). Changing the age should offer to update the content settings to the new age's defaults
     (it also switches the kid app between little ≤ 4 and big 5+ immediately).
   - **Setting a PIN** doesn't say you'll type it twice (it silently asks again) — show "Type it again" as a
     clear second step, with the digits as boxes.
   - Settings → Devices: rename a device; show when it was paired; a clearer "Ask Who's watching?" control.
1. **Compilations switch** — waiting for the sister's examples of the compilations she means (Ms Rachel's
   "+ MORE Nursery Rhymes" ones are fine). Likely reupload channels stitching others' clips ("BEST Peppa Pig
   moments 3 HOURS"). Needs a profile field → one `PROFILE_VERSION` bump.
2. **Kid player: standard YouTube player + a grown-up gate** (agreed Oct 18) instead of hiding YouTube's
   buttons (`HIDE_IN_PLAYER`, against YouTube's terms — see Security → kid player): links (share, Watch on
   YouTube, More videos, title) work again but first ask a grown-up question / passcode, then open the
   YouTube app. Apple *requires* a parental gate before links leave a Kids-category app. Plus a short
   "lock your kid's phone to Kideos" guide in parent setup (Guided Access on iPhone, screen pinning on
   Android — free, built in).
3. **Watch history screen** in the parent app (Home → "{child}'s history": what, when, how long). The kid
   app already writes `watchHistory` sessions (kept 90 days); there's just no screen for them.
4. **Fix the weekly digest** (see Confirmed bugs) and build it **in code, without AI**: watch time, top
   channels, shown/hidden counts. Today it sends a child's watch history to OpenAI — avoid that (COPPA:
   children's data to a third party). In-app screen only, no push.
5. **Compliance pack before launch** — see section 7.

Smaller follow-ups:
- **Clean up a removed channel's results**: removing a channel keeps its `videoVerdicts` (hidden in the
  parent app since Oct 19, never in the kid feed). Delete them ~1 month after removal if the channel wasn't
  re-added (re-adding within that time keeps the parent's Hide / Show anyway choices).
- **Tune the image-moderation thresholds** (`visualCheck.ts`) from the `visual=` numbers in real logs —
  they're a first guess, and the moderation model is trained mostly on photos (cartoons may score lower).
- **Tune pace**: watch for calm explainers rated 3 or hyper channels rated 2; add channels to
  `KNOWN_STIMULATION` only for well-known, consistent styles.
- **Kid app on iOS / iPad** (only tested on Android so far): link the fonts (`npx react-native-asset` on a
  Mac), landscape lock + hidden status bar / home indicator (AppDelegate `supportedInterfaceOrientations`,
  `prefersStatusBarHidden`, `prefersHomeIndicatorAutoHidden`), and check the drag gestures over WKWebView
  (the PanResponder may not get touches from YouTube's player there — `SWIPE_IN_PLAYER` is the backup).
- **Kid app release build on the 6T** — judge smoothness there, not in debug (debug is several times
  slower). If anything still stutters: React Native's Hermes profiler, then `FlashList` for the rows.
- **Remove the device move-over after Dec 31, 2026**: `onDeviceMigration` + `deviceMigrations` rule +
  `requestDeviceMigration` / the legacy-session branch in the kid app's `App.tsx` + `adoptLegacyWatched`;
  delete the `deviceMigrations` docs and old devices' `@kideos_unfinished` (single key) leftovers.

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
- **Kid pairing code expires but stays on screen.** `PairingScreen` makes one code (valid 15 min) and never
  replaces it, so after 15 minutes the parent gets "This code has expired". Regenerate it when it expires
  (and on "tap to get a new code").
- **Weekly digest push** would need an FCM token, which the app never registers — fine for now (no
  notifications by design), but decide when fixing the digest.
- **`cleanupExpiredData`** still deletes the legacy analysis cache (`collectionGroup("results")`) — remove
  that part, and add a TTL/cleanup for `triggerEvents`.

## 3. Security

- `pairingCodes`: expired codes are never deleted, and there's no rate limiting on creating/claiming.
- **Device binding is back (Oct 20)** with several kids per device (`kidDevices`, architecture → Pairing).
  Old one-child pairings move over by themselves until **Dec 31, 2026** (`onDeviceMigration`, `MIGRATION_CUTOFF`)
  — after that, remove the migration (rule, function, kid-app code) and old devices re-pair.
- The profile PIN is 4 digits checked on the kid device against a hash it can read — a sibling lock, not
  security (5 wrong → 30 s wait, in memory only).

- **Kid player — decide before launch.** Inside YouTube's player we hide the share button, the YouTube
  logo / "Watch on YouTube" button and "More videos" (`HIDE_IN_PLAYER` in
  `apps/Kideos/src/screens/PlayerScreen.tsx`; on Android it reaches YouTube's iframe through
  `apps/Kideos/patches/react-native-webview+13.16.1.patch`, applied on `npm install`). Everything else
  (controls, fullscreen, skip ad, title) is YouTube's as normal. **Changing the player is against YouTube's
  terms** (Required Minimum Functionality: "You must not make changes to the YouTube player that are not
  explicitly described by the API documentation") — risks at launch: losing API access, store rejection.
  **Decided Oct 18:** go back to the standard player and put a grown-up gate in front of links (Next up #2).
  Since Oct 20 the player also runs `SWIPE_IN_PLAYER` (a passive touch listener inside YouTube's iframe, for
  swipe gestures — it doesn't change or block anything, but it is code inside YouTube's player) and turns
  YouTube's fullscreen button off with the **official** `fs=0` parameter (that one is allowed). Also: "Made for
  Kids" videos must have tracking off (Developer Policies III.E.4.j); the player page is hosted on the
  library author's GitHub Pages (`lonelycpp.github.io`) — host our own.
  The title, channel name and channel picture are untappable; YouTube links never open (web view level
  too); ad links still open normally (left alone on purpose — don't interfere with ads). There is no
  YouTube Kids API or embeddable YouTube Kids player.

## 4. Missing features (from the May review, still open)

- Free vs Premium gating in the UI (digest, remote pause/stop, AI suggestions are Premium per spec).
- *Backburner:* the player's settings (gear) menu — "Stats for nerds" fills the screen and kids tap
  everything. Hide or disable it (or just that item), or make it a parent setting.
- Kid app "later" list ([kid-app-design.md](kid-app-design.md) → Not yet): TV focus states, a mascot,
  sounds / haptics, a "Continue watching" shelf.
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
- `apps/Kideos/src/pin.ts` is duplicated in `apps/KideosParent/src/pin.ts` (like `prefs.ts`).
- `KideosWindowModule` is an old-style native module (runs through React Native's interop layer on the New
  Architecture) — fine for now; convert to a TurboModule if the interop layer is ever dropped.
- The kid player logs its size (`[player] window … → player …`) in debug builds — remove once the layout is
  settled on tablets.

## 7. Compliance before launch (not legal advice — get it checked)

COPPA's amended rule is in force since Apr 22, 2026:
- a written, published **data retention policy** (watch history 90 days, verdicts, profiles…);
- a written **security program** (device binding — done Oct 20 — is part of "reasonable security");
- a **privacy notice** naming the third parties that receive data (OpenAI, Google/Gemini, Supadata,
  YouTube);
- **verifiable parental consent** at parent sign-up; parents can delete their data (within 30 days);
- **"Made for Kids" videos must have tracking off** in the embed (YouTube Developer Policies III.E.4.j).

YouTube API Services policies (reviewed Oct 18 with Adam — he accepts the risk at 100–200 families, but
these are the known gaps):
- **Player changes** — hiding share / YouTube logo / More videos and blocking links breaks "don't modify or
  block the standard player". Plan: Next up #2 (standard player + grown-up gate).
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

Oct 20 (branch `multi-kid`): **several kids on one device + device binding + a smooth kid app**
- **Pairing to the family:** the parent picks which children use a device (checkboxes) and can name it;
  `users/{p}/kidDevices/{deviceUid}`; Settings → **Devices** (who uses it, "Ask Who's watching?" every time /
  1 / 5 / 10 / 20 / 30 min, Unpair → the device returns to pairing at once).
- **"Who's watching?"** in the kid app: avatar tiles, optional **4-digit PIN per child** (hash only; 5 wrong
  → 30 s wait), asked after a full restart and after being away longer than the setting; avatar on the feed,
  Time's up and the empty feed switch profile. Per child: layout, videos, rules, owed video, ✓s, End Session.
- **Device binding** in the rules (`isKid` reads `kidDevices`); rules tests rewritten (siblings a device isn't
  paired to, unpairing, move-over requests). Old one-child pairings move over by themselves
  (`onDeviceMigration`, until Dec 31). Deleting a child removes it from every device.
- **Feel:** every button lights up while pressed; the chip bar lights the tapped chip instantly (it used to
  redraw every row); "See all" slides in/out over a home screen that stays alive; the player opens on top of
  the feed (Back is instant); "Who's watching?" slides down; a "Hi Simon!" card waits for the feed's videos;
  status bar hidden on every screen (fixed sideways layout jumps); moves are quick with an ease-out.
- **Player:** the tapped thumbnail zooms into the player and stays until the video plays; drag down in any
  downward direction → the video follows the finger and flies off; drag up → it rises into "More from";
  owed minimum time → it only stretches.
- Fixes: a kid with no channels was stuck (no way back to the picker); the chip bar showed through the
  player and the picker on Android; drag-up was read as drag-down (PanResponder resets `dx/dy` at grant).

Oct 20 (branch `kid-feed-layout`, merged as #11): **kid app redesign**
- Research-based design system (`theme.ts`): Twilight purple, Sunset Orange actions (ink text), Sunny Yellow
  focus, Fredoka + Nunito (bundled, OFL), sizes from the window (`useLayout`). Design doc:
  [kid-app-design.md](kid-app-design.md).
- **Little mode (≤ 4)**: channel bubbles + one sideways strip, landscape only; **big mode (5+)**: YouTube
  Kids-style shelves (New / Shorts / per channel), collapsing "Hi Simon" header with a pinned chip bar,
  "See all" channel pages, end cap.
- **Full screen** (status + navigation bars hidden, `KideosWindowModule`), watched ✓ stickers, Time's up
  with offline activities, pairing code tiles, friendly notices instead of system alerts.
- **Player**: full screen from the tap, long videos locked to landscape, YouTube's fullscreen button off
  (official `fs=0`), back button in the black space beside the video (never on it), end card (Watch again /
  My videos / 3 more), swipe down / up gestures, no autoplay.
- First: **kid feed laid out like YouTube Kids** — ✨ New row, ⚡ Shorts row (only if any), one row per
  channel, tap a channel → all its videos; live, no refresh.

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
- Device binding built, then reverted the same day (an unrelated onboarding bug made it look broken).
  *(Back for good Oct 20 — see the `multi-kid` entry.)*
