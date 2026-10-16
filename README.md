# Kideos

A YouTube parental-control system: parents pick the channels, answer a per-child questionnaire about
what's OK, and the kid's app only ever shows videos that passed. Every video is analyzed once by AI from
its transcript; each child's answers are applied to that analysis in code, so changing answers updates
the feed instantly.

| App | Path | Bundle ID | What it is |
|---|---|---|---|
| **Kideos** | `apps/Kideos` | `com.kideos.app` | Kid-facing player. Shows only approved videos. No sign-in (anonymous auth), paired to a parent by a 6-character code. |
| **Kideos for Parents** | `apps/KideosParent` | `com.kideos.parent` | Parent app: children, channels, the questionnaire, the review queue, live "now watching" + remote pause/stop, weekly digests. |
| **Backend** | `functions/` | Firebase project `kideos-io` | Cloud Functions (us-central1): channel seeding, AI content profiles, filtering, re-apply on filter change, digests, COPPA deletion. |

## How it works (one paragraph)

A parent adds a channel → the backend pulls the channel's 50 latest videos → for each video it fetches the
transcript (Supadata) and asks GPT-4o-mini for a **content profile**: violence, language, scary, romance,
sexual references, substances, dangerous stunts, self-harm, meanness, selling, politics, religion, gambling
(+ optional dimensions), each on a 0–4 ladder, plus holidays, food, music, etc. Profiles are shared by every
family. The child's **questionnaire answers** are then applied in code → a per-child **verdict**:
*approved* (in the feed), *hidden*, or *needs review* (held until the parent approves). Changing answers
re-applies them to all of that child's videos within seconds, with no new AI or transcript calls.

Details: **[docs/architecture.md](docs/architecture.md)**.

## Tech stack

- **Apps:** React Native 0.85.3 (bare CLI, New Architecture, React 19), TypeScript, React Navigation 7,
  Zustand 5, `react-native-youtube-iframe` (kid player)
- **Firebase:** `@react-native-firebase/*` **22.4.0 — pinned, do not upgrade** (breaks the iOS build).
  Firestore, Auth (Google / Apple / email for parents, anonymous for kids), Cloud Messaging
- **Backend:** Cloud Functions v2 (`firebase-functions` 7, Node 22), `firebase-admin` 13, OpenAI SDK
- **External APIs:** YouTube Data API v3 (never `search.list`), Supadata (transcripts, Pro plan),
  OpenAI GPT-4o-mini. Keys live in Firebase Secret Manager.

## Repo structure

```
apps/
  Kideos/                 kid app        (screens: Pairing, Feed, Player)
  KideosParent/           parent app     (Auth, onboarding, Home, Channels, Digest, Settings)
    src/prefs.ts          questionnaire definitions — COPY of functions/src/prefs.ts, keep in sync
    src/components/FiltersForm.tsx   the questionnaire UI
functions/src/            Cloud Functions (see docs/architecture.md → Backend)
firestore.rules           security rules        firestore.indexes.json   composite indexes
docs/                     everything else (below)
```

## Docs

| Doc | For |
|---|---|
| [architecture.md](docs/architecture.md) | How the system works: data flow, Firestore data model, every Cloud Function, key files and functions, cost controls |
| [development.md](docs/development.md) | Running, debugging (logs!), deploying, Firebase Console checklist, testing |
| [questionnaire-research.md](docs/questionnaire-research.md) | Why the questionnaire and content profile look the way they do — research and sources |
| [backlog.md](docs/backlog.md) | What's next: AI accuracy check (labeling), known bugs, missing features |
| [android-setup.md](docs/android-setup.md) / [ios-setup.md](docs/ios-setup.md) | First-time machine setup |
| [auth-setup.md](docs/auth-setup.md) | Google / Apple / email / anonymous auth configuration |
| [CLAUDE.md](CLAUDE.md) | Short list of rules that have bitten us — read before changing code (written for AI assistants, useful for humans) |

> ⚠️ Firebase config files (`GoogleService-Info.plist`, `google-services.json`) are not in this repo — see the setup guides.
