# Kid app design

The kid app's look and layout (Oct 20, 2026). Code: `apps/Kideos/src/theme.ts` (tokens + `useLayout`),
`src/components/Tap.tsx`, `src/components/VideoTile.tsx`, `src/screens/*`, `App.tsx`.

## Principles

- **Thumbnails are the brightest thing on screen.** A deep-purple base ("Twilight") so the videos pop,
  not the chrome. Dark also suits evening viewing and TVs later.
- **Pictures before words.** The youngest users can't read: channel pictures and emoji carry meaning;
  text is a label, never the only cue. Colour is never the only cue either (✓ on watched, emoji on chips).
- **Big, forgiving targets.** Small hands and imprecise taps: buttons ≥ 64 pt (80 on tablets), chips 48 pt,
  `hitSlop` 12, feedback on press-**in** (a squish + a light wash over the button, shown ≥ 140 ms so quick taps
  see it — not on thumbnails, channel bubbles or the profile switcher), no long-press / double-tap / pull-to-refresh, video
  taps debounced 600 ms (excited double taps).
- **Calm, not sticky.** No autoplay, no infinite feed (big mode ends with "You've seen all your
  channels! 🎉"), the end of a video is a choice (Watch again / My videos / 3 more), and Time's up offers
  things to do offline instead of a scolding.
- **Responsive by window, not device.** Everything is sized from `useWindowDimensions` — phones,
  tablets, rotation and split screen all work; TV later = the same tokens at a bigger size class.

## Two modes (from the child's age, live from the child doc)

Thresholds are Adam's call (Oct 20): little = 4 and under, big = 5+.

| | **Little** (age ≤ 4) | **Big** (5+) |
|---|---|---|
| Orientation | **Landscape only** (either way up) — portrait wasted most of the screen. | Rotates freely. |
| Home | The child's avatar on the left — just the emoji and a divider, **no circle**, so it doesn't read as a button — then a band of round **bubbles**: ⭐ New, ⚡ Shorts, each channel's picture. Tapping a bubble swaps the **one sideways film strip** below. The strip's tiles are sized to the space actually left under the band (measured, so nothing is cut off), capped at the design size (~2.5 visible on a tablet). No vertical scrolling. Nothing in the bottom 48 pt on tablets (wrists rest there; 12 pt on phones). | **Shelves** like YouTube Kids: ✨ New (15), ⚡ Shorts (20, tall tiles), one row per channel (12 + a "See all" tile), then the end cap. |
| Header | None — no greeting text for pre-readers. | "Hi Simon 👋" + a bar of jump-chips (one per shelf). Scrolling collapses it: the greeting fades and slides away (48–60 pt), the chip bar stays pinned (64 pt) and highlights the shelf you're on; tapping a chip lights it at once and scrolls there (shelves passed on the way don't light up); the lit chip
is kept in view in the bar. |
| Channel page | — (the bubble *is* the channel) | "See all" → grid of everything (2–5 columns by width), big ← button. |
| Tiles | Title only, bigger text. | Title + length. |

Both: channel picture badge on tiles in mixed shelves (New / Shorts), mint ✓ sticker once watched.

## Tokens

**Colours** (contrast measured on `bg`):

| Token | Hex | Use |
|---|---|---|
| `bg` Night Grape | `#1E1442` | screen background (white text 17:1) |
| `surface` Grape Card | `#2D2062` | chips, cards, empty tiles |
| `surfacePressed` Plum | `#3D2C85` | lines, pressed |
| `text` | `#FFFFFF` | |
| `textSecondary` Lilac Mist | `#C9BFF0` | secondary text (9.9:1) |
| `brand` Kideos Purple | `#6C3CE9` | brand fills, white text OK (6.1:1) |
| `brandOnDark` Lavender | `#A98BFF` | rings, links, spinners on `bg` |
| `action` Sunset Orange | `#FF8A2B` | the main action (← back, My videos) — **always Ink text, never white** |
| `ink` | `#1F1A33` | text on orange / yellow |
| `focus` Sunny Yellow | `#FFD23F` | selected bubble ring, active chip, banners (TV focus later) |
| `success` Mint | `#3DDC97` | watched ✓ |
| `error` Soft Coral | `#FF6B6B` | (reserved) |
| `disabled` Dusk | `#5A4E8C` | (reserved) |

**Fonts** (SIL OFL, bundled — `assets/fonts`, licences alongside): **Fredoka SemiBold / Bold** for
headings, chips and buttons (rounded, friendly, clear letterforms); **Nunito Bold / ExtraBold** for titles
and body (rounded, very legible at small sizes; single-storey-ish shapes kids recognise). Files are named
by PostScript name so `fontFamily: "Fredoka-SemiBold"` works on both platforms. Text scaling is capped
(`maxFontSizeMultiplier` 1.2–1.3) on tiles and chips so huge system fonts don't break layouts.

**Shape:** tiles 20 pt radius, cards 24, chips/buttons pill.

## Responsive rules (`useLayout`)

- Size class by window width: compact < 600, medium 600–839, expanded 840–1199, large ≥ 1200 → margins
  16/24/32/40, gaps 12/16/20/24, grid columns 2/3/4/5.
- `phone` = shortest side < 600 (a phone in landscape is "expanded" by width but still a phone) → touch
  targets 64 vs 80, type scale 0.9 vs 1, bubble 76 / 96 / 112.
