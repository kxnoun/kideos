# Self-hosting Kideos

Kideos is an open-source project you run yourself: your own Firebase project, your own API keys, your own
builds of the two Android apps. One server can serve just your family, or friends and family too (see
[Invite-only](#invite-only-sharing-one-server)). Nothing is shared between servers.

> **Read this first.** Kideos analyses YouTube videos with AI from their transcripts (fetched through
> Supadata) and stores the results. That goes against YouTube's API policies and terms in several ways —
> derived data, scraped transcripts, aggregation, and the kid player hides parts of YouTube's player (see
> [backlog.md → 2b](backlog.md)). Running it is your own choice and your own risk: the YouTube API key
> that could be switched off is yours. It's meant for your family, not as a public service. Not legal
> advice.

## What you need

- A Google account and a **Firebase project on the Blaze (pay-as-you-go) plan** — Cloud Functions and
  Secret Manager need it. Light family use stays mostly within the free quotas; the AI and transcripts are
  what cost money (see [Costs](#costs)).
- Node.js 22, JDK 17, Android Studio (SDK + platform tools) — [android-setup.md](android-setup.md) has the
  Windows steps.
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`.
- API keys:
  | Key | Used for | Where |
  |---|---|---|
  | `YOUTUBE_API_KEY` | channel and video data (free quota: 10,000 units/day) | Google Cloud console → APIs & Services → enable **YouTube Data API v3** → Credentials → Create API key (same project as Firebase) |
  | `SUPADATA_API_KEY` | video transcripts | supadata.ai — keep auto-recharge off |
  | `OPENAI_API_KEY` | the content profile of each video (GPT-4o-mini) | platform.openai.com — prepaid credits |
  | `GEMINI_API_KEY` | the channel check before adding a channel | aistudio.google.com → Get API key → pick your Firebase project; turn on billing |

## 1. Create the Firebase project

1. [Firebase console](https://console.firebase.google.com) → **Add project** → upgrade to **Blaze**.
2. **Firestore Database** → Create database (production mode; any region — functions run in `us-central1`).
3. **Authentication** → Sign-in method → enable **Anonymous** (the kid app — without it the kid feed stays
   empty), **Email/Password**, and **Google** (optional, needs step 3's SHA-1).
4. **Hosting** → Get started (just click through — the files are deployed from this repo).

## 2. Add the two Android apps

Project settings → Your apps → **Add app → Android**, twice:

| Package name | Download `google-services.json` into |
|---|---|
| `com.kideos.app` (kid app) | `apps/Kideos/android/app/` |
| `com.kideos.parent` (parent app) | `apps/KideosParent/android/app/` |

That file is the only per-server setting the apps need: the project ID (for the functions and the kid
player page) and the Google sign-in client are read from it. It's gitignored — never commit it.

## 3. Google sign-in (optional)

Register the parent app's signing key, then download its `google-services.json` **again** (it only
contains the sign-in client after this):
```powershell
cd apps\KideosParent\android
keytool -list -v -keystore app\debug.keystore -alias androiddebugkey -storepass android -keypass android
```
Copy the SHA-1 → Project settings → `com.kideos.parent` → Add fingerprint. For a release build, add your
release keystore's SHA-1 too. Without Google sign-in, parents use email and password.

## 4. Set the secrets and deploy the backend

```powershell
firebase use --add                 # pick your project
firebase functions:secrets:set YOUTUBE_API_KEY
firebase functions:secrets:set SUPADATA_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
cd functions; npm ci; npm run build; cd ..
firebase deploy --only "firestore,hosting,functions:kideos-backend"
```
(`setup-secrets.sh` does the four `secrets:set` lines on macOS / Linux.) The first deploy takes several
minutes and may ask to enable APIs (Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler,
Secret Manager) — say yes. New Firestore indexes build for a few minutes after it finishes.

Check: open `https://<your-project-id>.web.app/player/` — a black page (not "Page Not Found") means hosting works.

## 5. Build and install the apps

Debug builds with Metro: [android-setup.md](android-setup.md) / [development.md](development.md). For
phones you'll hand to kids, make a **release** build (no Metro needed, much smoother):
1. Create a release keystore (`keytool -genkeypair -v -keystore kideos-release.keystore -alias kideos
   -keyalg RSA -keysize 2048 -validity 10000`), keep it outside the repo, and point
   `android/app/build.gradle`'s `release` signing config at it ([React Native docs → Publishing to Google
   Play Store → Generating an upload key](https://reactnative.dev/docs/signed-apk-android)).
2. `cd apps\Kideos\android; .\gradlew app:assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
   (same for `apps\KideosParent`).
3. Install with `adb install app-release.apk`, or copy the APK to the phone and open it (allow installing
   from that source).

Then: sign up in the parent app → add a child → answer the questionnaire → add channels → on the kid
device, open Kideos and type the pairing code shown there into the parent app.

## Invite-only: sharing one server

By default anyone who has your parent app and can sign in may use your server — and spend your API
credits. To limit it to people you choose, in the Firestore console:

1. Create collection **`instance`**, document **`access`**, field `inviteOnly` (boolean) = `true`.
2. Create collection **`members`** with one document per person, the **document ID being their sign-in
   email in lowercase** (e.g. `sam@example.com`) — no fields needed. **Add yourself first.**

The security rules and every callable function then refuse anyone else; the parent app tells them to ask
you. Kid devices need nothing — they get in through the parent who paired them. Remove someone by deleting
their `members` doc. (Email/password accounts aren't verified, so someone who knows an invited address
could sign up with it before its owner does — invite people who use Google sign-in, or create their
account for them.)

Everyone on one server shares the analysis: a video or channel checked for one family is free for the
next. That's the main reason to share a server.

## Costs

Rough, from [development.md → Costs](development.md#costs-rough): adding a channel analyses its 40 latest
long videos + 10 Shorts ≈ **50 Supadata credits + 10–15¢ OpenAI**, plus the first channel check ≈ 1¢
(Gemini). New uploads are analysed nightly at the same per-video rate (≈ 1 credit + 0.2–0.3¢ each).
Re-adding a channel, other families on the same server, and changing a child's answers cost nothing.
A family with 20 channels: roughly 1,000 credits + $2–3 once, then a few dollars a month. Set budget
alerts in Google Cloud and OpenAI.

## Updating

`git pull`, then rebuild the functions and deploy (`firebase deploy --only
"firestore,hosting,functions:kideos-backend"`), then rebuild the apps if their code changed.
