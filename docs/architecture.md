# Architecture

How Kideos works end to end. For running/deploying see [development.md](development.md); for *why* the
questionnaire and profiles look this way see [questionnaire-research.md](questionnaire-research.md).

```
 ┌──────────────────────┐   writes answers, channels,     ┌───────────────────────────────┐
 │  Kideos for Parents  │   Show anyway, commands         │           Firestore            │
 │  (KideosParent)      │ ──────────────────────────────► │  users/{parent}/children/{kid} │
 │                      │ ◄────────────────────────────── │  videoProfiles, transcripts…   │
 └──────────────────────┘   verdicts, now watching        └──────┬─────────────▲──────────┘
            │ callable functions                                  │ triggers    │ writes verdicts,
            ▼                                                     ▼             │ profiles, catalog
 ┌───────────────────────────────────────────────────────────────────────────────┴──────────┐
 │  Cloud Functions (us-central1)                                                            │
 │  checkChannel (review before adding) → resolveAndAddChannel → [whitelist doc created] →    │
 │  onChannelWhitelisted → per-video pipeline   [answers saved] → onFiltersChanged → re-apply│
 │  getChannelSuggestions · parseCustomRules · onPaceReport · reprofileOutdated (nightly)    │
 └──────┬────────────────────┬─────────────────────┬──────────────────────┬─────────────────┘
        ▼                    ▼                     ▼                      ▼
   YouTube Data API     Supadata (transcripts)   OpenAI GPT-4o-mini     Gemini Flash-Lite
                                                 (profiles + free       (channel check:
                                                  image moderation)      thumbnails + search)
                                                                    ┌────────────────────┐
                    reads approved verdicts, playSignal;            │  Kideos (kid app)  │
                    writes nowPlaying, watchHistory  ◄────────────► │  anonymous auth    │
                                                                    └────────────────────┘
```

## Core idea: profile once, filter per child

