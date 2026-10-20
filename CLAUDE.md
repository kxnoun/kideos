# Working on Kideos — notes for AI assistants (and humans)

Start with `README.md`, then `docs/architecture.md` (how it works), `docs/development.md` (run, logs,
deploy), `docs/backlog.md` (what's next / known bugs). Keep those docs updated when you change behaviour.

## Rules that have bitten us

- **Propose before building.** Don't start or rewrite a system until Adam explicitly says to build it
  (a question back is not a yes). Give cost numbers before anything that spends money per video/channel.
- **Pay for AI once, reuse in code.** Profiles (`videoProfiles`, `channelChecks`, `channelCatalog`) are made
  once and shared by every family; whether something fits a child is always worked out in code
  (`evaluateProfile`). Re-run AI only by bumping `PROFILE_VERSION` / `CHECK_VERSION`.

- **Never call YouTube `search.list`** (100 units). Only channels/playlistItems/videos.list.
- **`@react-native-firebase/*` is pinned at 22.4.0** — don't upgrade (breaks iOS). In v22,
  `DocumentSnapshot.exists` is a **method**: `snap.exists()` (firebase-admin in `functions/` uses the property).
- **Secrets:** `YOUTUBE_API_KEY`, `SUPADATA_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. A function only
  sees the secrets in its `secrets: [...]` list. After deploying, wait ~1 min before testing (traffic
  switches late).
- **Images only raise ratings.** `applyVisualFloors` (moderation), `swearFloor`, `KNOWN_STIMULATION` and
  "Too hyper" reports are floors — never let a new signal lower an AI rating.
- **`LADDER_GUIDE`** is sliced from the profile prompt between `Ladders (0 = none` and `- framing:` and fed
  to the channel check — keep those markers when editing the prompt.
- **Supadata costs money per request.** Only fetch transcripts through `getTranscriptCached`
  (`functions/src/analyzeVideo.ts`). Never delete `transcriptCache`. Changing the profile prompt → bump
  `PROFILE_VERSION`; `reprofileOutdated` upgrades old profiles nightly from cached transcripts
  (`cachedTranscriptsOnly` — it must never call Supadata). Don't clear data.
- **`functions/src/prefs.ts` is copied to `apps/KideosParent/src/prefs.ts`** — change both (only the
  header comment differs).
- **Deploying functions needs `npm run build` first** (no predeploy step; otherwise stale `lib/` deploys).
  One function: `firebase deploy --only functions:kideos-backend:<name>` (the codebase is `kideos-backend`).
- **Long work must not run after a callable returns** (Cloud Functions v2 throttles CPU) — use a
  Firestore trigger, like `onChannelWhitelisted`.
- Firestore triggers are at-least-once: dedupe with `triggerEvents/{event.id}` `.create()`.
- Verdicts are **per child** (`videoVerdicts`), `approved` or `hidden` — no approval queue, no push
  notifications (product decision: less work for parents). The parent's `parentDecision` ("Show anyway")
  always wins and must never be overwritten by the pipeline.
- **A suggestion vouches for the channel** (`channelCatalog.ts`): ≥10 checked videos, ≥75% fit, ≤2 severe
  (severe = absolute, not relative to the child), made for the child's age ±1. **Long videos decide**;
  Shorts are a separate line and never count against a channel when the child has "No Shorts".
- **Channels are seeded with 40 long videos + 10 Shorts** from YouTube's undocumented `UULF…` / `UUSH…`
  playlists (fallback: the mixed uploads list). If those ever stop working, seeding silently falls back. Tune with the
  `Not suggested: … —` log lines, not by guessing; a wrong rating is a prompt problem, not a rule problem.
- **Kid devices are bound** (`users/{p}/kidDevices/{uid}.childIds`, `isKid()` in the rules) — anything the kid
  app reads or writes under a child must be allowed by `isKid`. Run `tests/rules/` after rule changes.
- **`apps/Kideos/src/pin.ts` is copied to `apps/KideosParent/src/pin.ts`** — change both (identical).
- **Kid app: every screen `<StatusBar hidden />`** — mixing hidden/visible makes the layout jump sideways.
- **Kid app: never rebuild a screen to show another on top of it** — the feed stays mounted under "See all"
  and under the player; layers over it need explicit `zIndex` + `elevation` (Android otherwise draws the
  feed's chip bar on top). Keep `VideoTile` / `BigHome` / `LittleHome` / `ChipBar` memoised and the shelf
  list in `useMemo` — redrawing every row made taps lag ~1 s on the 6T.
- **Kid app motion goes through `MOTION`** (theme.ts — quick, ease-out only). PanResponder resets `dx/dy` to
  0 at grant: decide a drag's direction in `onMoveShouldSetPanResponder`, not in `onPanResponderGrant`.
- **Kid app state is per child** on a shared device: `@kideos_unfinished:{childId}`, `@kideos_watched:{childId}`,
  `playSignal` per child. "When to ask Who's watching?" (`gate.ts`) is in memory on purpose (a full restart
  must ask). Treat a missing `kidDevices` doc as "unpaired" only when the server confirms it (`fromCache`).
- **Deploy rules + functions together** when they depend on each other (device binding:
  `firebase deploy --only "functions:kideos-backend,firestore:rules"`) before running a new app build.
- **Kid app UI: use `src/theme.ts`** (colours, fonts, `useLayout` sizes, little/big mode) and
  `components/Tap` / `VideoTile` / `BackButton` — no hard-coded colours, `Dimensions.get` (except the one
  rotation check in App.tsx) or `TouchableOpacity`. Never white
  text on Sunset Orange (use Ink). Design rules: docs/kid-app-design.md.
- **The kid app patches two libraries** (`apps/Kideos/patches/`, applied by `patch-package` on
  `npm install`): `react-native-webview` (scripts in YouTube's iframe on Android; fullscreen → landscape)
  and `react-native-youtube-iframe` (play/pause injected directly — remote pause). Upgrading either
  library means re-making the patch, or the player silently loses those features.
- **YouTube API policy wording** (backlog → 2b): verdicts are about the parent's settings ("Matches / Doesn't
  match Simon's settings"), never "safe / suitable / recommended"; no scores, percentages, counts-as-scores or
  AI-estimated audience ages / topic labels on screen; put `components/KideosNotes` ("not from YouTube")
  under any Kideos analysis. Stored YouTube data must be refreshed within 30 days — `refreshYouTubeData`
  covers the collections that exist; a new place that stores titles / thumbnails / channel names must be
  added to it.
- **The kid player page is ours** (`hosting/player/index.html`, Firebase Hosting, `baseUrlOverride`) — keep
  its `?data=` contract and events identical to react-native-youtube-iframe's page; deploy hosting first.
- The kid player hides parts of YouTube's player — against YouTube's terms; decided Oct 18 to move to the
  standard player + a grown-up gate before links (backlog → Next up). Don't block or interfere with
  **ads** (ad links stay clickable), and never claim videos are "ad-free" (API policy: no monetization
  estimates).
- **Kid app native code** (`MainActivity.kt`, `KideosWindowModule.kt`, fonts) needs a Gradle rebuild; JS
  changes don't. Judge smoothness on a release build (`gradlew app:installRelease`), not debug.
- Android on Windows: two-terminal build (Metro `--port 8082`/`8083` + `gradlew app:installDebug
  -PreactNativeDevServerPort=…`), never `react-native run-android`. Physical phone needs `adb reverse`.
- App logs are in `adb logcat -s ReactNativeJS`, **not** the Metro terminal (RN ≥ 0.77).
- Git on Windows shows ~26 files modified that are only line-ending noise — stage files explicitly,
  with `git -c core.autocrlf=input add <files>`; don't commit the noise.

## Checks before handing back

- `node node_modules/typescript/bin/tsc --noEmit -p .` in `functions/`, `apps/Kideos`, `apps/KideosParent`.
- For backend logic changes, verify Supadata/OpenAI call counts with a mocked run (see development.md →
  Testing) — cost regressions are the most expensive bugs here.