- Tile width = (W − 2·margin − gap·(⌈visible⌉ − 1)) / visible, with a deliberate fractional "peek"
  (little 1.3 / 1.6 / 2.5 / 3.2, big 2.2 / 3.2 / 4.3 / 5.3). The little strip is also capped by height so
  it fits under the bubble band in landscape.
- Tiles wider than 300 pt load YouTube's 480 px thumbnail (`hqdefault`, letterbox cropped by "cover").
- Safe-area insets on every screen (notches, Android edge-to-edge).

## Full screen (Android)

The status and navigation bars are hidden everywhere (like YouTube Kids); a swipe from the edge shows them
for a few seconds. This is comfort, not a lock — a kid can still swipe and leave. Locking the device to
Kideos is screen pinning (Android) / Guided Access (iPad): backlog → "lock your kid's phone" guide.
Native: `MainActivity.kt` (`hideSystemBars`, re-applied on focus) and `KideosWindowModule.kt`
(`setLandscapeOnly`, `hideSystemBars`; JS `src/device.ts`). Leaving YouTube's fullscreen re-hides them.

## Player

**Full screen from the first tap** (agreed Oct 20). Our own full screen — an app can't trigger YouTube's
fullscreen button, and doesn't need to. Long videos lock to landscape while playing (everyone; App.tsx);
Shorts fill the height. YouTube's own fullscreen button is off — the official `fs=0` player setting
(`preventFullScreen`), allowed by YouTube; its fullscreen would take over and stop the swipes. **Nothing is
drawn on the playing video** (YouTube's terms). The video always fills the screen as far as its shape
allows — full height on a phone in landscape, never shrunk for a button. A quiet see-through round back
button (drawn chevron — `components/BackButton`) sits centred in the black space beside it (wider-than-16:9
phones) or above it (4:3 / 16:10 tablets) — only if there's room; otherwise swipe down / Android back.

- **Swipe down** on the video → it drops away and the feed comes back. While the minimum watch time is
  owed it bounces back with "Watch a little more!".
- **Swipe up** → the video shrinks to the top and "More from <channel>" (3 videos) slides in underneath —
  the video moves out of the way, nothing covers it. Swipe down anywhere, the ⌄ button (top-left while
  the row is open) or Android back → full screen again.
  No swipe-to-next-video (the endless-feed pattern).
- A swipe from the very top edge is Android's notification shade, not ours. Swipes on the video are seen
  by `SWIPE_IN_PLAYER`, a passive listener inside YouTube's iframe (never blocks a touch; ignores the seek
  bar, menus and ads), which reports through the library's `onPlaybackRateChange` as a `kideos:swipe:*`
  string — the library has no custom-message hook. Same YouTube-terms grey area as `HIDE_IN_PLAYER`.
  Swipes anywhere else (black space, the row) by a PanResponder; the two are de-duplicated (600 ms).
- If the phone doesn't turn sideways for a long video, the native module is missing (logcat:
  `[device] KideosWindow native module missing`) → rebuild with Gradle.
- Opening zooms the video in; Reduce Motion skips the animations.

Banners ("Watch a little
more! 0:12 left", "Nice try 😄") are yellow pills. When a video ends: an end card over everything — ↻ Watch
again / 🏠 My videos / up to 3 more from the same channel (older ones first, unwatched first). A parent's
Hide or a video that won't play returns to the feed with a friendly yellow note (no system pop-ups).

## Who's watching? (devices 2+ kids use)

Big rounded-square avatar tiles on `bg` (one colour per child), the name under each; 🔒 = has a PIN,
🌙 = a parent ended that child's session. The PIN pad: avatar + name, four dots that fill yellow, round
keys (72–88 pt), a shake + "Not quite — try again" on a wrong PIN, "Forgot it? Ask a grown-up…" — side by
side on phones in landscape. On the feed the avatar switches profile: little mode a rounded square (never
a circle — those are the channel bubbles), big mode the avatar by "Hi Simon" with a yellow ⇄ badge. Time's
up has a "Who's watching?" button so a sibling can watch. When it asks again: architecture → Pairing.

## Time's up / pairing / loading

- **Time's up** (End Session): 🌙 "Great watching, Simon! Time for a break. What will you do next?" + three
  activity cards (draw, build, read, dance, play outside, puzzle — a different three each day).
- **Pairing:** the code as six big letter tiles; "Ask a grown-up to open Kideos for Parents".
- **Loading:** the Kideos wordmark + spinner on `bg`.

## Accessibility

Every tappable has an `accessibilityLabel` (tiles read "title, channel, watched"); bubbles/chips expose
`selected`. **Reduce Motion** on → no squish (dims instead). Header collapse is scroll-driven (moves only
when the child scrolls).

## Not yet / later

- **TV:** focus states (yellow ring) on `Tap`, D-pad order, overscan margins — tokens are ready.
- A real mascot instead of the 🌙 / emoji placeholders; sounds / haptics (no libraries installed yet).
- "Continue watching" shelf (needs per-video progress, not only the owed video).
- iOS: fonts need `npx react-native-asset` once on a Mac (adds them to Xcode + Info.plist); the landscape
  lock and hidden bars are Android-only so far (iPad: `supportedInterfaceOrientations` in AppDelegate +
  `prefersHomeIndicatorAutoHidden`).