1. **Content profile** (`videoProfiles/{videoId}`) — what a video contains, on fixed scales. Generated
   **once per video** and **shared by every family**; filter-independent. Built from (details under
   [Adding a channel](#adding-a-channel--analysis)):
   - one GPT-4o-mini call that reads the transcript + metadata + code-counted pace stats and **sees 4 still
     images** (thumbnail + YouTube's 3 auto frames at 480×360). Videos **without captions** are rated from
     the metadata + images alone (`basis: "metadata"`);
   - **floors the AI can't go under**: swear words counted in code, OpenAI's free **image moderation** on
     the same 4 images (sexual / violent / graphic / self-harm scores → minimum levels, `visualCheck.ts`),
     a known-channel pace floor (CoComelon & co.), and parents' **"Too hyper"** reports (2+ families →
     overstimulating);
   - YouTube's own labels: `madeForKids`, and `isShort` (is it a Short).

   Versioned (`PROFILE_VERSION` in `aiAnalysis.ts`, **now 7**): bump it and the nightly
   **`reprofileOutdated`** regenerates old profiles from cached transcripts (never Supadata), rebuilds the
   catalog and re-applies filters. Profiles ≥ `MIN_USABLE_PROFILE_VERSION` (3) keep working meanwhile;
   dimensions an older profile doesn't have yet count as 0 (`effectiveDims`).
2. **Questionnaire answers** (`users/{p}/children/{c}/valueFilters/current`) — per child, see
   [the questionnaire](#the-questionnaire).
3. **Verdict** (`users/{p}/children/{c}/videoVerdicts/{videoId}`) — answers applied to the profile **in
   plain code** (`contentFilter.ts`): `approved` or `hidden`, with a plain-words reason and the video's
   ratings. The kid feed shows only `approved == true`. There's no approval queue: parents browse
   Shown / Hidden in the **Videos** screen and can "Show anyway" one video.

4. **Channel check** (`channelChecks/{channelId}`) — made **once per channel** when a parent first types
   it in, before it's added, and shared by every family: Gemini Flash-Lite looks at the channel's 50
   latest thumbnails + titles and searches Google for its reputation, and records everything a video
   profile records for the channel as a whole, plus sources and who it's made for. Each child's fit is
   worked out **in code** with the same `evaluateProfile` as videos. See
   [Checking a channel before adding it](#checking-a-channel-before-adding-it).

Changing answers only re-runs step 3 → instant, no Supadata, no AI calls. **Rule of the codebase: pay
for AI once, then decide in code.**

## The questionnaire

Defined in `functions/src/prefs.ts` (copied to `apps/KideosParent/src/prefs.ts` — **keep in sync**), UI in
`apps/KideosParent/src/components/FiltersForm.tsx` (used by onboarding and Settings).

- **About the child:** age (drives defaults), sensitivity to scary content (shifts scary/mature themes ±1).
- **15 core ladders** (0–4, examples on every rung): violence, scary, language, romance, sexual,
  substances, dangerous stunts, self-harm, meanness/pranks, consumerism, politics, religion, gambling
  (mentioned → discussed → shown → promoted; a ladder since profile v4 — before, any mention counted as
  the top), **pace & stimulation** (calm → gentle → lively → high energy → overstimulating; examples Ms
  Rachel 1, Bluey 2, CoComelon/MrBeast 3, Skibidi 4; age defaults 2/3/3/4/4), **junk & knock-offs** (low
  effort → clickbait/knock-off characters → looped "effects" spam → Elsagate; defaults 1/1/1/2/2). Each has
  `max` (highest allowed level); anything above it is hidden.
- **Global rules:** educational videos +1 level (violence/scary/substances/politics); always hide
  glamorized violence/substances/self-harm/cruelty; **"made for kids" videos only** (YouTube's label; off by
  default); **No Shorts** (off by default); what to do when a rating can't be told (`unknown`: allow /
  hide; default hide). Since v6 videos without captions are rated from metadata + images, so `unknown`
  only matters for single ratings the AI leaves `null` (and for old `no_transcript` placeholders).
- **Faith & family values (optional):** "which faith is your family" (only effect: own faith's religious
  content is exempt from the religion ladder), 10 holidays (ok / in passing / hide), and
  ok/hide checks: pork, non-kosher, cooking with alcohol, beef, prophet depictions, God's name as an
  exclamation, fantasy magic, real occult, evolution, videos with music (best effort).
- **More topics (optional):** crude humor, mature themes, misinformation, nudity (best effort) ladders;
  LGBTQ+ (allow / allow presence but hide discussion & advocacy / hide all);
  mature-rated games.
- **Anything else (free text, max 300 characters — `FREE_TEXT_MAX`, enforced in the app and in
  `normalizePrefs`):** "Turn this into settings" → `parseCustomRules` maps it to the settings above for the
  parent to confirm; leftovers stay as `customRules` and are checked per video by AI. The faith text box
  ("check against our faith's values in general") has the same limit.
- **Hard limits, whatever the answers:** detailed/glamorized self-harm (level ≥3) and explicit sexual
  content (4) are always hidden.

Age defaults: `AGE_TABLE` in `prefs.ts`. Old (v1) saved filters are converted by `normalizePrefs()`.

## Flows

### Parent sign-in
`AuthScreen` → Google (primary) / Apple (iOS) / email. `useAuth` syncs Firebase Auth to the Zustand store;
`App.tsx` routes: not signed in → Auth; no children → onboarding (CreateChild → SetFilters → AddChannels);
otherwise → tabs (Home, Channels, Digest, Settings). Store flags `inOnboarding` / `childrenLoaded` prevent
mid-onboarding stack swaps and onboarding flashes.

### Pairing the kid's device
Kid app signs in anonymously (it waits for auth before rendering anything — Firestore listeners started
earlier are denied and never retry) → `PairingScreen` writes `pairingCodes/{code}` (6 chars) including its
→ parent enters the code on Home → `claimPairingCode` marks it claimed with `parentId`/`childId` → kid app
sees the update and saves the session in AsyncStorage (`useSession`). To unpair: clear app data
(`adb shell pm clear com.kideos.app`) and pair again.
⚠️ Kid paths in the rules allow **any signed-in device** (`isKid()` = signed in). Device binding
(`kidDeviceUids`) was built on Oct 17 and reverted the same day — see backlog → Security.

### Checking a channel before adding it
Channels screen "+" (and onboarding step 3) → the parent types a URL/@handle → **Check & Add** → callable
**`checkChannel`** (`channelCheck.ts`):
1. `channels.list` (1 unit) resolves the channel; already on the child's list → "Already added".
2. **Shared profile, made once:** `channelChecks/{channelId}` with the current `CHECK_VERSION` → used as
   is (log: `Cached:`). Otherwise one **Gemini Flash-Lite** call (`GEMINI_MODEL`, low media resolution):
   the 50 latest thumbnails (320×180, downloaded and sent inline) + titles + channel description, with
   **Google Search** grounding (targeted searches: "<channel> swearing / controversy / inappropriate for
   kids / parents review"). The prompt includes the video check's exact ladder definitions and examples
   (`LADDER_GUIDE`), so levels mean the same for channels and videos. Output, saved: the AI's general
   verdict for kids (good / caution / not recommended), summary, what people say + sources, `wellKnown`
   (false = small channel, little found), audience ages, and a **full channel profile** — every ladder
   with level + evidence + basis (thumbnails / what people say / both), framing, faith, holidays, music,
   LGBTQ+, value flags, topics, purpose. If search fails it retries thumbnails-only; if Gemini fails the
   parent can still add the channel ("We couldn't check this channel").
3. **Floors from videos already analyzed (free):** if any family added the channel before,
   `channelCatalog/{channelId}` has its checked videos' ratings; a level reached by ≥2 of them raises the
   channel's rating ("its videos: 2 of its 50 checked videos") — catches what thumbnails and a shallow
   search miss (e.g. constant swearing). Applied per request, never saved over the AI's profile.
4. **Per child, in code:** the channel profile goes through the same `evaluateProfile` as videos (video-only
   switches — made-for-kids, Shorts — don't apply) → `conflicts` in plain words with the child's limit,
   `fit`: **not_fit** (a medium/high-severity conflict — ≥2 levels over the limit, a level-4 rating,
   glamorized content — or junk ≥3 over the limit), **caution** (any other conflict, or an age mismatch),
   **good**; plus `findings` (anything ≥2) and an
   age note ("Made for ages 13+ — Simon is 6").
5. The review sheet (`components/ChannelReview.tsx`): badge "✅ Fits Simon's settings" / calm yellow
   "⚠️ N things to know for Simon" (normal "Add channel" button) / red "⛔ Not a fit for Simon" ("Add
   anyway" / "Don't add it"); the AI's general opinion as one small line ("Overall: …"); what the channel
   makes; what's past the child's settings; what people say + tappable sources; thumbnail findings;
   findings from its already-checked videos. Nothing is added until the parent confirms → `addChannel`.

Every way of adding a channel goes through this review: the Channels screen, onboarding, the suggested-
channel swipe cards ("Add to {child}'s feed") and the older AI suggestions on the Channels tab ("✓ Add" —
confirming marks the suggestion approved).

**After adding — current settings vs saved checks:** callable **`getChannelFits`** (no AI) runs
`fitForChild` on the saved checks of the child's channels (with video floors) against their *current*
settings. The Channels screen calls it when the tab is opened and when the list changes, and shows "⚠️ N
things to know" / "⛔ Not a fit with current settings" under a channel (tap → the reasons). Channels
added before checks existed have no saved check and show nothing.

### Adding a channel → analysis
1. Parent confirms → callable **`resolveAndAddChannel`**: `channels.list` (1 unit), creates
   `whitelistedChannels/{channelId}` with `seedingStatus: "pending"` ("Analyzing…" in the app), returns.
2. The create fires **`onChannelWhitelisted`** (own invocation, 9 min, full CPU; duplicate deliveries
   deduped via `triggerEvents/{eventId}`): channel metadata → `channelLibraryCache/{channelId}`, then the
   channel's **40 latest long videos + 10 latest Shorts** as stubs → `channelLibraryCache/{channelId}/videos/
   {videoId}` (`kind: long | short`). They come from YouTube's undocumented per-type playlists — `UULF…`
   (long videos) and `UUSH…` (Shorts) next to the uploads playlist `UU…` (`seedLongAndShorts`, 2 units);
   if YouTube doesn't know them, the 50 latest uploads (mixed) are used. Why: most creators' newest 50
   uploads are ~90% Shorts. The long-videos page token is saved (`longPageToken`, `longExhausted`) for
   "Load more videos". Then `batchAnalyzeChannel`
   (5 videos at a time; Supadata requests start ≥1.1s apart in `supadata.ts` without waiting for each
   other, so a 50-video channel fits well inside the 9-minute limit) → `analyzeAndTagVideo` per video → `seedingStatus: "ready"`, `videoCount`.
3. **`analyzeAndTagVideo`** (`analyzeVideo.ts`), per video per child:
   - **Profile** (`getOrCreateProfile`): cache hit → done. Miss → YouTube `videos.list` (missing, private,
     or **embedding disabled by the owner** — common for label music videos → hidden as unavailable, not
     cached) → transcript via `getTranscriptCached` → `generateContentProfile` → saved. Confirmed "no
     transcript" → rated from metadata + images (`basis: "metadata"`); transient failures (429, AI error)
     save nothing → video hidden as `analysis_pending`, retried next run.
   - **`generateContentProfile`** (`aiAnalysis.ts`): `paceStats` (words/min, sound tags like `[Music]` per
     minute, share of repeated 4-word phrases) + title signals (caps %, emoji, "!") go into the prompt; one
     GPT-4o-mini call with the 4 stills at low detail (`stillImages`: API thumbnail + `hq1–3.jpg`; retried
     text-only if an image won't load), JSON on fixed ladders with evidence first. In parallel:
     `moderateImages` (OpenAI moderation, one free request per image) and `checkIsShort`. Then floors, which
     only raise: `swearFloor`, `applyVisualFloors` (sexual ≥25% → 2, ≥50% → 3, ≥85% → 4, + nudity; sexual
     minors ≥10% → sexual 4 + junk 4; graphic ≥40% → violence 4; violent ≥50% → 3; self-harm ≥50% → 3),
     `KNOWN_STIMULATION` (CoComelon, Little Baby Bum, ChuChu TV, Blippi, MrBeast → 3; Skibidi → 4). The log
     line shows every level plus `pace=`, `visual=` and `short=`.
   - **Decision** (`decideForChild`): `evaluateProfile(profile, answers)`; if not already hidden and the
     parent set religion text / custom rules → `checkValuesRules` (AI on the short summary, cached per
     rules hash in `videoProfiles/{v}/valuesChecks/{hash}`).
   - **Write** the verdict: `status`, `reason`, `ratings` (the video's non-zero ladder levels + evidence),
     channel name, title/thumbnail; `approved` honours `parentDecision` ("Show anyway"), which the
     pipeline never overwrites. No notifications, no queue.

### Changing answers
`saveValueFilters` overwrites `valueFilters/current` → **`onFiltersChanged`** (skips no-op writes, deduped)
→ `reapplyFiltersForChild`: for every `ready` channel, every video with a current-version profile →
`decideForChild` → verdicts in batches, `videoCount` per channel. Videos without a current profile are
left as they are (re-add the channel to re-profile).

### Videos screen (Shown / Hidden)
Home → "{child}'s videos" → `VideosScreen`: the child's verdicts (`subscribeToVerdicts`) for channels
**still on the list** (a removed channel's verdicts stay in Firestore, unseen — cleanup is on the backlog),
split into **Shown** and **Hidden**. Each card shows the video's ratings as chips; hidden ones show *why* in plain
words, including the parent's limit (e.g. "Moderate swearing (sh\*t ×3) — your limit: Mild swearing").
Nothing needs action — parents look when they want to. **Tap a video** → details sheet: tap the thumbnail
to **watch it** (`components/VideoPreview.tsx`, YouTube player at 16:9), channel name + "· Made for kids",
summary, "No captions — rated from the title, description and a few still images" when `basis` is
`metadata`, every rating with its evidence, status, one action, and **"Too hyper? Hide it and tell us"**
(`reportTooHyper`: hides it + writes `videoProfiles/{v}/paceReports/{parent}`). **Hide** on a Shown card, or **Select** → tick several →
**Hide N videos** (`hideVideo` / `hideVideos` → `parentDecision: "hidden"`, `approved: false`; shows as
"You hid this" + Undo). **"Show anyway…"** opens a confirmation screen
(the safe button is "Keep it hidden"); confirming calls `setShowAnyway` → `parentDecision: "approved"`,
`approved: true`. **Undo** (on Shown) deletes `parentDecision` and puts `approved` back to `status`. Rules
only allow those two fields and require `approved` to match.

### Watching + remote control
Kid feed: `subscribeToApprovedVideos` (child's verdicts, `approved == true`, newest first, filtered to
currently whitelisted channels; channel names filled from the whitelist).

Player (`apps/Kideos/src/screens/PlayerScreen.tsx`, `react-native-youtube-iframe`):
- Inside YouTube's iframe, `HIDE_IN_PLAYER` hides the share button, the YouTube logo / "Watch on YouTube"
  and "More videos", and makes the title / channel name / channel picture untappable. ⚠️ Against YouTube's
  terms — decide before launch (backlog → kid player). On Android this needs
  `patches/react-native-webview+13.16.1.patch` (document-start scripts in all frames; fullscreen →
  landscape). Web-view-level backup: YouTube pages never open; ad links open as normal.
- `patches/react-native-youtube-iframe+2.4.1.patch`: play / pause are injected directly (the library's
  postMessage never reached the page on Android, so remote pause didn't work).
- Writes `currentSession/nowPlaying` (+ `paused`, updated on play/pause) and a `watchHistory` session
  (`expiresAt` +90 days); closes the video if its verdict stops being approved ("Hide this video").
- If YouTube refuses to play a video (`embed_not_allowed` / `video_not_found`), the player closes it with
  "This video can't play here — pick another one!".

**Viewing rules** — parent app Settings → a child → **Viewing** → "Before switching videos, stay at
least": Off / 30 s / 1 min / 2 min / Whole, saved on the child doc as `viewing.minWatchSeconds` (0 / 30 / 60 /
120, −1 = whole video; the kid app may read the child doc — `subscribeToViewingRules`). In the kid app
(`PlayerScreen`, `src/viewing.ts`): until the time is up, ← Back and Android's back button keep the kid on
the video with a banner — "Watch a little more! 0:12 left" (timed) or "Finish this one first! 2:41 left"
(whole video). No waiting screens.
- **Timed:** counts from when the video first starts playing, by the clock — pausing counts, and so does
  time with the app closed (a kid who watched 5 s and comes back 10 min later can leave).
- **Whole video:** ~90% of the length actually played (`FINISHED_SHARE`; 1 s ticks while playing and the
  app is in front; seeking doesn't count). Unknown length → never blocked.
- Dragging to the end while time is still owed → "Nice try 😄" and back to the furthest point reached by
  playing; a video that really ends (most of it played — e.g. a short one) always lets them go.
- The owed video is saved to AsyncStorage (when it starts playing and every 5 s), so closing the app
  reopens it if time is still owed. A parent's **Hide this video** or **End Session** always gets the kid
  out (and clears it); turning the rule off releases it. Android back now returns to the feed instead of
  closing the app.

Remote control: parent → `currentSession/parentCommand` (`pause` / `play` / `stop`) →
**`handleParentCommand`** → `currentSession/playSignal`. The kid player reacts only to commands sent while
the video is open (the first snapshot is the last command, maybe old). `stop` locks the **whole** kid app
on "Time's up" (App.tsx, survives restarts) until the parent sends `play` ("Let them watch again").

Parent Home → "{child}'s Screen": ▶ Now watching / ⏸ Paused (tap the thumbnail to watch the same video
on the parent's phone), a Pause/Resume toggle, End Session, the video's summary (2 lines, more/less — read
from `videoProfiles`), "✓ Fits all of {child}'s settings" or "Shown because you allowed it", each rating
with its evidence, and **🚩 Hide this video** → Cancel / **Too hyper** (hide + report) / **Hide video**
(`parentDecision: "hidden"`). When watching is off: "Watching is off" + "Let them watch again".

### Nightly / weekly jobs
- **`refreshChannelLibraries`** (03:00 UTC): new uploads per whitelisted channel (50 latest, mixed) → stubs →
  analyzed for each child who has the channel (profiles shared). Channels run back to back (no stagger).
  **One-time top-up** for channels seeded before Oct 20 (no `longSeededAt`): their 40 latest long videos are
  added and analyzed too — at most 2 channels a night, only in the first 4 minutes; the flag is set after
  analysis, so a run that times out redoes it next night (existing profiles are reused).
- **"Load more videos"** (Channels screen, under each ready channel) → callable **`loadMoreVideos`** marks
  the child's whitelist doc (`moreRequestedAt`, "Analyzing…") → trigger **`onMoreVideosRequested`**: the next
  50 older long videos (continuing `longPageToken`; channels from before Oct 20 start at the newest long
  videos, skipping ones already there) → analyzed for that child → `videoCount` updated. "That's
  everything" when `longExhausted`. Paid per new video (Supadata + OpenAI), shared after; other children
  with the channel don't get those older videos unless they load more too.
- **`cleanupExpiredData`** (02:00 UTC): deletes `watchHistory` past `expiresAt` (COPPA 90 days) + legacy
  analysis-cache entries.
- **`generateWeeklyDigest`** (Mon 08:00 UTC, Premium): GPT summary of the week. ⚠️ Path mismatch — see backlog.
- **`reprofileOutdated`** (04:00 UTC, or Force run in Cloud Scheduler): profiles older than
  `PROFILE_VERSION` → regenerated from cached transcripts only (never Supadata; videos confirmed to have no
  transcript are rated from metadata + images), 5 at a time, catalog entries rebuilt, filters re-applied
  for affected children. Stops before the time limit; the next run continues. "Too hyper" counts survive.
- **`onPaceReport`** (trigger on `videoProfiles/{v}/paceReports/{parent}`): ignores writers without a
  `users/{id}` doc (kid devices), counts the reports into `tooHyperReports`. Other families see the effect
  on their next re-apply.
- **`weeklyChannelSuggestions`** (Mon 10:00 UTC): older AI-from-description channel picks per child
  (Channels tab) — to be retired in favour of suggested channels.

### COPPA deletion
Settings → delete child data → callable **`deleteChildData`**: `recursiveDelete` on the child doc — the doc
and every subcollection under it, however large.

### Suggested channels
Every channel any family adds gets a shared **channel profile** in `channelCatalog/{channelId}`
(`buildCatalogEntry`, run after seeding and after the nightly refresh): the channel's 50 latest analyzed
videos as compact profiles, top topics, and a 2–3 sentence overview (the only AI call, once per channel).
No Supadata, no per-video AI — it reuses `videoProfiles`.
**Which videos count:** the catalog holds a channel's latest 40 long videos + 10 Shorts. **Long videos
decide** (fit share, severe count, hidden reasons); Shorts are shown on their own line ("Shorts: 7 of 10 fit")
and not counted at all if the child has "No Shorts". Channels with fewer than 10 checked long videos are
scored on everything (minus Shorts with "No Shorts"). The `Not suggested:` log line lists the top hidden
reasons (`fit 29/40 long videos (72%) < 75% — hidden for: High energy (8), Product promotion (4)`).
Home → "Suggested channels" → `SuggestionsScreen` → callable **`getChannelSuggestions`**: runs
`evaluateProfile` on every catalog video against the child's answers (pure code), skips channels already
in the child's list or dismissed. If someone has already made a **channel check** for a channel, it's used
too (no new AI): "not a fit" for this child → not suggested (logged `channel check: not a fit (…)`);
otherwise the card shows its "⚠️ N things to know (thumbnails + what people say)" or "✅ Thumbnails and what
people say fit {child}'s settings". **A suggestion vouches for the channel, so the bar is higher than for
adding one:** ≥10 checked videos (no-transcript ones are left out — unknown, not bad), ≥75% of them fit, and
at most 2 severe videos (3+ rule it out; 1–2 show as a ⚠ warning on the card). Severe is absolute, not
relative to the child's strictness: the top of a ladder the child hasn't allowed (strong swearing, graphic
violence, gambling promoted…) or self-harm ≥3. So a channel where only the mild Shorts pass (EpicMealTime)
is never suggested, but SciShow isn't sunk by one predator video. Suggestions are also **for the child's age**: the overview call
estimates who the channel is made for (`audienceMinAge`/`audienceMaxAge`, e.g. Ms Rachel 1–4, SciShow 12+);
a channel is suggested only within ±1 year of that (all-ages channels to everyone), and the card shows
"Made for ages …". Rejected channels are logged with the reason (`Not suggested: … —`). The overview is written with the
channel's content counts, so it mentions heavy content plainly. Then it ranks by share of fitting videos (then educational share if the parent
ticked that). Each card: overview, "X of 50 videos fit", top reasons the rest would be hidden, what's in the
videos that would show, sample videos. Swipe left / "Not for us" → `dismissedSuggestions/{ch}` (never
suggested again); swipe right → maybe later (skipped this time). Adding is a tap on "Add to {child}'s
feed" (→ `resolveAndAddChannel`) — never a swipe. Custom rules / religion text aren't applied to
suggestions; they apply once the channel is added. Channels added before this feature are backfilled
(up to 10 per `getChannelSuggestions` call).

## Firestore data model

| Path | Contents | Written by | Read by |
|---|---|---|---|
| `users/{p}` | parent profile (email, createdAt) | parent app | parent |
| `users/{p}/children/{c}` | child profile (name, age, avatar, mode, `viewing.minWatchSeconds`) | parent app | parent, signed-in kid devices |
| `…/children/{c}/dismissedSuggestions/{ch}` | "Not for us" on a suggested channel | parent | parent |
| `…/children/{c}/valueFilters/current` | questionnaire answers (`version: 2`, see `prefs.ts`) | parent app | parent, functions |
| `…/children/{c}/whitelistedChannels/{ch}` | name, thumbnail, `seedingStatus` pending/ready/error, `videoCount` | functions (create), parent (delete) | parent, kid |
| `…/children/{c}/videoVerdicts/{v}` | `approved`, `status` (approved/hidden), `reason`, `ratings` (non-zero levels + evidence, incl. "Too hyper"), `summary`, `flags`, `severity`, `madeForKids?`, `basis?`, `isShort?`, channel/title/thumbnail/publishedAt, `parentDecision?` | functions; parent may set/clear `parentDecision`+`approved` only | kid feed, Videos screen |
| `…/children/{c}/flaggedContent/{v}` | **legacy** review queue — no longer written or shown | — | — |
| `…/children/{c}/watchHistory/{id}` | video, start/end, duration, `expiresAt` | kid app | parent, digest |
| `…/children/{c}/currentSession/nowPlaying·parentCommand·playSignal` | live session (`nowPlaying.paused`) + remote control (`pause`/`play`/`stop`; last `stop` = kid app locked) | kid / parent / function | both |
| `…/children/{c}/suggestions/{id}` | AI channel suggestions + `parentResponse` | functions | parent |
| `…/children/{c}/digests/{week}` | weekly digest | functions | *(parent reads the wrong path — backlog)* |
| `pairingCodes/{code}` | pairing handshake: `claimed`, `parentId`, `childId` | kid (create), parent (claim) | anyone |
| `channelLibraryCache/{ch}` (+ `/videos/{v}`) | shared channel metadata, `longSeededAt` / `longPageToken` / `longExhausted` (long-video seeding); video stubs with `kind` (long / short; absent = mixed list) (`approved` field is legacy) | functions | kid (metadata), functions |
| `channelCatalog/{ch}` | shared channel profile for suggestions (compact video profiles, overview, topics) | functions | functions only |
| `channelChecks/{ch}` | channel check made once before the first add (`CHECK_VERSION`): verdict, reputation + sources, audience age, full channel profile (every rating with evidence and source) | functions | functions only (returned via `checkChannel`) |
| `videoProfiles/{v}` (+ `/valuesChecks/{hash}`) | content profiles (`version`, `status`, `dims` with evidence, framing, faith, holidays, music, LGBTQ+, flags, topics, summary, `madeForKids`, `basis`, `pace`, `visual` moderation scores, `isShort`, `tooHyperReports`), values-check cache | functions | profiles: signed-in users (public-video analysis only); valuesChecks: functions only |
| `videoProfiles/{v}/paceReports/{p}` | a parent's "Too hyper" report (counted into the profile's `tooHyperReports` by `onPaceReport`) | parent (own id only) | functions only |
| `transcriptCache/{v}` | transcript text, or `{available: false}` when confirmed none | functions | functions only |
| `triggerEvents/{eventId}` | dedupe markers for at-least-once triggers | functions | functions only |
| `videoAnalysisCache/…` | **legacy** (pre-profile verdict cache), unused — safe to delete | — | — |

Rules: `firestore.rules`. Kid devices (any signed-in device — binding reverted) can read a child's whitelist,
verdicts and session, write `nowPlaying` and watch sessions; parents own
everything under `users/{their uid}`; server-only collections are default-deny. Indexes: `firestore.indexes.json` (notably
`videoVerdicts: approved ASC, publishedAt DESC` for the kid feed).

## Backend (`functions/src`)

| File | What's in it |
|---|---|
| `index.ts` | Exports every deployed function |
| `config.ts` | Secrets (`YOUTUBE_API_KEY`, `SUPADATA_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) + `APP_CONFIG` (model, region, 50 videos/channel) |
| `seedChannelLibrary.ts` | `resolveAndAddChannel`, `onChannelWhitelisted`, `onFiltersChanged`, `refreshChannelLibraries` (+ long-video top-up), `loadMoreVideos` + `onMoreVideosRequested`, `seedChannelLibrary` (legacy callable, unused by the app); internal `seedLongAndShorts`, `writeStubs`, `batchAnalyzeChannel`, `seedAndAnalyzeInBackground` |
| `analyzeVideo.ts` | Per-video pipeline: `analyzeAndTagVideo`, `reapplyFiltersForChild`, `loadValueFiltersForChild`; internal `getOrCreateProfile`, `decideForChild`, `writeVerdict`, `summarizeRatings`, `getTranscriptCached` |
| `aiAnalysis.ts` | `generateContentProfile` (profile prompt + validation; 4 stills; floors), `paceStats`, title signals, `stillImages`, `KNOWN_STIMULATION`, `swearFloor` and regexes (code-counted swearing, God's-name exclamations, `[Music]`), `LADDER_GUIDE` (the ladder definitions, shared with the channel check — sliced from the prompt between `Ladders (0 = none` and `- framing:`, keep those markers), `checkValuesRules`, `needsValuesCheck`, `hashValuesRules`, `PROFILE_VERSION`, `MIN_USABLE_PROFILE_VERSION` |
| `visualCheck.ts` | `moderateImages` (OpenAI image moderation on the thumbnail + 3 frames, free) and `applyVisualFloors` (its scores raise sexual / nudity / violence / self-harm / junk; never lower) |
| `channelCheck.ts` | `checkChannel` callable: shared channel check before adding (Gemini Flash-Lite: 50 thumbnails at low resolution + Google Search), floors from already-analyzed videos (`applyVideoFloors`), per-child fit via `evaluateProfile` (`fitForChild`); `getChannelFits` callable (the child's channels vs current settings, saved checks only) |
| `paceReports.ts` | `onPaceReport`: counts parents' "Too hyper" reports into `videoProfiles/{v}.tooHyperReports` (2+ families → overstimulating) |
| `contentFilter.ts` | `evaluateProfile(profile, answers, valuesViolation?)` → approved/hidden + plain-words reason (with the parent's limit), flags, severity — the whole matching logic, pure code (also used for channel checks); `effectiveDims` (missing dims → 0, "Too hyper" → 4), `TOO_HYPER_REPORTS` |
| `prefs.ts` | Questionnaire: `DIMS`, `LEVEL_LABELS`, `HOLIDAYS`, `VALUE_FLAGS`, `AGE_TABLE`, `FREE_TEXT_MAX`, `defaultPrefs`, `normalizePrefs`, `describePrefs` |
| `customRules.ts` | `parseCustomRules` callable (free text → whitelisted setting changes) |
| `supadata.ts` | `fetchTranscript` — requests start ≥1.1s apart (not one-at-a-time), `text=true&lang=en`, no retries; marks "no transcript" as `definitive` |
| `youtube.ts` | `parseChannelInput`, `getChannelDetails`, `getChannelVideos`, `getPlaylistPage` (+ `longVideosPlaylist` / `shortsPlaylist`: the `UULF…` / `UUSH…` siblings of the uploads playlist), `getVideoDetails`, `checkIsShort`, `verifyChannelHandles` — never `search.list` |
| `channelCatalog.ts` | Suggested channels: `buildCatalogEntry` (shared channel profile from analyzed videos — also the source of the channel check's video floors), `scoreChannel`, `getChannelSuggestions` callable |
| `suggestChannels.ts` | `suggestChannels` callable + `weeklyChannelSuggestions` (older AI-from-description suggestions, still shown on the Channels tab) |
| `reprofile.ts` | `reprofileOutdated` (nightly 04:00 UTC, or Force run in Cloud Scheduler): old-version profiles → current, cached transcripts only |
| `scheduledJobs.ts` | `cleanupExpiredData`, `generateWeeklyDigest`, `handleParentCommand`, `deleteChildData` |
| `types.ts` | Firestore types (`ContentProfile`, `VideoVerdict`, `ValueFilters`, …) |

## Apps

**Kid app (`apps/Kideos`)** — `App.tsx` (anonymous auth gate → Pairing / Feed / Player / Time's up;
reopens a video still owed), `src/viewing.ts` (viewing rules, the owed video in AsyncStorage),
`hooks/useSession.ts` (paired session in AsyncStorage), `screens/PairingScreen.tsx`,
`screens/FeedScreen.tsx` (grid, channel names, remote stop), `screens/PlayerScreen.tsx`,
`services/firebase.ts` (`subscribeToWhitelistedChannels`, `subscribeToApprovedVideos`,
`subscribeToPlaySignal`, `writeNowPlaying`, watch sessions).

**Parent app (`apps/KideosParent`)** — `App.tsx` (routing), `hooks/useAuth.ts`, `store/useStore.ts`
(Zustand; `useSelectedChild()` is a hook), `components/FiltersForm.tsx` (questionnaire), `prefs.ts` (copy),
components: `ChannelReview` (the "Before you add it" sheet), `VideoPreview` (tap a thumbnail to play);
screens: `auth/AuthScreen`, `onboarding/CreateChild · SetFilters · AddChannels` (Check & Add → review),
`main/Home` (now watching, remote control, Hide / Too hyper, link to Videos, pairing), `main/VideosScreen`
(Shown / Hidden + reasons, details with watch, Hide, Too hyper, Show anyway),
`main/SuggestionsScreen` (suggested-channel cards: swipe left "Not for us", swipe right "maybe later",
tap "Add to {child}'s feed"), `main/Channels`, `main/Digest`, `main/Settings` (children, questionnaire, viewing rules, data deletion, sign out). `services/firebase.ts`: auth (`signInWithGoogle`, `signOut` also
signs out of Google), children, `saveValueFilters` / `getValueFilters` (raw → `normalizePrefs`), channels
(`checkChannel` → review, `addChannel` → `resolveAndAddChannel`, `removeChannel`), `subscribeToVerdicts`,
`setShowAnyway`, `hideVideo` / `hideVideos`, `reportTooHyper`, `getVideoSummary`,
`getChannelSuggestions`, `dismissSuggestion`, `parseCustomRules`, `claimPairingCode`, `sendPlaySignal`,
subscriptions,
`callFunction` helper for callables.

## Cost controls

**Principle: pay for AI once, then decide in code.** Video profiles, channel checks and channel catalog
entries are made once and shared by every family; whether something fits a child is always code. AI only
runs again when `PROFILE_VERSION` / `CHECK_VERSION` / `OVERVIEW_VERSION` is bumped.

- **Supadata (paid per request):** transcript fetched at most once per video ever (`transcriptCache`,
  including confirmed "none"); YouTube details checked first so removed/private/embed-blocked videos never
  cost a transcript; requests start ≥1.1s apart, no retries; profile regeneration reuses cached transcripts.
- **OpenAI:** one profile call per video (shared by all families) — transcript + 4 low-detail images ≈ 15k
  input tokens ≈ $0.002–0.003 (GPT-4o-mini bills each low-detail image as ~2,800 tokens); image moderation
  is free; religion/custom-rule checks run on the short summary, only for videos that otherwise pass, cached
  per rule set; filter changes cost nothing.
- **Gemini (channel check):** once per channel, ever (until `CHECK_VERSION` changes): measured ~16k input +
  ~1k output tokens at low media resolution (≈ 0.5–0.7¢; default resolution measured 57.7k) plus one
  grounded Google Search (billed separately by Google — check Cloud billing). Watching whole videos with
  Gemini was considered and **rejected on cost** (~2¢ per 10-min video, ~$1 per channel); short clips are
  possible later (start/end offsets + fps are controllable, ~0.3¢ for 3×1 min).
- **Suggested channels:** reuse existing profiles; the only AI call is one overview per channel (also gives
  the audience ages), rewritten only when `OVERVIEW_VERSION` changes. Scoring is pure code.
- **YouTube quota:** `channels.list` / `playlistItems.list` / `videos.list` only (1 unit each), never
  `search.list` (100 units). Kids never trigger API calls.
