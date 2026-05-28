# Android Dev Setup

How to get both apps running on an Android emulator (Windows).

---

## Prerequisites

### Android Studio
Download and install from https://developer.android.com/studio.  
During setup, accept the default SDK components (SDK Platform, Build Tools, Emulator).

Android Studio ships a bundled JDK (JBR, Java 21) — no separate JDK install needed.

### Node.js 22 (via nvm-windows)
Download the nvm-windows installer from https://github.com/coreybutler/nvm-windows/releases.
```powershell
nvm install 22
nvm use 22
```

---

## One-time Gradle JVM fix

Gradle requires JDK 17+ to run, but Windows often has an older system JDK. Fix it globally so you never have to think about it again:

Create (or edit) `C:\Users\<you>\.gradle\gradle.properties` and add:
```
org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr
```

This tells Gradle to use Android Studio's bundled JDK (Java 21) for all projects.

---

## Create an emulator

1. Open Android Studio → **Device Manager** (right toolbar or `View > Tool Windows > Device Manager`)
2. Click **+** → **Create Virtual Device**
3. Choose **Pixel 8 Pro** → Next
4. Download and select **API 35** system image → Next → Finish

Start the emulator from Device Manager before running the apps.

---

## Clone and configure

```bash
git clone git@github.com:kxnoun/kideos.git
cd kideos
git checkout android-setup
```

### Create local.properties (not in the repo — machine-specific)

Each app needs a `local.properties` file pointing to your Android SDK:

**`apps/Kideos/android/local.properties`**
```
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

**`apps/KideosParent/android/local.properties`**
```
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

Replace `<you>` with your Windows username. The double backslashes are required.

### ⚠️ Get the Firebase config files from a teammate

These files are secret and not in the repo. You need one per app:

| File | Destination |
|---|---|
| `google-services.json` | `apps/Kideos/android/app/google-services.json` |
| `google-services.json` | `apps/KideosParent/android/app/google-services.json` |

Both apps share the same Firebase project so it's the same file. Download it from the Firebase Console (`Project Settings > Your apps`) or get it from a teammate.

Do **not** commit these files — they're in `.gitignore`.

---

## Running Kideos (kid app)

Open two PowerShell terminals.

**Terminal 1 — Metro bundler**
```powershell
cd apps/Kideos
npm install
npx react-native start --port 8082
```

**Terminal 2 — build and install**
```powershell
cd apps/Kideos/android
.\gradlew app:installDebug -PreactNativeDevServerPort=8082
```

Then launch the app on the emulator:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n com.kideos.app/.MainActivity
```

The app shows a **pairing screen** with a 6-character code. A parent enters this code in the KideosParent app to link the two.

---

## Running KideosParent (parent app)

Keep Kideos' Metro running, or use a fresh terminal — each app uses a different port.

**Terminal 1 — Metro bundler**
```powershell
cd apps/KideosParent
npm install
npx react-native start --port 8083
```

**Terminal 2 — build and install**
```powershell
cd apps/KideosParent/android
.\gradlew app:installDebug -PreactNativeDevServerPort=8083
```

Then launch:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n com.kideos.parent/.MainActivity
```

The app shows a **sign in / sign up** screen.

---

## Day-to-day workflow

After the first-time setup, running an app is just:

```powershell
# Terminal 1
npx react-native start --port 8082   # or 8083 for KideosParent

# Terminal 2 (only if you changed native code or dependencies)
cd android && .\gradlew app:installDebug -PreactNativeDevServerPort=8082
```

For JS-only changes, Metro hot-reloads automatically. Press **`r`** in the Metro terminal to force a full reload.

---

## Troubleshooting

### `Gradle requires JVM 17 or later`
The global `gradle.properties` fix is missing. See the **One-time Gradle JVM fix** section above.

### `SDK location not found`
The `local.properties` file is missing. Create it in `android/` for each app as shown above.

### `No matching client found for package name`
The wrong `google-services.json` is in the directory. Download the correct file from Firebase Console and replace it.

### `'gradlew.bat' is not recognized`
Don't use `npx react-native run-android` on Windows — it has a known shell issue. Use the two-terminal approach (Metro + `.\gradlew app:installDebug`) described above.

### App shows "Could not connect to development server"
Metro isn't running or is on the wrong port. Make sure Metro is started with `--port 8082` (Kideos) or `--port 8083` (KideosParent), and that you passed `-PreactNativeDevServerPort=` to the same port in Gradle.

### `BUILD FAILED` after pulling changes
Run `npm install` in the app directory — a new native dependency may have been added.
