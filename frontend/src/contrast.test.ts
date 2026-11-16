import { describe, expect, it } from "vitest";

import { AA, contrast } from "./contrast";

/**
 * Every text colour the app paints must meet WCAG AA (4.5:1) on the grounds it
 * actually sits on, in both themes.
 *
 * The palette below MIRRORS index.css (the @theme block and the
 * [data-theme="dark"] block) by hand, because jsdom does not evaluate CSS
 * custom properties. Changing a colour token there means updating it here,
 * which is the point: a silent contrast regression should break the build.
 * Tailwind colours the theme doesn't define fall back to Tailwind's own values
 * and are NOT dark-tuned, so they carry the same hex in both themes.
 *
 * The source scan at the bottom keeps the proof honest in both directions: a
 * text colour used in the code with no proof here fails, and so does a proof
 * for a colour nothing uses any more. When you add a text colour, add its proof.
 */

const LIGHT = {
  // Page grounds.
  surface: "#ececE9", // cards, tables, inputs, buttons, MetricTile neutral
  canvas: "#f5f5f3", // slate-50: the page and modals
  sidebar: "#ffffff",
  // Greys.
  "slate-100": "#f0f0ed",
  "slate-400": "#6a6a6a",
  "slate-500": "#5e5e5e",
  "slate-600": "#555555",
  "slate-700": "#333333",
  "slate-800": "#2a2a2a",
  "slate-900": "#1a1a1a",
  // Accents (theme-defined).
  "blue-100": "#e6f1fb",
  "blue-700": "#185fa5",
  "red-100": "#fcebeb",
  "red-600": "#a32d2d",
  "amber-100": "#faeeda",
  "amber-700": "#854f0b",
  "emerald-100": "#eaf3de",
  "emerald-700": "#3b6d11",
  // Tailwind defaults in light, dark-tuned in the dark block.
  "amber-50": "#fffbeb",
  "amber-800": "#973c00",
} as const;

type Token = keyof typeof LIGHT;

const DARK: Record<Token, string> = {
  surface: "#26241f",
  canvas: "#1c1b19",
  sidebar: "#171614",
  "slate-100": "#26241f",
  "slate-400": "#a19b91",
  "slate-500": "#aba59a",
  "slate-600": "#b7b1a6",
  "slate-700": "#d6d0c5",
  "slate-800": "#e7e1d6",
  "slate-900": "#f3ede2",
  "blue-100": "#17293b",
  "blue-700": "#82b6e6",
  "red-100": "#3a1e1e",
  "red-600": "#e88c8c",
  "amber-100": "#3a2d16",
  "amber-700": "#e4b878",
  "emerald-100": "#22301a",
  "emerald-700": "#a0ce70",
  "amber-50": "#2a2210",
  "amber-800": "#e8c07a",
};

const PALETTES = { light: LIGHT, dark: DARK } as const;
type Theme = keyof typeof PALETTES;

/** Text on the page: cards / tables / inputs (surface), the canvas between them and modals. */
const PAGE: Token[] = ["surface", "canvas"];

/**
 * The proof for each text colour in use: the grounds it is painted on (checked
 * in both themes unless `themes` narrows it), or `exempt` with the reason it
 * is not body text.
 */
type Proof = { on: Token[]; themes?: Theme[] } | { exempt: string };

const PROOFS: Record<string, Proof[]> = {
  // Greys: body, secondary and muted text on every page, plus the sidebar (app
  // name, nav links, footer) and the settings menu.
  "slate-400": [{ on: PAGE }], // MetricTile sub-labels, empty states
  "slate-500": [{ on: [...PAGE, "sidebar", "slate-100"] }], // + table heads, badges
  "slate-600": [{ on: [...PAGE, "sidebar"] }],
  "slate-700": [{ on: PAGE }], // secondary buttons
  "slate-800": [{ on: [...PAGE, "sidebar"] }],
  "slate-900": [{ on: [...PAGE, "sidebar"] }],
  // Primary buttons: surface-coloured ink on a slate-900 fill (and its slate-700 hover).
  surface: [{ on: ["slate-900", "slate-700"] }],
  // Links and accents.
  "blue-700": [{ on: [...PAGE, "blue-100"] }], // TabBar links, loc badge, Avatar
  "red-600": [{ on: [...PAGE, "red-100"] }], // errors, required markers, error banner
  "amber-700": [{ on: ["amber-100"] }], // "Not set up" / uat badges, warning banner
  "amber-800": [{ on: ["amber-50"] }], // "not configured" banners
  "emerald-700": [{ on: ["emerald-100"] }], // "Set up" / sbx badges
  // Not body text.
  white: [{ exempt: "the scroll-to-top button's arrow icon (a graphic, not text)" }],
};

describe("text contrast", () => {
  it("sanity-checks the formula against known ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const [colour, proofs] of Object.entries(PROOFS)) {
    for (const proof of proofs) {
      if ("exempt" in proof) continue;
      for (const theme of proof.themes ?? (["light", "dark"] as Theme[])) {
        const palette = PALETTES[theme];
        for (const ground of proof.on) {
          it(`${theme}: text-${colour} on ${ground} meets AA`, () => {
            const ink = palette[colour as Token];
            expect(ink, `no ${theme} value mirrored for ${colour}`).toBeDefined();
            expect(contrast(ink, palette[ground])).toBeGreaterThanOrEqual(AA);
          });
        }
      }
    }
  }
});

// --- Source scan -------------------------------------------------------------

/** Every non-test source file, as raw text (Vite's glob import; works in node). */
const SOURCES = import.meta.glob<string>(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Colour families a `text-*` class can name (sizes / alignment are skipped). */
const TEXT_COLOUR =
  /(?<![\w-])(?:[a-z-]+:)*text-((?:slate|blue|red|amber|emerald|indigo|green|yellow|gray)-\d{2,3}|surface|white|black)(?![\w-])/g;

function usedTextColours(): Set<string> {
  const used = new Set<string>();
  for (const source of Object.values(SOURCES)) {
    for (const match of source.matchAll(TEXT_COLOUR)) used.add(match[1]);
  }
  return used;
}

describe("text colour proofs match the code", () => {
  const used = usedTextColours();

  it("finds the sources (guards against an empty glob)", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    expect(used.size).toBeGreaterThan(5);
  });

  it("proves every text colour the code paints", () => {
    const unproven = [...used].filter((colour) => !(colour in PROOFS)).sort();
    expect(unproven, "text colours used with no proof in contrast.test.ts").toEqual([]);
  });

  it("proves nothing the code no longer paints", () => {
    const stale = Object.keys(PROOFS).filter((colour) => !used.has(colour)).sort();
    expect(stale, "proofs for text colours nothing uses (delete them)").toEqual([]);
  });
});
