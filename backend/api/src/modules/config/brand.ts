/**
 * Brands and theming (PRD §17.1). A brand is a design-token set — colours,
 * typography, radius, logos, app name, store listing — plus copy. Themes are
 * served at runtime in light and dark variants, so a market can change
 * colours without an app release. Contrast is validated against WCAG 2.2 AA
 * (§16.4, NFR-11) before a theme can be served.
 */
import { createHash } from "node:crypto";

export const COLOR_ROLES = ["primary", "secondary", "background", "surface", "error"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
type OnRole = `on${Capitalize<ColorRole>}`;

/** Each colour role is paired with the colour of text/icons drawn on it. */
export type ColorTokens = Readonly<Record<ColorRole | OnRole, string>>;

export interface ThemeTokens {
  readonly colors: ColorTokens;
  /** Corner radii in logical pixels. */
  readonly radius: { readonly small: number; readonly medium: number; readonly large: number };
  readonly typography: { readonly fontFamily: string; readonly baseSizePx: number; readonly scale: number };
}

export interface Theme {
  readonly id: string;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

export interface Brand {
  readonly id: string;
  readonly name: string;
  readonly appName: string;
  /** `print` is a monochrome logo for thermal printers, used on every printed document. */
  readonly logos: { readonly light: string; readonly dark: string; readonly print: string };
  readonly storeListing: { readonly title: string; readonly shortDescription: string };
  readonly themes: readonly Theme[];
  /** Brand copy keyed by message id, per locale (e.g. tagline). */
  readonly copy: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** WCAG 2.2 AA minimum for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new TypeError(`Invalid colour ${hex}; use #RRGGBB`);
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface BrandIssue {
  readonly path: string;
  readonly message: string;
}

export function validateBrand(brand: Brand): BrandIssue[] {
  const issues: BrandIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!/^[a-z0-9-]+$/.test(brand.id)) issue("id", "Brand id must be lowercase letters, digits and dashes");
  for (const key of ["name", "appName"] as const) if (!brand[key].trim()) issue(key, "Required");
  if (!brand.logos.light || !brand.logos.dark || !brand.logos.print) issue("logos", "Light, dark and print logos are required");
  if (brand.themes.length === 0) issue("themes", "At least one theme is required");
  const ids = new Set<string>();
  for (const theme of brand.themes) {
    if (ids.has(theme.id)) issue(`themes.${theme.id}`, "Duplicate theme id");
    ids.add(theme.id);
    for (const mode of ["light", "dark"] as const) {
      const t = theme[mode];
      const base = `themes.${theme.id}.${mode}`;
      for (const role of COLOR_ROLES) {
        const on = `on${role[0]?.toUpperCase()}${role.slice(1)}` as OnRole;
        const bg = t.colors[role];
        const fg = t.colors[on];
        if (!HEX.test(bg) || !HEX.test(fg)) {
          issue(`${base}.colors.${role}`, "Colours must be #RRGGBB");
          continue;
        }
        const ratio = contrastRatio(bg, fg);
        if (ratio < MIN_TEXT_CONTRAST) {
          issue(`${base}.colors.${on}`, `${fg} on ${bg} has contrast ${ratio.toFixed(2)}:1; WCAG AA needs ${MIN_TEXT_CONTRAST}:1`);
        }
      }
      const { small, medium, large } = t.radius;
      if (!(small >= 0 && small <= medium && medium <= large)) issue(`${base}.radius`, "Radii must satisfy 0 ≤ small ≤ medium ≤ large");
      // Low-end phones outdoors (§5.3): never below 14 px body text.
      if (t.typography.baseSizePx < 14) issue(`${base}.typography.baseSizePx`, "Body text must be at least 14 px");
      if (!t.typography.fontFamily.trim()) issue(`${base}.typography.fontFamily`, "Required");
    }
  }
  return issues;
}

/** Stable hash of a theme so apps can cache it and refetch only on change. */
export function themeVersion(theme: Theme): string {
  return createHash("sha256").update(JSON.stringify(theme)).digest("hex").slice(0, 16);
}

const typography = { fontFamily: "Inter", baseSizePx: 16, scale: 1.25 };
const radius = { small: 4, medium: 8, large: 16 };

/**
 * Groupe Nseya internal brand for the Admin app and web console (§17.1).
 * Teal #1BA996 fails AA with white text (≈2.9:1), so text on teal is near-black.
 */
export const GROUP_INTERNAL_BRAND: Brand = {
  id: "nseya-group",
  name: "Groupe Nseya",
  appName: "Tunakula Admin",
  logos: { light: "asset://brand/nseya-group/logo-light", dark: "asset://brand/nseya-group/logo-dark", print: "asset://brand/nseya-group/logo-print" },
  storeListing: { title: "Tunakula Admin", shortDescription: "Operations for Tunakula country and group teams" },
  themes: [
    {
      id: "nseya-teal",
      light: {
        colors: {
          primary: "#1BA996",
          onPrimary: "#0B1F1C",
          secondary: "#0E5C52",
          onSecondary: "#FFFFFF",
          background: "#FFFFFF",
          onBackground: "#111827",
          surface: "#F3F6F6",
          onSurface: "#111827",
          error: "#B3261E",
          onError: "#FFFFFF",
        },
        radius,
        typography,
      },
      dark: {
        colors: {
          primary: "#1BA996",
          onPrimary: "#0B1F1C",
          secondary: "#7FD8CA",
          onSecondary: "#0B1F1C",
          background: "#0F1716",
          onBackground: "#E6EFEE",
          surface: "#17211F",
          onSurface: "#E6EFEE",
          error: "#F2B8B5",
          onError: "#601410",
        },
        radius,
        typography,
      },
    },
  ],
  copy: {},
};

/**
 * Customer-facing Tunakula brand. Colours are sampled from the Tunakula logo
 * (shared/brand/tunakula-logo.jpg): navy #1F305D, yellow #FAD20E, orange #EB771A.
 * Yellow carries navy text (8.7:1, as in the logo's lettering); orange is never a
 * background for text (white on orange is 2.9:1), so it is not a colour role here.
 */
export const TUNAKULA_BRAND: Brand = {
  id: "tunakula",
  name: "Tunakula",
  appName: "Tunakula",
  logos: { light: "asset://brand/tunakula/logo-light", dark: "asset://brand/tunakula/logo-dark", print: "asset://brand/tunakula/logo-print" },
  storeListing: { title: "Tunakula — food delivery", shortDescription: "Order food in your currency, at home or for family abroad" },
  themes: [
    {
      id: "tunakula-default",
      light: {
        colors: {
          primary: "#FAD20E",
          onPrimary: "#1F305D",
          secondary: "#1F305D",
          onSecondary: "#FFFFFF",
          background: "#FFFFFF",
          onBackground: "#141B33",
          surface: "#FFF9EC",
          onSurface: "#141B33",
          error: "#B3261E",
          onError: "#FFFFFF",
        },
        radius: { small: 6, medium: 12, large: 20 },
        typography,
      },
      dark: {
        colors: {
          primary: "#FAD20E",
          onPrimary: "#1F305D",
          secondary: "#FFB066",
          onSecondary: "#0E1630",
          background: "#0E1630",
          onBackground: "#F1F3FA",
          surface: "#1F305D",
          onSurface: "#FFF8E1",
          error: "#F2B8B5",
          onError: "#601410",
        },
        radius: { small: 6, medium: 12, large: 20 },
        typography,
      },
    },
  ],
  copy: { tagline: { en: "Get to eat", fr: "Tunakula — on mange ensemble" } },
};
