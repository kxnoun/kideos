# Working on Kideos — notes for AI assistants (and humans)

Start with `README.md`, then `docs/architecture.md` (how it works), `docs/development.md` (run, logs,
deploy), `docs/backlog.md` (what's next / known bugs). Keep those docs updated when you change behaviour.

## Rules that have bitten us

- **Never call YouTube `search.list`** (100 units). Only channels/playlistItems/videos.list.
- **`@react-native-firebase/*` is pinned at 22.4.0** — don't upgrade (breaks iOS). In v22,
  `DocumentSnapshot.exists` is a **method**: `snap.exists()` (firebase-admin in `functions/` uses the property).
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
  (severe = absolute, not relative to the child), made for the child's age ±1. Tune with the
  `Not suggested: … —` log lines, not by guessing; a wrong rating is a prompt problem, not a rule problem.
- Device binding (`kidDeviceUids`) was reverted — kid paths allow any signed-in device for now. Redo it
  carefully (backlog → Security); `tests/rules/` still describes the binding version.
- **The kid app patches two libraries** (`apps/Kideos/patches/`, applied by `patch-package` on
  `npm install`): `react-native-webview` (scripts in YouTube's iframe on Android; fullscreen → landscape)
  and `react-native-youtube-iframe` (play/pause injected directly — remote pause). Upgrading either
  library means re-making the patch, or the player silently loses those features.
- The kid player hides parts of YouTube's player — against YouTube's terms, a deliberate pre-launch
  decision (backlog). Don't block or interfere with **ads** (ad links stay clickable).
- Android on Windows: two-terminal build (Metro `--port 8082`/`8083` + `gradlew app:installDebug
  -PreactNativeDevServerPort=…`), never `react-native run-android`. Physical phone needs `adb reverse`.
- App logs are in `adb logcat -s ReactNativeJS`, **not** the Metro terminal (RN ≥ 0.77).
- Git on Windows shows ~26 files modified that are only line-ending noise — stage files explicitly,
  with `git -c core.autocrlf=input add <files>`; don't commit the noise.

## Checks before handing back

- `node node_modules/typescript/bin/tsc --noEmit -p .` in `functions/`, `apps/Kideos`, `apps/KideosParent`
  (known pre-existing error: `apps/Kideos/src/screens/PlayerScreen.tsx(111)`).
- For backend logic changes, verify Supadata/OpenAI call counts with a mocked run (see development.md →
  Testing) — cost regressions are the most expensive bugs here.
