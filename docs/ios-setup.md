# iOS Dev Setup

How to get both apps running on the iOS simulator.

---

## Prerequisites

Install these once on your machine:

### Node.js 22 (via nvm)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22
```

### Ruby 3.4.4 (via ruby-install + chruby)
```bash
brew install ruby-install chruby
ruby-install ruby 3.4.4
# Add to ~/.zshrc or ~/.bashrc:
source $(brew --prefix)/opt/chruby/share/chruby/chruby.sh
chruby ruby-3.4.4
```

### CocoaPods
```bash
gem install cocoapods
```

### Xcode
Install from the Mac App Store. Version 16+ required.  
After installing, open Xcode once to accept the license and install command-line tools.

---

## Clone and configure

```bash
git clone git@github.com:kxnoun/kideos.git
cd kideos
git checkout ios-setup
```

### ⚠️ Get the Firebase config files from a teammate

These files are secret and not in the repo. You need one per app:

| File | Destination |
|---|---|
| `GoogleService-Info.plist` (Kideos) | `apps/Kideos/ios/GoogleService-Info.plist` |
| `GoogleService-Info.plist` (KideosParent) | `apps/KideosParent/ios/GoogleService-Info.plist` |

Do **not** commit these files — they're in `.gitignore`.

---

## Running Kideos (kid app)

```bash
cd apps/Kideos

# 1. Install JS dependencies
npm install

# 2. Install iOS native dependencies (~3 min first time — downloads prebuilt binaries)
cd ios && pod install && cd ..

# 3. Start Metro bundler (keep this terminal open)
npm start

# 4. In a second terminal — build and launch on simulator
npx react-native run-ios --simulator "iPhone 16 Pro"
```

The app shows a **pairing screen** with a 6-character code. A parent enters this code in the KideosParent app to link the two.

---

## Running KideosParent (parent app)

> **Stop Kideos' Metro first** (`Ctrl+C`) — both apps use port 8081.

```bash
cd apps/KideosParent

# 1. Install JS dependencies
npm install

# 2. Install iOS native dependencies (~3 min first time)
cd ios && pod install && cd ..

# 3. Start Metro bundler (keep this terminal open)
npm start
# Note: first startup takes ~60s while Metro scans node_modules. Subsequent starts are instant.

# 4. In a second terminal — build and launch on simulator
npx react-native run-ios --simulator "iPhone 16 Pro"
```

The app shows a **sign in / sign up** screen.

---

## Day-to-day workflow

Once you've done the first-time setup, running an app is just:

```bash
# Terminal 1
npm start

# Terminal 2 (only needed if you changed native code or pods)
npx react-native run-ios --simulator "iPhone 16 Pro"
```

For JS-only changes, Metro hot-reloads automatically. Press **`r`** in the Metro terminal to force a full reload.

### Switching between apps
Kill Metro (`Ctrl+C`) in one terminal before starting the other app's Metro. Only one can run on port 8081 at a time.

---

## Troubleshooting

### `pod install` fails
Make sure you're using Ruby 3.4.4 (`ruby --version`) and CocoaPods 1.16+ (`pod --version`).

### `error listen EADDRINUSE :::8081`
Something is already on port 8081. Kill it:
```bash
lsof -ti:8081 | xargs kill -9
```

### App shows "Could not connect to development server"
Metro isn't running. Start it with `npm start` from the app directory, then press **Reload (⌘R)** in the simulator.

### `FirebaseApp.configure()` crash on launch
The `GoogleService-Info.plist` is missing or in the wrong location. Check the paths in the table above.

### `pod install` re-run needed?
Yes, after any of these:
- Pulling changes that modified `package.json`
- Adding/removing an npm package that has a native module
- Changing the `Podfile`
