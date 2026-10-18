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
 │  resolveAndAddChannel → [whitelist doc created] → onChannelWhitelisted → per-video pipeline│
 │  [answers saved] → onFiltersChanged → re-apply   getChannelSuggestions · parseCustomRules │
 └──────┬────────────────────┬─────────────────────┬────────────────────────────────────────┘
        ▼                    ▼                     ▼
   YouTube Data API     Supadata (transcripts)   OpenAI GPT-4o-mini
                                                                    ┌────────────────────┐
                    reads approved verdicts, playSignal;            │  Kideos (kid app)  │
                    writes nowPlaying, watchHistory  ◄────────────► │  anonymous auth    │
                                                                    └────────────────────┘
```

## Core idea: profile once, filter per child

1. **Content profile** (`videoProfiles/{videoId}`) — what a video contains, on fixed scales. Generated
   **once per video** by GPT-4o-mini from the transcript + metadata and **shared by every family**.
   Filter-independent. Versioned (`PROFILE_VERSION` in `aiAnalysis.ts`, now 4): bump it and the nightly
   **`reprofileOutdated`** regenerates old profiles from cached transcripts (never Supadata), rebuilds the
   catalog and re-applies filters. Profiles ≥ `MIN_USABLE_PROFILE_VERSION` keep working meanwhile.
2. **Questionnaire answers** (`users/{p}/children/{c}/valueFilters/current`) — per child, see
   [the questionnaire](#the-questionnaire).
3. **Verdict** (`users/{p}/children/{c}/videoVerdicts/{videoId}`) — answers applied to the profile **in
   plain code** (`contentFilter.ts`): `approved` or `hidden`, with a plain-words reason and the video's
   ratings. The kid feed shows only `approved == true`. There's no approval queue: parents browse
   Shown / Hidden in the **Videos** screen and can "Show anyway" one video.

Changing answers only re-runs step 3 → instant, no Supadata, no profile AI calls.

## The questionnaire

Defined in `functions/src/prefs.ts` (copied to `apps/KideosParent/src/prefs.ts` — **keep in sync**), UI in
`apps/KideosParent/src/components/FiltersForm.tsx` (used by onboarding and Settings).

- **About the child:** age (drives defaults), sensitivity to scary content (shifts scary/mature themes ±1).
- **13 core ladders** (0–4, examples on every rung): violence, scary, language, romance, sexual,
  substances, dangerous stunts, self-harm, meanness/pranks, consumerism, politics, religion, gambling
  (mentioned → discussed → shown → promoted; a ladder since profile v4 — before, any mention counted as
  the top). Each has `max` (highest allowed level); anything above it is hidden.
- **Global rules:** educational videos +1 level (violence/scary/substances/politics); always hide
  glamorized violence/substances/self-harm/cruelty; what to do when a video can't be checked
  (`unknown`: allow / hide — applies to "no transcript" too; default hide).
- **Faith & family values (optional):** "which faith is your family" (only effect: own faith's religious
  content is exempt from the religion ladder), 10 holidays (ok / in passing / hide), and
  ok/hide checks: pork, non-kosher, cooking with alcohol, beef, prophet depictions, God's name as an
  exclamation, fantasy magic, real occult, evolution, videos with music (best effort).
- **More topics (optional):** crude humor, mature themes, misinformation, nudity (best effort) ladders;
  LGBTQ+ (allow / allow presence but hide discussion & advocacy / hide all);
  mature-rated games.
- **Anything else (free text):** "Turn this into settings" → `parseCustomRules` maps it to the settings
  above for the parent to confirm; leftovers stay as `customRules` and are checked per video by AI.
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

### Adding a channel → analysis
1. Parent adds a URL/@handle → callable **`resolveAndAddChannel`**: `channels.list` (1 unit), creates
   `whitelistedChannels/{channelId}` with `seedingStatus: "pending"` ("Analyzing…" in the app), returns.
2. The create fires **`onChannelWhitelisted`** (own invocation, 9 min, full CPU; duplicate deliveries
   deduped via `triggerEvents/{eventId}`): channel metadata → `channelLibraryCache/{channelId}`, 50 latest
   videos as stubs → `channelLibraryCache/{channelId}/videos/{videoId}`, then `batchAnalyzeChannel`
   (5 videos at a time) → `analyzeAndTagVideo` per video → `seedingStatus: "ready"`, `videoCount`.
3. **`analyzeAndTagVideo`** (`analyzeVideo.ts`), per video per child:
   - **Profile** (`getOrCreateProfile`): cache hit → done. Miss → YouTube `videos.list` (missing/private →
     blocked as unavailable, not cached) → transcript via `getTranscriptCached` → `generateContentProfile`
     → saved. Confirmed "no transcript" is saved as a placeholder profile; transient failures (429, AI
     error) save nothing → video hidden as `analysis_pending`, retried next run.
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
Home → "{child}'s videos" → `VideosScreen`: all of the child's verdicts (`subscribeToVerdicts`), split into
**Shown** and **Hidden**. Each card shows the video's ratings as chips; hidden ones show *why* in plain
words, including the parent's limit (e.g. "Moderate swearing (sh\*t ×3) — your limit: Mild swearing").
Nothing needs action — parents look when they want to. **Tap a video** → details sheet (summary, every
rating with its evidence, status, one action). **Hide** on a Shown card, or **Select** → tick several →
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

Remote control: parent → `currentSession/parentCommand` (`pause` / `play` / `stop`) →
**`handleParentCommand`** → `currentSession/playSignal`. The kid player reacts only to commands sent while
the video is open (the first snapshot is the last command, maybe old). `stop` locks the **whole** kid app
on "Time's up" (App.tsx, survives restarts) until the parent sends `play` ("Let them watch again").

Parent Home → "{child}'s Screen": ▶ Now watching / ⏸ Paused, a Pause/Resume toggle, End Session, the
video's summary (2 lines, more/less — read from `videoProfiles`), "✓ Fits all of {child}'s settings" or
"Shown because you allowed it", each rating with its evidence, and **🚩 Hide this video**
(`parentDecision: "hidden"`). When watching is off: "Watching is off" + "Let them watch again".

### Nightly / weekly jobs
- **`refreshChannelLibraries`** (03:00 UTC): new uploads per whitelisted channel → stubs → analyzed for each
  child who has the channel (profiles shared). Channels run back to back (no stagger).
- **`cleanupExpiredData`** (02:00 UTC): deletes `watchHistory` past `expiresAt` (COPPA 90 days) + legacy
  analysis-cache entries.
- **`generateWeeklyDigest`** (Mon 08:00 UTC, Premium): GPT summary of the week. ⚠️ Path mismatch — see backlog.
- **`reprofileOutdated`** (04:00 UTC, or Force run in Cloud Scheduler): profiles older than
  `PROFILE_VERSION` → regenerated from cached transcripts only (never Supadata), catalog entries rebuilt,
  filters re-applied for affected children. Stops before the time limit; the next run continues.
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
Home → "Suggested channels" → `SuggestionsScreen` → callable **`getChannelSuggestions`**: runs
`evaluateProfile` on every catalog video against the child's answers (pure code), skips channels already
in the child's list or dismissed. **A suggestion vouches for the channel, so the bar is higher than for
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
| `users/{p}/children/{c}` | child profile (name, age, avatar, mode) | parent app | parent, signed-in kid devices |
| `…/children/{c}/dismissedSuggestions/{ch}` | "Not for us" on a suggested channel | parent | parent |
| `…/children/{c}/valueFilters/current` | questionnaire answers (`version: 2`, see `prefs.ts`) | parent app | parent, functions |
| `…/children/{c}/whitelistedChannels/{ch}` | name, thumbnail, `seedingStatus` pending/ready/error, `videoCount` | functions (create), parent (delete) | parent, kid |
| `…/children/{c}/videoVerdicts/{v}` | `approved`, `status` (approved/hidden), `reason`, `ratings`, `flags`, `severity`, channel/title/thumbnail/publishedAt, `parentDecision?` | functions; parent may set/clear `parentDecision`+`approved` only | kid feed, Videos screen |
| `…/children/{c}/flaggedContent/{v}` | **legacy** review queue — no longer written or shown | — | — |
| `…/children/{c}/watchHistory/{id}` | video, start/end, duration, `expiresAt` | kid app | parent, digest |
| `…/children/{c}/currentSession/nowPlaying·parentCommand·playSignal` | live session (`nowPlaying.paused`) + remote control (`pause`/`play`/`stop`; last `stop` = kid app locked) | kid / parent / function | both |
| `…/children/{c}/suggestions/{id}` | AI channel suggestions + `parentResponse` | functions | parent |
| `…/children/{c}/digests/{week}` | weekly digest | functions | *(parent reads the wrong path — backlog)* |
| `pairingCodes/{code}` | pairing handshake: `claimed`, `parentId`, `childId` | kid (create), parent (claim) | anyone |
| `channelLibraryCache/{ch}` (+ `/videos/{v}`) | shared channel metadata + video stubs (`approved` field is legacy) | functions | kid (metadata), functions |
| `channelCatalog/{ch}` | shared channel profile for suggestions (compact video profiles, overview, topics) | functions | functions only |
| `videoProfiles/{v}` (+ `/valuesChecks/{hash}`) | content profiles, values-check cache | functions | profiles: signed-in users (public-video analysis only); valuesChecks: functions only |
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
| `config.ts` | Secrets (`YOUTUBE_API_KEY`, `SUPADATA_API_KEY`, `OPENAI_API_KEY`) + `APP_CONFIG` (model, region, 50 videos/channel) |
| `seedChannelLibrary.ts` | `resolveAndAddChannel`, `onChannelWhitelisted`, `onFiltersChanged`, `refreshChannelLibraries`, `seedChannelLibrary` (legacy callable, unused by the app); internal `seedVideoMetadata`, `batchAnalyzeChannel`, `seedAndAnalyzeInBackground` |
| `analyzeVideo.ts` | Per-video pipeline: `analyzeAndTagVideo`, `reapplyFiltersForChild`, `loadValueFiltersForChild`; internal `getOrCreateProfile`, `decideForChild`, `writeVerdict`, `summarizeRatings`, `getTranscriptCached` |
| `aiAnalysis.ts` | `generateContentProfile` (profile prompt + validation), `swearFloor` and regexes (code-counted swearing, God's-name exclamations, `[Music]`), `checkValuesRules`, `needsValuesCheck`, `hashValuesRules`, `PROFILE_VERSION` |
| `contentFilter.ts` | `evaluateProfile(profile, answers, valuesViolation?)` → approved/hidden + plain-words reason (with the parent's limit), flags, severity — the whole matching logic, pure code |
| `prefs.ts` | Questionnaire: `DIMS`, `LEVEL_LABELS`, `HOLIDAYS`, `VALUE_FLAGS`, `AGE_TABLE`, `defaultPrefs`, `normalizePrefs`, `describePrefs` |
| `customRules.ts` | `parseCustomRules` callable (free text → whitelisted setting changes) |
| `supadata.ts` | `fetchTranscript` — one queued request (≈1/sec), `text=true&lang=en`, no retries; marks "no transcript" as `definitive` |
| `youtube.ts` | `parseChannelInput`, `getChannelDetails`, `getChannelVideos`, `getVideoDetails`, `verifyChannelHandles` — never `search.list` |
| `channelCatalog.ts` | Suggested channels: `buildCatalogEntry` (shared channel profile), `scoreChannel`, `getChannelSuggestions` callable |
| `suggestChannels.ts` | `suggestChannels` callable + `weeklyChannelSuggestions` (older AI-from-description suggestions, still shown on the Channels tab) |
| `reprofile.ts` | `reprofileOutdated` (nightly 04:00 UTC, or Force run in Cloud Scheduler): old-version profiles → current, cached transcripts only |
| `scheduledJobs.ts` | `cleanupExpiredData`, `generateWeeklyDigest`, `handleParentCommand`, `deleteChildData` |
| `types.ts` | Firestore types (`ContentProfile`, `VideoVerdict`, `ValueFilters`, …) |

## Apps

**Kid app (`apps/Kideos`)** — `App.tsx` (anonymous auth gate → Pairing / Feed / Player),
`hooks/useSession.ts` (paired session in AsyncStorage), `screens/PairingScreen.tsx`,
`screens/FeedScreen.tsx` (grid, channel names, remote stop), `screens/PlayerScreen.tsx`,
`services/firebase.ts` (`subscribeToWhitelistedChannels`, `subscribeToApprovedVideos`,
`subscribeToPlaySignal`, `writeNowPlaying`, watch sessions).

**Parent app (`apps/KideosParent`)** — `App.tsx` (routing), `hooks/useAuth.ts`, `store/useStore.ts`
(Zustand; `useSelectedChild()` is a hook), `components/FiltersForm.tsx` (questionnaire), `prefs.ts` (copy),
screens: `auth/AuthScreen`, `onboarding/CreateChild · SetFilters · AddChannels`, `main/Home` (now watching,
remote control, link to Videos, pairing), `main/VideosScreen` (Shown / Hidden + reasons, Show anyway),
`main/SuggestionsScreen` (suggested-channel cards: swipe left "Not for us", swipe right "maybe later",
tap "Add to {child}'s feed"), `main/Channels`, `main/Digest`, `main/Settings` (children, questionnaire, data deletion, sign out). `services/firebase.ts`: auth (`signInWithGoogle`, `signOut` also
signs out of Google), children, `saveValueFilters` / `getValueFilters` (raw → `normalizePrefs`), channels
(`addChannel` → `resolveAndAddChannel`, `removeChannel`), `subscribeToVerdicts`, `setShowAnyway`,
`getChannelSuggestions`, `dismissSuggestion`, `parseCustomRules`, `claimPairingCode`, `sendPlaySignal`,
subscriptions,
`callFunction` helper for callables.

## Cost controls

- **Supadata (paid per request):** transcript fetched at most once per video ever (`transcriptCache`,
  including confirmed "none"); YouTube details checked first so removed/private videos never cost a
  transcript; one request at a time, no retries; profile regeneration reuses cached transcripts.
- **OpenAI:** one profile call per video (shared by all families); religion/custom-rule checks run on the
  short summary, only for videos that otherwise pass, cached per rule set; filter changes cost nothing.
- **Suggested channels:** reuse existing profiles; the only AI call is one overview per channel (also gives
  the audience ages), rewritten only when `OVERVIEW_VERSION` changes. Scoring is pure code.
- **YouTube quota:** `channels.list` / `playlistItems.list` / `videos.list` only (1 unit each), never
  `search.list` (100 units). Kids never trigger API calls.
