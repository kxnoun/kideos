// ─────────────────────────────────────────────────────────────
// Kideos Kid App — design system
//
// Based on the Oct 20 research (docs/kid-app-design.md): a deep-purple "Twilight"
// base so thumbnails are the brightest thing on screen, Sunset Orange for actions
// (always with Ink text — white on orange fails contrast), Sunny Yellow for focus.
// Fonts: Fredoka (headings/buttons) + Nunito (titles/body), both SIL OFL.
//
// Two modes from the child's age: "little" (≈2–7, pre-readers: pictures, one
// horizontal strip, no vertical scrolling) and "big" (≈8–12: rows of shelves).
// Layout sizes come from the WINDOW width (useLayout), so phones, tablets,
// rotation and split screen all work; TV later = same tokens, bigger class.
// ─────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

export const colors = {
  bg: "#1E1442", // Night Grape — white text 17:1
  surface: "#2D2062", // Grape Card
  surfacePressed: "#3D2C85", // Plum
  text: "#FFFFFF",
  textSecondary: "#C9BFF0", // Lilac Mist — 9.9:1 on bg
  brand: "#6C3CE9", // Kideos Purple — white text 6.1:1
  brandOnDark: "#A98BFF", // Lavender — rings, icons on bg (6.3:1)
  action: "#FF8A2B", // Sunset Orange — fills with INK labels only (7.1:1)
  ink: "#1F1A33", // text on orange / yellow / light
  focus: "#FFD23F", // Sunny Yellow — focus / highlight (11.8:1 on bg)
  success: "#3DDC97", // Mint — "watched" (always with a ✓)
  error: "#FF6B6B", // Soft Coral — always with a shake / icon
  disabled: "#5A4E8C",
  overlay: "rgba(14, 8, 36, 0.72)",
} as const;

export const fonts = {
  display: "Fredoka-SemiBold",
  displayBold: "Fredoka-Bold",
  body: "Nunito-Bold",
  bodyHeavy: "Nunito-ExtraBold",
} as const;

export type Mode = "little" | "big";
export type SizeClass = "compact" | "medium" | "expanded" | "large";

export function modeForAge(age: number | undefined): Mode {
  return age !== undefined && age > 0 && age <= 7 ? "little" : "big";
}

// Window-size classes (Android's, used on both platforms): by width, not device type
function sizeClassFor(width: number): SizeClass {
  if (width < 600) return "compact";
  if (width < 840) return "medium";
  if (width < 1200) return "expanded";
  return "large";
}

const MARGIN: Record<SizeClass, number> = { compact: 16, medium: 24, expanded: 32, large: 40 };
const GAP: Record<SizeClass, number> = { compact: 12, medium: 16, expanded: 20, large: 24 };
// How many tiles are visible across — the fraction is a deliberate "there's more" peek
const LITTLE_VISIBLE: Record<SizeClass, number> = { compact: 1.3, medium: 1.6, expanded: 2.5, large: 3.2 };
const BIG_VISIBLE: Record<SizeClass, number> = { compact: 2.2, medium: 3.2, expanded: 4.3, large: 5.3 };
const GRID_COLUMNS: Record<SizeClass, number> = { compact: 2, medium: 3, expanded: 4, large: 5 };

export interface Layout {
  width: number;
  height: number;
  landscape: boolean;
  sizeClass: SizeClass;
  phone: boolean; // shortest side < 600 — a phone in landscape is wide but still a phone
  margin: number;
  gap: number;
  // little mode
  stripTileW: number;
  stripTileH: number;
  bubble: number; // channel bubble diameter
  // big mode
  rowTileW: number;
  rowTileH: number;
  shortTileW: number;
  shortTileH: number;
  gridColumns: number;
  gridTileW: number;
  gridTileH: number;
  // shared
  touch: number; // big round buttons (back etc.)
  scale: number; // type scale (0.9 on phones)
}

function tileWidth(width: number, margin: number, gap: number, visible: number): number {
  return Math.floor((width - 2 * margin - gap * (Math.ceil(visible) - 1)) / visible);
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const sizeClass = sizeClassFor(width);
    const margin = MARGIN[sizeClass];
    const gap = GAP[sizeClass];
    const compact = sizeClass === "compact";
    const landscape = width > height;
    const phone = Math.min(width, height) < 600;

    // Little: the strip fills the screen under the bubble band, so cap the tile by height too
    let stripTileW = tileWidth(width, margin, gap, LITTLE_VISIBLE[sizeClass]);
    const bubble = phone ? 76 : Math.min(width, height) < 840 ? 96 : 112;
    const maxStripH = height - (bubble + 48) - 48 - 72; // bubble band + wrist zone + title
    if (stripTileW * 0.5625 > maxStripH) stripTileW = Math.floor(maxStripH / 0.5625);

    const rowTileW = Math.max(compact ? 150 : 200, tileWidth(width, margin, gap, BIG_VISIBLE[sizeClass]));
    const gridColumns = GRID_COLUMNS[sizeClass];
    const gridTileW = Math.floor((width - 2 * margin - gap * (gridColumns - 1)) / gridColumns);
    const shortTileW = Math.round(rowTileW * 0.62);

    return {
      width,
      height,
      landscape,
      sizeClass,
      phone,
      margin,
      gap,
      stripTileW,
      stripTileH: Math.round(stripTileW * 0.5625),
      bubble,
      rowTileW,
      rowTileH: Math.round(rowTileW * 0.5625),
      shortTileW,
      shortTileH: Math.round(shortTileW * 1.6),
      gridColumns,
      gridTileW,
      gridTileH: Math.round(gridTileW * 0.5625),
      touch: phone ? 64 : 80,
      scale: phone ? 0.9 : 1,
    };
  }, [width, height]);
}

// Type tokens (sizes scaled by layout.scale at the call site)
export const type = {
  greeting: { fontFamily: fonts.display, fontSize: 34 },
  greetingCompact: { fontFamily: fonts.display, fontSize: 22 },
  rowTitle: { fontFamily: fonts.display, fontSize: 24 },
  tileTitle: { fontFamily: fonts.bodyHeavy, fontSize: 18, lineHeight: 24 },
  meta: { fontFamily: fonts.body, fontSize: 15 },
  button: { fontFamily: fonts.display, fontSize: 22 },
  big: { fontFamily: fonts.displayBold, fontSize: 40 },
} as const;

export const radius = { tile: 20, card: 24, pill: 999 } as const;
