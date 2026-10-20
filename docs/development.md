# Development

Day-to-day running, debugging, deploying and testing. First-time setup: [android-setup.md](android-setup.md),
[ios-setup.md](ios-setup.md). How things work: [architecture.md](architecture.md).

## Run the apps (Android, Windows)

Two terminals per app. **Don't use `npx react-native run-android`** on Windows.

| | Kideos (kid) | KideosParent |
|---|---|---|
| Terminal 1 (app folder) | `npx react-native start --port 8082` | `npx react-native start --port 8083` |
| Terminal 2 (`android/`) | `.\gradlew app:installDebug -PreactNativeDevServerPort=8082` | `.\gradlew app:installDebug -PreactNativeDevServerPort=8083` |
| Physical phone over USB | `adb reverse tcp:8082 tcp:8082` | `adb reverse tcp:8083 tcp:8083` |

- `adb` lives at `"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`. Re-run `adb reverse` after every
  reconnect, or the app shows "Unable to load script".
- JS-only changes: Metro reloads, or press `r`. Only rebuild with Gradle after native/dependency changes.
- Fonts (kid app: Fredoka + Nunito in `apps/Kideos/assets/fonts`) are native assets: Android reads them from
  `android/app/src/main/assets/fonts` (rebuild with Gradle after adding one); iOS needs
  `npx react-native-asset` once on a Mac. Name font files by their PostScript name.
- The kid app patches two libraries (`apps/Kideos/patches/`, applied by `patch-package` on every
  `npm install`): `react-native-webview` (native — rebuild the kid app after it changes) and
  `react-native-youtube-iframe` (JS — restart Metro with `--reset-cache` after it changes).
- Testing remote control with one phone: run the parent app on an emulator (`gradlew app:assembleDebug`,
  then `adb -s emulator-5554 install -r app\build\outputs\apk\debug\app-debug.apk`) and `adb reverse` each
  device to its own Metro port.
- After an edit that adds/removes hooks or state, fully restart the app ("Should have a queue" = hot reload
  confusion, not a bug).
- Reset the kid app's pairing: `adb shell pm clear com.kideos.app`, then pair again from the parent app
  (this also unpairs it).

## Logs

| What | How |
|---|---|
| App JS logs (both apps) | `adb logcat -s ReactNativeJS \| Select-String -NotMatch "deprecated"` — since RN 0.77 logs are **not** in the Metro terminal. Or `j` in Metro → DevTools. |
| Backend | `firebase functions:log --only <functionName> -n 50` (times are UTC — Toronto is UTC−4 in summer) |
| Analysis progress | `firebase functions:log --only onChannelWhitelisted -n 20` → `Progress: X/50`, then `Done: … approved=X blocked=Y` |
| AI profiles / decisions | `… \| Select-String "AI\] Profile"` / `"AI\] Values check"` — each profile line lists every level plus `basis=` (transcript / metadata), `short=`, `visual=sex 0.xx viol 0.xx (N imgs)`, `pace={wordsPerMinute, soundTagsPerMinute, repetition}`, `mfk=` |
| Image check | `… \| Select-String "visualCheck"` → `raised sexual=3 nudity=3` when moderation scores pushed a rating up; `not checked` = an image didn't load |
| Images failing | `"retrying text-only"` = one of the 4 images didn't load in time for OpenAI (the profile is still made, without images) |
| Channel checks | `firebase functions:log --only checkChannel \| Select-String "\[checkChannel\]"` → per channel: verdict, `wellKnown`, thumbnails checked, every non-zero level, and `Gemini tokens in=… out=…` (the real cost); `Cached:` = the shared report was reused (no AI) |
| "Too hyper" reports | `firebase functions:log --only onPaceReport` → `N "too hyper" report(s)` per video |
| Why a channel isn't suggested | `firebase functions:log --only getChannelSuggestions \| Select-String "Not suggested"` → fit % of long videos + the top hidden reasons, severe videos (title + rating + evidence), the channel's audience ages, or `channel check: not a fit (…)` |
| Seeding / Load more | `… --only onChannelWhitelisted \| Select-String "seedVideoMetadata"` → `N long videos + M Shorts` (or "using the mixed uploads list"); `… --only onMoreVideosRequested` → `N more long videos, M fit`; nightly top-up: `… --only refreshChannelLibraries \| Select-String "top-up"` |
| Profile upgrades | `firebase functions:log --only reprofileOutdated \| Select-String "upgraded="` → `— done` or `— out of time` (Force run again) |
| Transcripts | `… \| Select-String "Supadata\|transcriptCache"` — `Unexpected status 429` = rate limit **or out of credits** (Supadata uses 429 for both; the log line includes their error message) |
| Save to a file to share | `… \| Out-File something.txt` (UTF-16) |

