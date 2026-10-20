# Kid app design

The kid app's look and layout (Oct 20, 2026). Code: `apps/Kideos/src/theme.ts` (tokens + `useLayout`),
`src/components/Tap.tsx`, `src/components/VideoTile.tsx`, `src/screens/*`, `App.tsx`.

## Principles

- **Thumbnails are the brightest thing on screen.** A deep-purple base ("Twilight") so the videos pop,
  not the chrome. Dark also suits evening viewing and TVs later.
- **Pictures before words.** The youngest users can't read: channel pictures and emoji carry meaning;
  text is a label, never the only cue. Colour is never the only cue either (✓ on watched, emoji on chips).
- **Big, forgiving targets.** Small hands and imprecise taps: buttons ≥ 64 pt (80 on tablets), chips 48 pt,
  `hitSlop` 12, feedback on press-**in** (a squish), no long-press / double-tap / pull-to-refresh, video
  taps debounced 600 ms (excited double taps).
- **Calm, not sticky.** No autoplay, no infinite feed (big mode ends with "You've seen all your
  channels! 🎉"), the end of a video is a choice (Watch again / My videos / 3 more), and Time's up offers
  things to do offline instead of a scolding.
- **Responsive by window, not device.** Everything is sized from `useWindowDimensions` — phones,
  tablets, rotation and split screen all work; TV later = the same tokens at a bigger size class.

## Two modes (from the child's age, live from the child doc)

| | **Little** (age ≤ 7) | **Big** (8+) |
|---|---|---|
| Home | A band of round **bubbles** on top: the child's avatar, ⭐ New, ⚡ Shorts, then each channel's picture. Tapping a bubble swaps the **one sideways film strip** below (big tiles, ~1.3 visible on a phone, ~2.5 on a tablet). No vertical scrolling. Nothing in the bottom 48 pt (where wrists rest on a tablet). | **Shelves** like YouTube Kids: ✨ New (15), ⚡ Shorts (20, tall tiles), one row per channel (12 + a "See all" tile), then the end cap. |
| Header | None — no greeting text for pre-readers. | "Hi Simon 👋" + a bar of jump-chips (one per shelf). Scrolling collapses it: the greeting fades and slides away (48–60 pt), the chip bar stays pinned (64 pt) and highlights the shelf you're on; tapping a chip scrolls to it. |
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

## Player

Dark screen: a big orange ← and the title on top; the player as large as the window allows (landscape fits
the height — nothing cut off); in portrait, "More from <channel>" underneath. Banners ("Watch a little
more! 0:12 left", "Nice try 😄") are yellow pills. When a video ends: an end card over everything — ↻ Watch
again / 🏠 My videos / up to 3 more from the same channel (older ones first, unwatched first). A parent's
Hide or a video that won't play returns to the feed with a friendly yellow note (no system pop-ups).

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
- **Several kids per device** ("Who's watching?" + optional PIN) — backlog #2.
- A real mascot instead of the 🌙 / emoji placeholders; sounds / haptics (no libraries installed yet).
- "Continue watching" shelf (needs per-video progress, not only the owed video).
- iOS: fonts need `npx react-native-asset` once on a Mac (adds them to Xcode + Info.plist).
