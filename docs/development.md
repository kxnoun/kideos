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
- After an edit that adds/removes hooks or state, fully restart the app ("Should have a queue" = hot reload
  confusion, not a bug).
- Reset the kid app's pairing: `adb shell pm clear com.kideos.app`, then pair again from the parent app
  (a device only gets access to a child through pairing — see `kidDeviceUids`).

## Logs

| What | How |
|---|---|
| App JS logs (both apps) | `adb logcat -s ReactNativeJS \| Select-String -NotMatch "deprecated"` — since RN 0.77 logs are **not** in the Metro terminal. Or `j` in Metro → DevTools. |
| Backend | `firebase functions:log --only <functionName> -n 50` (times are UTC — Toronto is UTC−4 in summer) |
| Analysis progress | `firebase functions:log --only onChannelWhitelisted -n 20` → `Progress: X/50`, then `Done: … approved=X blocked=Y` |
| AI profiles / decisions | `… \| Select-String "AI\] Profile"` / `"AI\] Values check"` |
| Transcripts | `… \| Select-String "Supadata\|transcriptCache"` — `Unexpected status 429` = rate limit **or out of credits** (Supadata uses 429 for both; the log line includes their error message) |
| Save to a file to share | `… \| Out-File something.txt` (UTF-16) |

The "This method is deprecated … namespaced API" warnings are React Native Firebase 22 nagging about the
older API style; harmless (migration is in the backlog).

## Deploy

```powershell
cd functions; npm run build; cd ..        # REQUIRED — firebase.json has no predeploy build step,
                                          # so skipping this deploys stale code from functions/lib
firebase deploy --only functions           # backend
firebase deploy --only "firestore:rules,firestore:indexes"   # when rules/indexes change
```
New composite indexes take a few minutes to build; queries that need them fail until then.

Secrets (Firebase Secret Manager): `firebase functions:secrets:set OPENAI_API_KEY` (also `SUPADATA_API_KEY`,
`YOUTUBE_API_KEY`), then redeploy. Check one: `firebase functions:secrets:access OPENAI_API_KEY`.

### After changing the profile prompt
Bump `PROFILE_VERSION` in `functions/src/aiAnalysis.ts`, deploy, then remove + re-add channels. Profiles
regenerate from cached transcripts (OpenAI cost only, ~$0.0006/video). Changing questionnaire answers
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
  pairing). Run on your machine (needs Java):
  `cd tests\rules; npm install; cd ..\..; firebase emulators:exec --only firestore --project demo-kideos "node tests/rules/rules.test.mjs"`.
  Run them after any change to `firestore.rules`.
- Manual end-to-end: add a channel → watch `onChannelWhitelisted` logs → kid feed; change an answer in
  Settings → feed updates within seconds; Home → Videos → Hidden shows each video's reason; "Show anyway…"
  → confirm → it appears in the kid feed; Undo puts it back.

## Git

- Branch from `main`; open a PR. The ~26 files Git shows as modified with no real diff are Windows
  line-ending noise — don't commit them (`git diff --ignore-cr-at-eol` shows real changes).
- Don't put tokens in the remote URL; use the plain `https://github.com/kxnoun/kideos.git` and let Git
  Credential Manager handle sign-in.