The "This method is deprecated … namespaced API" warnings are React Native Firebase 22 nagging about the
older API style; harmless (migration is in the backlog).

## Deploy

```powershell
cd functions; npm run build; cd ..        # REQUIRED — firebase.json has no predeploy build step,
                                          # so skipping this deploys stale code from functions/lib
firebase deploy --only "functions:kideos-backend"   # backend (all functions)
firebase deploy --only functions:kideos-backend:getChannelSuggestions   # one function (codebase prefix needed)
firebase deploy --only "firestore:rules,firestore:indexes"   # when rules/indexes change
```
New composite indexes take a few minutes to build; queries that need them fail until then.

**Wait ~1 minute after "Deploy complete" before testing.** Google switches traffic to the new version a
little after the CLI finishes — a test right away can still hit the old code (seen Oct 19: a check said
`Cached:` 20 s before the new revision went live). Cloud Scheduler's "last updated" date is the
schedule's, not the code's — a deploy doesn't change it.

Secrets (Firebase Secret Manager): `OPENAI_API_KEY`, `SUPADATA_API_KEY`, `YOUTUBE_API_KEY`,
`GEMINI_API_KEY`. Set with `firebase functions:secrets:set <NAME>` (paste at the masked prompt — nothing
shows, that's normal), then redeploy. Check one without printing it:
`$k = firebase functions:secrets:access GEMINI_API_KEY; $k.Length; $k.Substring(0,4)` (Gemini keys: 39
characters, start with `AIza`). `firebase functions:secrets:get <NAME>` lists versions. A function only sees
the secrets listed in its `secrets: [...]`.

### Gemini key (channel check)
1. aistudio.google.com → **Get API key** → **Create API key** → pick the project whose ID is `kideos-io`
   (project number 530175410554 — there are several "Kideos" projects).
2. Set up billing on it (same billing account as Firebase) — the free tier is small.
3. `firebase functions:secrets:set GEMINI_API_KEY`, then deploy.
4. Check the model exists:
   `(Invoke-RestMethod "https://generativelanguage.googleapis.com/v1beta/models?key=$k").models.name | Select-String "flash-lite"`
   — the code uses `GEMINI_MODEL` in `channelCheck.ts` (`gemini-3.5-flash-lite`); an `HTTP 404` in the
   `checkChannel` log means the name changed.

### After changing the profile prompt
Bump `PROFILE_VERSION` in `functions/src/aiAnalysis.ts` and deploy. `reprofileOutdated` upgrades old
profiles from cached transcripts that night (OpenAI only, ~$0.002–0.003/video with the 4 images; never
Supadata). To do it now:
Google Cloud console → Cloud Scheduler (console.cloud.google.com/cloudscheduler?project=kideos-io) → the
`reprofileOutdated` job → ⋮ → **Force run** (repeat if the log
says "out of time"). Changing questionnaire answers
does **not** need this.

### After changing the channel check
Bump `CHECK_VERSION` in `functions/src/channelCheck.ts` (new rating dimension, prompt change). Saved
channel reports are then re-made **the next time a parent checks that channel** (one Gemini call each) —
there's no batch job. Floors from analyzed videos and per-child fit are computed on every check, so
changing those doesn't need a bump.

### Clearing data for tests
- **Never** delete `transcriptCache` — every transcript would be paid for again.
- Profiles: bump `PROFILE_VERSION` instead of deleting `videoProfiles`.
- `videoAnalysisCache` is legacy and can be deleted: `firebase firestore:delete videoAnalysisCache --recursive`.

## Firebase Console checklist (project `kideos-io`)

- Authentication → Sign-in method: **Anonymous** (kid app — without it the kid feed is empty and logcat
  shows `auth/admin-restricted-operation`), **Google**, **Apple**, **Email/Password**.
- Android app `com.kideos.parent`: SHA-1 of `apps/KideosParent/android/app/debug.keystore` registered
  (debug builds use the project keystore, not `~/.android`).
- Secrets set for YouTube, Supadata, OpenAI, Gemini. Supadata is on the Pro plan (3,000 credits/month,
  10 req/s) — keep auto-recharge **off**. OpenAI needs prepaid credits (429 "no credits remaining"
  otherwise). Gemini needs billing on the `kideos-io` key (Google AI Studio).

## Costs (rough)

Per new video: 1 YouTube unit (free quota), 1 Supadata credit, one GPT-4o-mini call with transcript + 4
low-detail images (~15k input tokens ≈ $0.002–0.003), free image moderation, one HEAD request for the
Shorts check. A new channel (40 long videos + 10 Shorts) ≈ 50 credits + ~10–15¢; "Load more videos" ≈ 20
credits + ~5¢ per tap, only for videos nobody analyzed before (limited: < 20 shown, once per channel per
day, 10 per family per day); the one-time nightly top-up of older channels ≈ up
to 40 credits per channel. Plus, the first time anyone checks a channel:
one Gemini Flash-Lite call (measured ~16k in / ~1k out ≈ 0.5–0.7¢) + one grounded Google Search.
Re-adding channels, other families, filter changes, repeat channel checks: free. A `PROFILE_VERSION` bump
re-rates every profiled video once (OpenAI only).

## Testing

- **Type-check all three packages** (the main safety net):
  `node node_modules/typescript/bin/tsc --noEmit -p .` in `functions/`, `apps/Kideos`, `apps/KideosParent`.
- The backend logic was verified with throwaway mock harnesses (fake Firestore / Supadata / OpenAI
  counting every call). They aren't in the repo yet — adding a real test suite is in the backlog.
- **Firestore rules:** `tests/rules/` — real emulator tests (paired vs unpaired devices, siblings a device
  isn't paired to, Show anyway, pairing, moving old devices over). Run on your machine (needs Java 21: in PowerShell first
  `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"`):
  `cd tests\rules; npm install; cd ..\..; firebase emulators:exec --only firestore --project demo-kideos "node tests/rules/rules.test.mjs"`.
  Run them after any change to `firestore.rules`.
- Manual end-to-end: add a channel → watch `onChannelWhitelisted` logs → kid feed; change an answer in
  Settings → feed updates within seconds; Home → Videos → Hidden shows each video's reason; "Show anyway…"
  → confirm → it appears in the kid feed; Undo puts it back. Suggested channels: use a second test child
  (suggestions skip channels the child already has), check a toddler channel isn't suggested to a teen and
  an edgy channel isn't suggested to a young kid.
- **Channel check** (6-year-old test child, Check & Add): Cougar MacDowall → ⛔ (sexual thumbnails);
  Ms Rachel / SciShow Kids → ✅; Mark Rober / SmarterEveryDay → ✅ or calm yellow (sponsors); IShowSpeed →
  ⛔. Hard cases worth re-running after prompt changes: Happy Tree Friends (cute + gore), GLITCH (Amazing
  Digital Circus / Murder Drones), a small Gacha Life storytelling channel, Poppy Playtime fan animations,
  Skibidi Toilet, Markiplier (swearing not visible in thumbnails). Same channel on an older child should
  give a different badge from the same saved report (log: `Cached:`).
- **Minimum watch time:** Settings → child → Viewing → 30 s. Kid phone: open a video, tap Back right away
  → "Watch a little more! 0:2x left"; Android back → same; pause for 30 s → Back works (pauses count);
  drag to the end early → "Nice try 😄" and it jumps back; close the app at 10 s and reopen → the same video
  reopens; parent Home → Hide this video → it closes. "Whole" → Back says "Finish this one first!" until
  ~90% has played. Off → Back works at once.
- **Pace / junk / images:** CoComelon on a ≤6 child → mostly Hidden ("High energy — your limit: Lively");
  Ms Rachel → Shown (stimulation 1–2); a video's details show "· Made for kids"; no-caption videos show
  the "No captions — rated from…" line; "Too hyper" moves a video to Hidden and adds a
  `videoProfiles/{v}/paceReports/{you}` doc + `tooHyperReports`.

## Git

- Branch from `main`; open a PR. The ~26 files Git shows as modified with no real diff are Windows
  line-ending noise — don't commit them (`git diff --ignore-cr-at-eol` shows real changes).
- Don't put tokens in the remote URL; use the plain `https://github.com/kxnoun/kideos.git` and let Git
  Credential Manager handle sign-in.
