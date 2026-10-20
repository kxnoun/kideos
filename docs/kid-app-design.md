# Kid app design

How the kid app (`apps/Kideos`) looks, moves and feels, and why. Written Oct 20, 2026, after the redesign
(research → build → many rounds of testing on Adam's OnePlus 6T). For how the data flows see
[architecture.md](architecture.md) → Pairing / Watching; for running it see [development.md](development.md).

**Code map**

| File | What it holds |
|---|---|
| `src/theme.ts` | colours, fonts, type tokens, radii, `MOTION`, `useLayout()` (all sizes), `modeForAge()` |
| `src/components/Tap.tsx` | every tappable thing: squish + light wash on press, `useReduceMotion()` |
| `src/components/VideoTile.tsx` | one thumbnail + title (badges, ✓, length); measures itself for the zoom-open |
| `src/components/BackButton.tsx` | round back button with a drawn chevron (`action` orange / `quiet` see-through) |
| `src/screens/FeedScreen.tsx` | home: little mode (bubbles + strip), big mode (shelves + collapsing header + `ChipBar`), channel page, empty state |
| `src/screens/PlayerScreen.tsx` | the player: zoom-open, drag gestures, More from, end card, viewing rules |
| `src/screens/WhoScreen.tsx` | "Who's watching?" tiles + PIN pad |
| `src/screens/PairingScreen.tsx` | the pairing code |
| `App.tsx` | which screen shows; the layers (player, Who's watching, "Hi Simon!" card); Time's up; loading |
| `src/device.ts` + `android/…/KideosWindowModule.kt`, `MainActivity.kt` | landscape lock, hidden system bars |
| `src/watched.ts`, `src/gate.ts`, `src/viewing.ts`, `src/pin.ts` | ✓ marks, when to ask "Who's watching?", minimum watch time, PIN hash |

## Principles

- **Thumbnails are the brightest thing on screen.** A deep-purple base ("Twilight") so the videos pop, not
  the chrome. Dark also suits evening viewing and TVs later.
- **Pictures before words.** The youngest users can't read: channel pictures and emoji carry meaning; text
  is a label, never the only cue. Colour is never the only cue either (✓ on watched, emoji on chips, 🔒 / 🌙
  on profile tiles).
- **Big, forgiving targets.** Buttons ≥ 64 pt (80 on tablets), chips 48 pt, PIN keys 72–88 pt, `hitSlop` 12.
  Feedback on press-**in** (kids lift slowly or slide off). No long-press, double-tap or pull-to-refresh.
  Video taps are debounced 600 ms (excited double taps).
- **Calm, not sticky.** No autoplay, no swipe-to-next-video, no infinite feed (big mode ends with "You've
  seen all your channels! 🎉"). The end of a video is a choice (Watch again / My videos / 3 more). Time's up
  suggests things to do offline instead of scolding.
- **Responsive by window, not device.** Every size comes from `useWindowDimensions` (`useLayout`), so phones,
  tablets, rotation and split screen all work. TV later = the same tokens at a bigger size class.
- **Every move has a direction, and nothing waits.** Screens slide, zoom and follow the finger; nothing is
  rebuilt to show something on top of it (see Motion and speed).
- **Full screen, like YouTube Kids.** System bars hidden everywhere, the video fills the screen.

## Two modes (from the child's age, live from the child doc)

Thresholds are Adam's call (Oct 20): **little = 4 and under, big = 5 and up** (`modeForAge`). Changing a
child's age (today: in Firestore; the parent app's child editor is coming with its redesign) switches the
layout immediately.

| | **Little** (≤ 4) | **Big** (5+) |
|---|---|---|
| Orientation | **Landscape only**, either way up (`setLandscapeOnly`) — a portrait strip wasted most of the screen. | Rotates freely (long videos still lock to landscape while playing). |
| Home | The child's avatar on the left (just the emoji + a thin divider — **no circle**, so it doesn't read as a channel bubble; on a shared device a rounded square that switches profile), then a band of round **bubbles**: ⭐ New, ⚡ Shorts, each channel's picture. Tapping a bubble swaps the **one sideways film strip** below (snaps tile by tile). No vertical scrolling. | **Shelves** like YouTube Kids: ⭐ New (latest 15 long videos), ⚡ Shorts (20, tall tiles), one row per channel (latest 12 + a "See all" tile), then the end cap with "Back to the top ↑". |
| Header | None — no greeting text for pre-readers. | "Hi Simon 👋" with the avatar (52 pt phone / 60 pt tablet; on a shared device it switches profile and has a yellow ⇄ badge), above a bar of **jump-chips** (one per shelf). The header collapses as they scroll: the greeting (72 / 88 pt tall) fades and slides away, the chip bar (64 pt) stays pinned. |
| Chips | — | The chip for the shelf under the bar is lit (yellow). Tapping a chip lights it **at once** and scrolls there; shelves passed on the way don't flash; at the very bottom the last shelf counts; the lit chip is kept in view in the bar. |
| Channel page | — (the bubble *is* the channel) | "See all" → a grid of everything from that channel (2–5 columns by width) with an orange back button; slides in from the right. |
| Tiles | Title only, bigger text (19 pt × scale). | Title + length badge. |
| Strip / rows | New shows 30 long videos. Tile size = the space really left under the bubble band (measured), capped at the design size (~1.3 visible on a phone, ~2.5 on a tablet). Nothing in the bottom 48 pt on tablets (wrists rest there; 12 pt on phones). | ~2.2 tiles across on a phone, 3.2 / 4.3 / 5.3 on bigger windows (the fraction is a deliberate "there's more" peek). |

Both modes: a channel-picture badge on tiles in mixed shelves (New / Shorts) and a mint ✓ sticker once
watched (~90% played or played to the end — `watched.ts`, per child on the device). Tiles wider than 300 pt
load YouTube's 480 px thumbnail (`hqdefault`; its letterbox bars are cropped by "cover").

**Empty / loading:** the feed draws nothing (plain background) until its first channels + videos arrive —
no "Getting ready" flash. Then, if there's nothing: 📺 "Getting your videos ready! A grown-up is picking your
channels" (no channels yet) or ⏳ "Almost ready!" (videos still being checked), with a **"Who's watching?"**
button on shared devices so a sibling can watch instead.

## Tokens

**Colours** (contrast measured on `bg`):

| Token | Hex | Use |
|---|---|---|
| `bg` Night Grape | `#1E1442` | screen background (white text 17:1) |
| `surface` Grape Card | `#2D2062` | chips, cards, keys, empty tiles, placeholders |
| `surfacePressed` Plum | `#3D2C85` | lines, dividers |
| `text` | `#FFFFFF` | |
| `textSecondary` Lilac Mist | `#C9BFF0` | secondary text (9.9:1) |
| `brand` Kideos Purple | `#6C3CE9` | brand fills, white text OK (6.1:1) |
| `brandOnDark` Lavender | `#A98BFF` | rings, links, spinners, pairing-code borders |
| `action` Sunset Orange | `#FF8A2B` | the main action (channel-page back, My videos) — **always Ink text, never white** |
| `ink` | `#1F1A33` | text on orange / yellow |
| `focus` Sunny Yellow | `#FFD23F` | selected bubble ring, lit chip, banners and notices, PIN dots, ⇄ badge |
| `success` Mint | `#3DDC97` | watched ✓ |
| `error` Soft Coral | `#FF6B6B` | wrong PIN / wait message |
| `disabled` Dusk | `#5A4E8C` | PIN keys during the wait |

The pressed wash is `LIT` = white at 20% (`Tap.tsx`). Profile tiles cycle brand / action / success / focus /
brandOnDark / error.

**Fonts** (SIL OFL, bundled in `assets/fonts` with their licences; Android copy in
`android/app/src/main/assets/fonts`): **Fredoka SemiBold / Bold** for headings, chips, buttons and numbers
(rounded, friendly, clear letterforms); **Nunito Bold / ExtraBold** for titles and body (rounded, very
legible small). Files are named by PostScript name, so `fontFamily: "Fredoka-SemiBold"` works on both
platforms. Text scaling is capped (`maxFontSizeMultiplier` 1.2–1.3) on tiles, chips and titles so huge
system font sizes don't break layouts.

**Shape:** tiles 20 pt radius, cards 24, profile tiles 32, chips and buttons pill.

**Motion** (`MOTION` in theme.ts): slide in 180 ms, slide out 160 ms, zoom 150 ms, all **ease-out cubic** —
full speed at the start, settling at the end. Ease-in-out felt heavy (slow, fast, slow); linear felt
mechanical. Change feel in that one place.

## Responsive rules (`useLayout`)

- **Size class by window width:** compact < 600, medium 600–839, expanded 840–1199, large ≥ 1200 → margins
  16 / 24 / 32 / 40, gaps 12 / 16 / 20 / 24, channel-page columns 2 / 3 / 4 / 5.
- **`phone`** = shortest side < 600 (a phone in landscape is "expanded" by width but still a phone) → touch
  targets 64 vs 80, type scale 0.9 vs 1, bubbles 76 (phone) / 96 / 112 (by shortest side).
- **Tile width** = (W − 2·margin − gap·(⌈visible⌉ − 1)) / visible.
- **Safe-area insets** on every screen. With the bars hidden they're mostly 0, but a notch at the side in
  landscape still counts.

## Full screen (Android)

The status and navigation bars are hidden everywhere (sticky immersive, like YouTube Kids); a swipe from the
edge shows them for a few seconds. It's comfort, not a lock — a kid can still swipe and leave. Locking the
device to Kideos is screen pinning (Android) / Guided Access (iPad) — backlog → "lock your kid's phone" guide.

- Native: `MainActivity.kt` → `hideSystemBars()` (`WindowInsetsControllerCompat`, `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`),
  re-applied whenever the app gets focus. `KideosWindowModule.kt` (registered in `MainApplication.kt`) →
  `setLandscapeOnly(on)` (`SCREEN_ORIENTATION_SENSOR_LANDSCAPE` / `UNSPECIFIED`) and `hideSystemBars()`.
  JS wrapper `src/device.ts` (iOS: no-ops for now). Leaving YouTube's fullscreen re-hides the bars.
- **Every screen uses `<StatusBar hidden />`.** One screen asking for a visible status bar made the safe-area
  margins change on every switch (the 6T's notch is at the side in landscape), so the layout jumped sideways
  and "refreshed" after Who's watching, the Hi card and closing a video.
- Landscape lock (`App.tsx`): on for little mode always, and for everyone while a long video plays.
- If the phone doesn't turn sideways for a long video, the native module is missing (logcat
  `[device] KideosWindow native module missing`) → rebuild with Gradle.

## Player

**Full screen from the first tap** (Oct 20). Our own full screen — an app can't trigger YouTube's fullscreen
button, and doesn't need to. YouTube's own fullscreen button is **off** via the official `fs=0` player
setting (`initialPlayerParams.preventFullScreen`) — allowed by YouTube; its fullscreen would take over and
stop our gestures. Long videos lock to landscape while playing; Shorts fill the height.

**Nothing is drawn on the playing video** (YouTube's terms). The video fills the screen as far as its shape
allows (full height on a phone in landscape — never shrunk for a button). A quiet, see-through round back
button (drawn chevron) sits centred in the black space beside the video (phones wider than 16:9, like the 6T)
or above it (4:3 / 16:10 tablets) — only if there's room; otherwise drag down / Android back. Its size is
the touch size capped at 56 pt.

**Opening — the video grows out of the tile.** `VideoTile` measures where its thumbnail is
(`measureInWindow`) and passes it along; the player starts the thumbnail (480 px) exactly there and zooms it
into the player's place while the black fades in over the feed. The thumbnail then **stays as the picture
until the video really plays** (state `playing`; or 1.5 s after the player is ready; at worst 5 s) and fades
into it — the kid never sees YouTube's blank loading page. Exception: a long video opened with the phone
upright rotates the phone at the same moment, so the tile's spot means nothing — that case zooms from the
centre instead (scale 0.85 → 1 + fade).

**Gestures** (a `PanResponder` over the whole screen — it takes the touch from YouTube's web view once it's
clearly a drag; taps still reach YouTube):
- **Drag down, in any downward direction (even mostly sideways):** the video follows the finger, shrinking
  (to half size), and the black behind fades so the feed shows through. Let go far enough (> 80 pt or 18% of
  the screen) or flick → it keeps flying the way the finger was going and fades out; otherwise it springs
  back. While the minimum watch time is owed it only stretches (¼ of the finger), then springs back with
  "Watch a little more!".
- **Drag up:** the video rises with the finger (0.6×) and shrinks towards the top while **"More from
  <channel>"** (3 videos) comes in underneath. Let go → it shoots into place (or drops back if barely moved).
  The video moves out of the way — nothing covers it. Dragging down from there reverses it (also the ⌄
  button top-left, or Android back).
- **Drags that start on YouTube's control bar** (bottom 22% of the video — the seek bar) only count when
  straight up/down, so seeking still works. Horizontal swipes on the More from row scroll it.
- The direction is decided in `onMoveShouldSetPanResponder` — React Native resets `dx/dy` to 0 at grant, so
  deciding it there treated every drag as "down" (bug fixed Oct 20).
- Backup: `SWIPE_IN_PLAYER`, a passive listener inside YouTube's iframe, reports quick swipes through the
  library's `onPlaybackRateChange` as a `kideos:swipe:*` string (the library has no custom-message hook);
  de-duplicated with the PanResponder (600 ms). It only listens (never blocks a touch; ignores the seek bar,
  menus and ads) — same YouTube-terms grey area as `HIDE_IN_PLAYER` (backlog → kid player).
- A swipe from the very top edge is Android's notification shade, not ours.

**Banners** ("Watch a little more! 0:12 left", "Finish this one first!", "Nice try 😄") are yellow pills at
the top. **When a video ends:** an end card over everything — "That's the end! 🎉", ↻ Watch again (purple),
🏠 My videos (orange), up to 3 more from the same channel (older ones first, unwatched first — `pickNext` in
App.tsx). A parent's Hide or a video that won't play returns to the feed with a friendly yellow note at the
bottom ("A grown-up took that video away…", "That video can't play here…") — no system pop-ups.

## Motion and speed

Every move has a direction, so the app feels like one place you move around in:
- **"See all"** slides in from the right; Back slides it out to the right. The home screen stays alive
  underneath (no rebuild, same scroll position). The grid fills in right after the slide (placeholder boxes
  first), so the slide starts at once; on Back the page's grid is thrown away 300 ms after the slide ends,
  while it's off-screen — doing it at once made the end of the slide stutter.
- **A video** zooms out of its tile (above); drag down flies it away; drag up raises it into More from.
  The feed stays alive under the player, so Back from a video is instant and lands where the kid was — even
  on a channel page.
- **"Who's watching?"** slides down over the screen. Picking a child shows a **"Hi Simon!"** card (big avatar)
  that stays until their feed has its videos (`FeedScreen` → `onReady`; at least 450 ms, at most 4 s), then
  slides up — it never slides away onto an empty screen that then pops in.
- **Buttons:** a gentle squish (spring) plus a light wash while the finger is on them — off the moment it
  lifts. Not on thumbnails, channel bubbles or the profile switcher (squish only); "Who's watching?" tiles
  light their own square.
- **Layers over the feed** (player, Who's watching, the Hi card) have explicit `zIndex` + `elevation`
  (10 / 20 / 30) — without them Android drew the feed's chip bar on top.
- **Reduce Motion** (system setting): no slides, zooms or squish — screens just appear; the wash still shows.

**Speed rules** (the 6T in a debug build is the benchmark; release builds are several times faster):
- Never rebuild a screen to show another on top of it (home stays under See all and the player).
- Rows build only the tiles that fit (`initialNumToRender` ≈ tiles across + 1, `windowSize` 3); the channel
  grid starts with 3 rows.
- `VideoTile`, `LittleHome`, `BigHome` and `ChipBar` are memoised; the shelf list is built once per data
  change (`useMemo`), not on every redraw. The lit chip lives in `ChipBar`'s own state, so lighting one
  redraws only the chips (redrawing every shelf made it lag ~1 s).

## Who's watching? (devices 2+ kids use)

Big rounded-square avatar tiles (112 pt phone / 160 pt tablet, one colour per child), the name under each;
🔒 = has a PIN, 🌙 = a parent ended that child's session (they can still pick it — they'll see Time's up).

**PIN pad:** avatar + name, "Type your PIN", four dots that fill yellow, round keys (up to 72 pt phone / 88
pt tablet, shrunk to fit the height), ⌫, a shake + "Not quite — try again" on a wrong PIN, "Forgot it? Ask a
grown-up to change it in Kideos for Parents." After 5 wrong tries: "Too many tries — wait 30 s" (keys greyed;
counted in memory per child). Side by side (name left, keys right) on phones in landscape. Orange back
button top-left → the tiles.

**Switching profile:** the avatar on the feed (little: the rounded square; big: the avatar by "Hi Simon"
with the ⇄ badge), the "Who's watching?" button on Time's up, and on the empty feed. Only on shared devices.
When it asks again by itself: architecture → Pairing ("Who's watching?").

## Time's up / pairing / loading

- **Time's up** (End Session, per child): 🌙 "Great watching, Simon! Time for a break. What will you do
  next?" + three activity cards (draw, build, read, dance party, play outside, puzzle — a different three
  each day) + "Who's watching?" on shared devices.
- **Pairing:** the Kideos wordmark, "Ask a grown-up to open **Kideos for Parents** and type this code:", the
  code as six big letter tiles, "The code works for 15 minutes", "Waiting for a grown-up…".
- **Loading:** the Kideos wordmark + spinner on `bg` (also while an old device is moved over).
- **Almost ready** (a device with no children on it): 📺 "A grown-up is choosing who uses this device."

## Accessibility

Every tappable has an `accessibilityLabel` (tiles read "title, channel, watched"; profile tiles add "needs a
PIN" / "time's up"); bubbles and chips expose `selected`. Reduce Motion is respected (above). Header collapse
is scroll-driven (it moves only when the child scrolls). Text scaling is capped where layouts would break.

## Not yet / later

- **TV:** focus states (yellow ring) on `Tap`, D-pad order, overscan margins — the tokens are ready.
- **iOS / iPad:** fonts need `npx react-native-asset` once on a Mac (adds them to Xcode + Info.plist); the
  landscape lock and hidden bars are Android-only so far (iPad: `supportedInterfaceOrientations` in
  AppDelegate + `prefersHomeIndicatorAutoHidden` / `prefersStatusBarHidden`); the drag gestures over
  WKWebView need a check on a real iPad.
- A real mascot instead of the 🌙 / emoji placeholders; sounds / haptics (no libraries installed yet).
- "Continue watching" shelf (needs per-video progress, not only the owed video).
- Corners of the zoom-open thumbnail are square (animating radius isn't possible on the native driver).
