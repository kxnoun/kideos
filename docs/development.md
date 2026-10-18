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
| AI profiles / decisions | `… \| Select-String "AI\] Profile"` / `"AI\] Values check"` |
| Why a channel isn't suggested | `firebase functions:log --only getChannelSuggestions \| Select-String "Not suggested"` → fit %, severe videos (title + rating + evidence), or the channel's audience ages |
| Profile upgrades | `firebase functions:log --only reprofileOutdated \| Select-String "upgraded="` → `— done` or `— out of time` (Force run again) |
| Transcripts | `… \| Select-String "Supadata\|transcriptCache"` — `Unexpected status 429` = rate limit **or out of credits** (Supadata uses 429 for both; the log line includes their error message) |
| Save to a file to share | `… \| Out-File something.txt` (UTF-16) |

The "This method is deprecated … namespaced API" warnings are React Native Firebase 22 nagging about the
older API style; harmless (migration is in the backlog).

## Deploy

```powershell
cd functions; npm run build; cd ..        # REQUIRED — firebase.json has no predeploy build step,
                                          # so skipping this deploys stale code from functions/lib
firebase deploy --only functions           # backend (all functions)
firebase deploy --only functions:kideos-backend:getChannelSuggestions   # one function (codebase prefix needed)
firebase deploy --only "firestore:rules,firestore:indexes"   # when rules/indexes change
```
New composite indexes take a few minutes to build; queries that need them fail until then.

Secrets (Firebase Secret Manager): `firebase functions:secrets:set OPENAI_API_KEY` (also `SUPADATA_API_KEY`,
`YOUTUBE_API_KEY`), then redeploy. Check one: `firebase functions:secrets:access OPENAI_API_KEY`.

### After changing the profile prompt
Bump `PROFILE_VERSION` in `functions/src/aiAnalysis.ts` and deploy. `reprofileOutdated` upgrades old
profiles from cached transcripts that night (OpenAI only, ~$0.001/video; never Supadata). To do it now:
Google Cloud console → Cloud Scheduler (console.cloud.google.com/cloudscheduler?project=kideos-io) → the
`reprofileOutdated` job → ⋮ → **Force run** (repeat if the log
says "out of time"). Changing questionnaire answers
does **not** need this.

### Clearing data for tests
- **Never** delete `transcriptCache` — every transcript would be paid for again.
- Profiles: bump `PROFILE_VERSION` instead of deleting `videoProfiles`.
- `videoAnalysisCache` is legacy and can be deleted: `firebase firestore:delete videoAnalysisCache --recursive`.

## Firebase Console checklist (project `kideos-io`)

- Authentication → Sign-in method: **Anonymous** (kid app — without it the kid feed is empty and logcat
  shows `auth/admin-restricted-operation`), **Google**, **Apple**, **Email/Password**.
- Android app `com.kideos.parent`: SHA-1 of `apps/KideosParent/android/app/debug.keystore` registered
  (debug builds use the project keystore, not `~/.android`).
- Secrets set for YouTube, Supadata, OpenAI. Supadata is on the Pro plan (3,000 credits/month,
  10 req/s) — keep auto-recharge **off**. OpenAI needs prepaid credits (429 "no credits remaining" otherwise).

## Costs (rough)

Per new video: 1 YouTube unit (free quota), 1 Supadata credit, ~4k GPT-4o-mini tokens (~$0.0006).
A new 50-video channel ≈ 50 credits + ~3¢. Re-adding channels, other families, filter changes: free.

## Testing

- **Type-check all three packages** (the main safety net):
  `node node_modules/typescript/bin/tsc --noEmit -p .` in `functions/`, `apps/Kideos`, `apps/KideosParent`.
  Known pre-existing error: `apps/Kideos/src/screens/PlayerScreen.tsx(111)` implicit `any`.
- The backend logic was verified with throwaway mock harnesses (fake Firestore / Supadata / OpenAI
  counting every call). They aren't in the repo yet — adding a real test suite is in the backlog.
- **Firestore rules:** `tests/rules/` — real emulator tests (paired vs unpaired devices, Show anyway,
  pairing). ⚠️ They describe the device-binding rules, which were reverted — the binding cases fail
  until binding returns. Run on your machine (needs Java 21: in PowerShell first
  `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"`):
  `cd tests\rules; npm install; cd ..\..; firebase emulators:exec --only firestore --project demo-kideos "node tests/rules/rules.test.mjs"`.
  Run them after any change to `firestore.rules`.
- Manual end-to-end: add a channel → watch `onChannelWhitelisted` logs → kid feed; change an answer in
  Settings → feed updates within seconds; Home → Videos → Hidden shows each video's reason; "Show anyway…"
  → confirm → it appears in the kid feed; Undo puts it back. Suggested channels: use a second test child
  (suggestions skip channels the child already has), check a toddler channel isn't suggested to a teen and
  an edgy channel isn't suggested to a young kid.

## Git

- Branch from `main`; open a PR. The ~26 files Git shows as modified with no real diff are Windows
  line-ending noise — don't commit them (`git diff --ignore-cr-at-eol` shows real changes).
- Don't put tokens in the remote URL; use the plain `https://github.com/kxnoun/kideos.git` and let Git
  Credential Manager handle sign-in.
