# Architecture

How Kideos works end to end. For running/deploying see [development.md](development.md); for *why* the
questionnaire and profiles look this way see [questionnaire-research.md](questionnaire-research.md).

```
 ┌──────────────────────┐   writes answers, channels,     ┌───────────────────────────────┐
 │  Kideos for Parents  │   review decisions, commands    │           Firestore            │
 │  (KideosParent)      │ ──────────────────────────────► │  users/{parent}/children/{kid} │
 │                      │ ◄────────────────────────────── │  videoProfiles, transcripts…   │
 └──────────────────────┘   review queue, now watching    └──────┬─────────────▲──────────┘
            │ callable functions                                  │ triggers    │ writes verdicts,
            ▼                                                     ▼             │ profiles, queue
 ┌───────────────────────────────────────────────────────────────────────────────┴──────────┐
 │  Cloud Functions (us-central1)                                                            │
 │  resolveAndAddChannel → [whitelist doc created] → onChannelWhitelisted → per-video pipeline│
 │  [answers saved] → onFiltersChanged → re-apply      parseCustomRules · suggestChannels …  │
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
   Filter-independent. Versioned (`PROFILE_VERSION` in `aiAnalysis.ts`): bump it and profiles regenerate
   from cached transcripts on next analysis.
2. **Questionnaire answers** (`users/{p}/children/{c}/valueFilters/current`) — per child, see
   [the questionnaire](#the-questionnaire).
3. **Verdict** (`users/{p}/children/{c}/videoVerdicts/{videoId}`) — answers applied to the profile **in
   plain code** (`contentFilter.ts`): `approved` | `hidden` | `pending_review`. The kid feed shows only
   `approved == true`.

Changing answers only re-runs step 3 → instant, no Supadata, no profile AI calls.

## The questionnaire

Defined in `functions/src/prefs.ts` (copied to `apps/KideosParent/src/prefs.ts` — **keep in sync**), UI in
`apps/KideosParent/src/components/FiltersForm.tsx` (used by onboarding and Settings).

- **About the child:** age (drives defaults), sensitivity to scary content (shifts scary/mature themes ±1).
- **13 core ladders** (0–4, examples on every rung): violence, scary, language, romance, sexual,
  substances, dangerous stunts, self-harm, meanness/pranks, consumerism, politics, religion, gambling.
  Each has `max` (highest allowed level) and `action` for anything above: `hide` or `review` ("Ask me first").
- **Global rules:** educational videos +1 level (violence/scary/substances/politics); always hide
  glamorized violence/substances/self-harm/cruelty; what to do when a video can't be checked
  (`unknown`: allow / review / hide — applies to "no transcript" too).
- **Faith & family values (optional):** "which faith is your family" (only effect: own faith's religious
  content is exempt from the religion ladder), 10 holidays (ok / in passing / ask / hide), and
  ok/ask/hide checks: pork, non-kosher, cooking with alcohol, beef, prophet depictions, God's name as an
  exclamation, fantasy magic, real occult, evolution, videos with music (best effort).
- **More topics (optional):** crude humor, mature themes, misinformation, nudity (best effort) ladders;
  LGBTQ+ (allow / allow presence & ask about discussion / ask about all / hide discussion & advocacy);
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
earlier are denied and never retry) → `PairingScreen` writes `pairingCodes/{code}` (6 chars, no auth needed)
→ parent enters it on Home → `claimPairingCode` writes `{claimed, parentId, childId, childName}` → kid app
sees the update and saves the session in AsyncStorage (`useSession`). To unpair: clear app data
(`adb shell pm clear com.kideos.app`).

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
   - **Write** (one batch): verdict (`approved` honours `parentDecision`, which is never overwritten) +
     review-queue sync (`flaggedContent/{videoId}`; removed when approved; not touched once the parent
     decided). Push notification only for `pending_review` (see backlog: tokens not registered yet).

### Changing answers
`saveValueFilters` overwrites `valueFilters/current` → **`onFiltersChanged`** (skips no-op writes, deduped)
→ `reapplyFiltersForChild`: for every `ready` channel, every video with a current-version profile →
`decideForChild` → verdict + queue updates in batches, `videoCount` per channel. Videos without a
current profile are left as they are (re-add the channel to re-profile). No notifications on re-apply.

### Review queue ("Ask me first")
Home shows `flaggedContent` (pending first). **Approve / Keep hidden / Allow anyway** call
`resolveReview`: one batch sets `videoVerdicts/{v}.{parentDecision, approved}` (rules only allow those two
fields, and `approved` must equal `parentDecision == "approved"`) and marks the queue entry
`{parentViewed, resolution}`. Older flags (before the queue) only have "Mark as reviewed".

### Watching + remote control
Kid feed: `subscribeToApprovedVideos` (child's verdicts, `approved == true`, newest first, filtered to
currently whitelisted channels; channel names filled from the whitelist). Player
(`react-native-youtube-iframe`) writes `currentSession/nowPlaying` and a `watchHistory` session
(`expiresAt` +90 days). Parent pause/stop → `currentSession/parentCommand` → **`handleParentCommand`** relays
to `currentSession/playSignal` → kid app listener.

### Nightly / weekly jobs
- **`refreshChannelLibraries`** (03:00 UTC): new uploads per whitelisted channel → stubs → analyzed for each
  child who has the channel (profiles shared). ⚠️ Broken pacing — see backlog.
- **`cleanupExpiredData`** (02:00 UTC): deletes `watchHistory` past `expiresAt` (COPPA 90 days) + legacy
  analysis-cache entries.
- **`generateWeeklyDigest`** (Mon 08:00 UTC, Premium): GPT summary of the week. ⚠️ Path mismatch — see backlog.
- **`weeklyChannelSuggestions`** (Mon 10:00 UTC): AI channel picks per child.

### COPPA deletion
Settings → delete child data → callable **`deleteChildData`**: hard-deletes the child's subcollections
(watch history, flagged, suggestions, whitelist, verdicts, digests, session, filters, profile) and the
child doc.

## Firestore data model

| Path | Contents | Written by | Read by |
|---|---|---|---|
| `users/{p}` | parent profile (email, createdAt) | parent app | parent |
| `users/{p}/devices/primary` | FCM token (`fcmToken`) | *nothing yet — see backlog* | functions |
| `users/{p}/children/{c}` | child profile (name, age, avatar, mode) | parent app | parent, kid |
| `…/children/{c}/valueFilters/current` | questionnaire answers (`version: 2`, see `prefs.ts`) | parent app | functions, kid |
| `…/children/{c}/whitelistedChannels/{ch}` | name, thumbnail, `seedingStatus` pending/ready/error, `videoCount` | functions (create), parent (delete) | parent, kid |
| `…/children/{c}/videoVerdicts/{v}` | `approved`, `status`, `reason`, `flags`, `severity`, title/thumbnail/publishedAt, `parentDecision?` | functions; parent may set `parentDecision`+`approved` only | kid feed, parent |
| `…/children/{c}/flaggedContent/{v}` | review queue: title, channel, reason, flags, severity, `status`, `parentViewed?`, `resolution?` (old entries: auto IDs, no status) | functions; parent may set `parentViewed`/`resolution` | parent |
| `…/children/{c}/watchHistory/{id}` | video, start/end, duration, `expiresAt` | kid app | parent, digest |
| `…/children/{c}/currentSession/nowPlaying·parentCommand·playSignal` | live session + remote control | kid / parent / function | both |
| `…/children/{c}/suggestions/{id}` | AI channel suggestions + `parentResponse` | functions | parent |
| `…/children/{c}/digests/{week}` | weekly digest | functions | *(parent reads the wrong path — backlog)* |
| `pairingCodes/{code}` | pairing handshake | kid (create), parent (claim) | both |
| `channelLibraryCache/{ch}` (+ `/videos/{v}`) | shared channel metadata + video stubs (`approved` field is legacy) | functions | kid (metadata), functions |
| `videoProfiles/{v}` (+ `/valuesChecks/{hash}`) | content profiles, values-check cache | functions | functions only |
| `transcriptCache/{v}` | transcript text, or `{available: false}` when confirmed none | functions | functions only |
| `triggerEvents/{eventId}` | dedupe markers for at-least-once triggers | functions | functions only |
| `videoAnalysisCache/…` | **legacy** (pre-profile verdict cache), unused — safe to delete | — | — |

Rules: `firestore.rules`. Kid app = any signed-in (anonymous) user may read a child's filters, whitelist,
verdicts, session; server-only collections are default-deny. Indexes: `firestore.indexes.json` (notably
`videoVerdicts: approved ASC, publishedAt DESC` for the kid feed).

## Backend (`functions/src`)

| File | What's in it |
|---|---|
| `index.ts` | Exports every deployed function |
| `config.ts` | Secrets (`YOUTUBE_API_KEY`, `SUPADATA_API_KEY`, `OPENAI_API_KEY`) + `APP_CONFIG` (model, region, 50 videos/channel) |
| `seedChannelLibrary.ts` | `resolveAndAddChannel`, `onChannelWhitelisted`, `onFiltersChanged`, `refreshChannelLibraries`, `seedChannelLibrary` (legacy callable, unused by the app); internal `seedVideoMetadata`, `batchAnalyzeChannel`, `seedAndAnalyzeInBackground` |
| `analyzeVideo.ts` | Per-video pipeline: `analyzeAndTagVideo`, `reapplyFiltersForChild`, `loadValueFiltersForChild`; internal `getOrCreateProfile`, `decideForChild`, `writeVerdict`, `syncReviewQueue`, `getTranscriptCached`, `notifyParent` |
| `aiAnalysis.ts` | `generateContentProfile` (profile prompt + validation), `swearFloor` and regexes (code-counted swearing, God's-name exclamations, `[Music]`), `checkValuesRules`, `needsValuesCheck`, `hashValuesRules`, `PROFILE_VERSION` |
| `contentFilter.ts` | `evaluateProfile(profile, answers, valuesViolation?)` → status/reason/flags/severity — the whole matching logic, pure code |
| `prefs.ts` | Questionnaire: `DIMS`, `LEVEL_LABELS`, `HOLIDAYS`, `VALUE_FLAGS`, `AGE_TABLE`, `defaultPrefs`, `normalizePrefs`, `describePrefs` |
| `customRules.ts` | `parseCustomRules` callable (free text → whitelisted setting changes) |
| `supadata.ts` | `fetchTranscript` — one queued request (≈1/sec), `text=true&lang=en`, no retries; marks "no transcript" as `definitive` |
| `youtube.ts` | `parseChannelInput`, `getChannelDetails`, `getChannelVideos`, `getVideoDetails`, `verifyChannelHandles` — never `search.list` |
| `suggestChannels.ts` | `suggestChannels` callable + `weeklyChannelSuggestions` |
| `scheduledJobs.ts` | `cleanupExpiredData`, `generateWeeklyDigest`, `handleParentCommand`, `deleteChildData` |
| `types.ts` | Firestore types (`ContentProfile`, `VideoVerdict`, `FlaggedContent`, …) |

## Apps

**Kid app (`apps/Kideos`)** — `App.tsx` (anonymous auth gate → Pairing / Feed / Player),
`hooks/useSession.ts` (paired session in AsyncStorage), `screens/PairingScreen.tsx`,
`screens/FeedScreen.tsx` (grid, channel names, remote stop), `screens/PlayerScreen.tsx`,
`services/firebase.ts` (`subscribeToWhitelistedChannels`, `subscribeToApprovedVideos`,
`subscribeToPlaySignal`, `writeNowPlaying`, watch sessions).

**Parent app (`apps/KideosParent`)** — `App.tsx` (routing), `hooks/useAuth.ts`, `store/useStore.ts`
(Zustand; `useSelectedChild()` is a hook), `components/FiltersForm.tsx` (questionnaire), `prefs.ts` (copy),
screens: `auth/AuthScreen`, `onboarding/CreateChild · SetFilters · AddChannels`, `main/Home` (now watching,
remote control, review queue, pairing), `main/Channels`, `main/Digest`, `main/Settings` (children,
questionnaire, data deletion, sign out). `services/firebase.ts`: auth (`signInWithGoogle`, `signOut` also
signs out of Google), children, `saveValueFilters` / `getValueFilters` (raw → `normalizePrefs`), channels
(`addChannel` → `resolveAndAddChannel`, `removeChannel`), `resolveReview`, `parseCustomRules`,
`claimPairingCode`, `sendPlaySignal`, subscriptions, `callFunction` helper for callables.

## Cost controls

- **Supadata (paid per request):** transcript fetched at most once per video ever (`transcriptCache`,
  including confirmed "none"); YouTube details checked first so removed/private videos never cost a
  transcript; one request at a time, no retries; profile regeneration reuses cached transcripts.
- **OpenAI:** one profile call per video (shared by all families); religion/custom-rule checks run on the
  short summary, only for videos that otherwise pass, cached per rule set; filter changes cost nothing.
- **YouTube quota:** `channels.list` / `playlistItems.list` / `videos.list` only (1 unit each), never
  `search.list` (100 units). Kids never trigger API calls.
