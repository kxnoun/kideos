# Kideos

> **Open source, self-hosted.** You run Kideos on your own Firebase project with your own API keys, for
> your family (or friends and family on one invite-only server) — setup: **[docs/self-hosting.md](docs/self-hosting.md)**.
> It analyses YouTube videos in ways YouTube's API policies don't allow (backlog → 2b); running it is your
> own risk.

A YouTube parental-control system: parents pick the channels, answer a per-child questionnaire about
what's OK, and the kid's app only ever shows videos that passed. Every video is analyzed once by AI from
its transcript and a few still images; each child's answers are applied to that analysis in code, so
changing answers updates the feed instantly. Before a channel is added, parents see a one-time channel
check (thumbnails + what people say) tailored to their child.

| App | Path | Bundle ID | What it is |
|---|---|---|---|
| **Kideos** | `apps/Kideos` | `com.kideos.app` | Kid-facing app, designed for kids like YouTube Kids: only approved videos, two layouts by age (bubbles + one strip for ≤ 4, shelves for 5+), full-screen player with drag gestures, minimum watch time, Time's up. No sign-in (anonymous auth); paired to the **family** by a 6-character code — one device can be shared by several kids ("Who's watching?", optional PIN per child). |
| **Kideos for Parents** | `apps/KideosParent` | `com.kideos.parent` | Parent app: children, channels (with a "Before you add it" channel check), the questionnaire, the Videos screen (what's shown / hidden and why, watch any video, Hide / Too hyper), suggested channels, live "now watching" + remote pause/stop, viewing rules + profile PINs, kid devices (who uses each, unpair), weekly digests. |
| **Backend** | `functions/` | your Firebase project | Cloud Functions (us-central1): channel checks, channel seeding, AI content profiles with image checks, filtering, re-apply on filter change, suggested channels, profile upgrades, "Too hyper" reports, digests, COPPA deletion. |

## How it works (one paragraph)

A parent types a channel → a one-time **channel check** (Gemini: its 50 latest thumbnails + a Google
search for its reputation, saved and shared by every family) shows whether it fits *their* child before
they confirm → the backend pulls the channel's 40 latest long videos + 10 Shorts → for each video it fetches the transcript
(Supadata) and asks GPT-4o-mini, with the thumbnail and 3 frames, for a **content profile**: violence,
language, scary, romance, sexual references, substances, dangerous stunts, self-harm, meanness, selling,
politics, religion, gambling, pace & stimulation, junk / Elsagate (+ optional dimensions), each on a 0–4
ladder, plus holidays, food, music, etc. Free image moderation, code-counted swearing and parents' "Too
hyper" reports set floors the AI can't go under. Profiles are shared by every family. The child's **questionnaire answers** are then applied in code → a per-child **verdict**:
*approved* (in the feed) or *hidden*, with the reason in plain words. Parents never have to approve
anything: they can look at what's shown and hidden (and why) whenever they like, and "Show anyway" one
video behind a confirmation. Changing answers re-applies them to all of that child's videos within
seconds, with no new AI or transcript calls.

Every analyzed channel also gets a shared **channel profile**, so parents get **suggested channels**
scored against their own child's answers and age — a channel is only suggested if the channel itself
suits the child (≥75% of its videos fit, at most 2 severe ones), not just some of its videos.

The kid's device only sees the children it's paired to (Firestore rules check the family's `kidDevices`
list). On a shared tablet each child picks their profile; everything — layout, videos, rules, End Session —
is per child.

Details: **[docs/architecture.md](docs/architecture.md)**; the kid app's look and feel:
**[docs/kid-app-design.md](docs/kid-app-design.md)**.

## Tech stack

- **Apps:** React Native 0.85.3 (bare CLI, New Architecture, React 19), TypeScript, React Navigation 7,
  Zustand 5, `react-native-youtube-iframe` (kid player)
- **Firebase:** `@react-native-firebase/*` **22.4.0 — pinned, do not upgrade** (breaks the iOS build).
  Firestore, Auth (Google / Apple / email for parents, anonymous for kids). (Messaging is installed but
  unused — no push notifications by design.)
- **Backend:** Cloud Functions v2 (`firebase-functions` 7, Node 22), `firebase-admin` 13, OpenAI SDK
- **External APIs:** YouTube Data API v3 (never `search.list`), Supadata (transcripts, Pro plan),
  OpenAI GPT-4o-mini (profiles) + moderation (images, free), Google Gemini Flash-Lite (channel checks,
  with Google Search). Keys live in Firebase Secret Manager.

## Repo structure

```
apps/
  Kideos/                 kid app        (screens: Pairing, Who's watching, Feed, Player; theme.ts = design system)
    src/pin.ts            profile-PIN hash — COPY in apps/KideosParent/src/pin.ts, keep identical
    android/…/KideosWindowModule.kt   landscape lock + hidden system bars (native)
  KideosParent/           parent app     (Auth, onboarding, Home, Videos, Suggestions, Channels, Digest, Settings)
    src/prefs.ts          questionnaire definitions — COPY of functions/src/prefs.ts, keep in sync
    src/components/FiltersForm.tsx   the questionnaire UI
functions/src/            Cloud Functions (see docs/architecture.md → Backend)
hosting/player/           the kid app's YouTube player page (Firebase Hosting — <project-id>.web.app/player/)
firestore.rules           security rules        firestore.indexes.json   composite indexes
tests/rules/              Firestore emulator tests for the rules (device binding, pairing, Show anyway…)
docs/                     everything else (below)
```

## Docs

| Doc | For |
|---|---|
| [architecture.md](docs/architecture.md) | How the system works: data flow, Firestore data model, every Cloud Function, key files and functions, cost controls |
| [development.md](docs/development.md) | Running, debugging (logs!), deploying, Firebase Console checklist, testing |
| [kid-app-design.md](docs/kid-app-design.md) | The kid app's design: modes by age, colours, fonts, sizes, player gestures, motion, speed rules |
| [questionnaire-research.md](docs/questionnaire-research.md) | Why the questionnaire and content profile look the way they do — research and sources |
| [backlog.md](docs/backlog.md) | What's next: AI accuracy check (labeling), known bugs, missing features |
| [android-setup.md](docs/android-setup.md) / [ios-setup.md](docs/ios-setup.md) | First-time machine setup |
| [auth-setup.md](docs/auth-setup.md) | Google / Apple / email / anonymous auth configuration |
| [CLAUDE.md](CLAUDE.md) | Short list of rules that have bitten us — read before changing code (written for AI assistants, useful for humans) |

> ⚠️ Firebase config files (`GoogleService-Info.plist`, `google-services.json`) are not in this repo — see the setup guides.
