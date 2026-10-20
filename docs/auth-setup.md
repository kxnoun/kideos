# Authentication Setup

## Strategy

KideosParent uses three auth methods, in priority order:

1. **Sign in with Google** — primary, one-tap, high conversion
2. **Sign in with Apple** — required by App Store rules (if any third-party OAuth is offered, Apple must be offered too)
3. **Email / password** — fallback for users without Google or Apple accounts

**Facebook is intentionally excluded.** The Facebook SDK adds significant bundle weight, brings Meta privacy concerns, and would invite additional COPPA scrutiny since this is a children's platform. The parent demographic is well-covered by Google + Apple.

The kid app (Kideos) uses **anonymous Firebase Auth** only — kids never sign in.

> ⚠️ **Anonymous** must be enabled in Firebase Console → Authentication → Sign-in method. If it isn't,
> pairing still works (it needs no auth) but every Firestore read afterwards is denied, the feed stays
> empty, and logcat shows `auth/admin-restricted-operation`.

---

## Packages

```bash
# Google Sign-In
npm install @react-native-google-signin/google-signin

# Apple Sign-In (iOS only — Android shows "Continue with email" as fallback)
npm install @invertase/react-native-apple-authentication
```

After installing, run `pod install` in `apps/KideosParent/ios/`.

---

## Firebase Console setup (do once)

1. Open [Firebase Console](https://console.firebase.google.com) → your project
2. Go to **Authentication → Sign-in method**
3. Enable **Google** — set the project support email
4. Enable **Apple** — you'll need your Apple Services ID and the OAuth redirect URL (see Apple setup below)
5. Enable **Email/Password** — keep this as a fallback

---

## Google Sign-In

### Android — register your SHA fingerprints

Google Sign-In on Android requires your app's signing certificate fingerprint to be registered in the Firebase Console.

> **Debug builds are signed with `apps/<App>/android/app/debug.keystore`** (checked into the repo, see
> `signingConfigs.debug` in `android/app/build.gradle`) — not your personal `~/.android/debug.keystore`.
> Its fingerprint (SHA-1 `5E:8F:16:…:F6:25`) is already registered for `com.kideos.parent`.

**Get the debug fingerprint (for development):**
```powershell
# Windows — from apps/KideosParent/android
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore "app\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```
```bash
# macOS / Linux
keytool -list -v -keystore app/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Copy the **SHA-1** and **SHA-256** values.

**Register them:**
1. Firebase Console → Project Settings → Your apps → select the Android app
2. Add fingerprint → paste SHA-1 → Save
3. Repeat for SHA-256
4. Re-download `google-services.json` and replace both copies:
   - `apps/Kideos/android/app/google-services.json`
   - `apps/KideosParent/android/app/google-services.json`

> For release builds, repeat this with your release keystore fingerprint before submitting to the Play Store.

### iOS — URL scheme

The `GoogleService-Info.plist` contains a `REVERSED_CLIENT_ID` value. This must be added as a URL scheme in Xcode:

1. Open `apps/KideosParent/ios/KideosParent.xcworkspace` in Xcode
2. Select the **KideosParent** target → **Info** tab → **URL Types**
3. Click **+** → set **URL Schemes** to the value of `REVERSED_CLIENT_ID` from your `GoogleService-Info.plist`
4. No prefix or identifier needed

### Web Client ID

The Google Sign-In SDK requires the **Web Client ID** (not the iOS or Android client ID):

1. Firebase Console → Project Settings → Your apps → Web app (or create one if none exists)
2. Copy the `client_id` from the web OAuth config
3. Pass it to `GoogleSignin.configure({ webClientId: '...' })` during app init

---

## Apple Sign-In (iOS only)

### Apple Developer setup

1. Sign in to [developer.apple.com](https://developer.apple.com) → **Certificates, IDs & Profiles**
2. Select your App ID (`com.kideos.parent`) → Edit
3. Enable **Sign In with Apple** → Save

### Xcode capability

1. Open `apps/KideosParent/ios/KideosParent.xcworkspace` in Xcode
2. Select the **KideosParent** target → **Signing & Capabilities**
3. Click **+ Capability** → add **Sign In with Apple**

### Firebase Console — Apple provider

1. Firebase Console → Authentication → Sign-in method → Apple
2. Enable it
3. Under **Services ID**, enter your Apple Services ID (create one at developer.apple.com → Identifiers → Services IDs if you don't have one)
4. Copy the **OAuth redirect URL** shown in Firebase and paste it into your Apple Services ID configuration as an authorized redirect URI

> Apple Sign-In only works on physical devices and TestFlight — it does **not** work in the iOS Simulator.

---

## Email / Password fallback

No extra setup required — it's already enabled in Firebase Auth. The sign-in UI should present this as a secondary option ("Continue with email") below the Google and Apple buttons, never as the default.

---

## Android: Apple Sign-In

Apple Sign-In is not available on Android. The `@invertase/react-native-apple-authentication` package no-ops on Android. On Android, show only:

- Sign in with Google
- Continue with email

---

## Environment summary

| Provider | iOS | Android | Notes |
|---|---|---|---|
| Google | ✅ | ✅ | Needs SHA fingerprints on Android, URL scheme on iOS |
| Apple | ✅ | ❌ | Physical device only; not in Simulator |
| Email/Password | ✅ | ✅ | Fallback; de-emphasized in UI |

---

## Implementation notes

- Auth state is managed in `apps/KideosParent/src/hooks/useAuth.ts` and synced to Zustand via `useStore`
- All Firebase auth calls live in `apps/KideosParent/src/services/firebase.ts`
- Sign-in/sign-up is one screen, `screens/auth/AuthScreen.tsx`: Google → Apple (iOS) → email/password
- `GoogleSignin.configure()` runs once at module load in `services/firebase.ts`
- Sign Out signs out of Firebase **and** Google (`GoogleSignin.signOut()`), so the next Google sign-in shows the account picker
- After any successful sign-in, `onAuthStateChanged` fires and `App.tsx` routes the user to onboarding or the main tab navigator automatically — no manual navigation needed in the auth screen
