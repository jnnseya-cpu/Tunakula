/**
 * The warm, appetising Tunakula palette, ported from the storefront's design system (globals.css) so the
 * app and the web read as one brand: cream paper, mango→appetite-red brand gradient, golden accents. A
 * food platform is never dark or grey; these are the mouth-watering colours the brand runs on.
 */
export const colors = {
  paper: "#fff7ee", // page background (warm cream)
  card: "#ffffff",
  ink: "#2a170e", // near-black warm brown for text
  muted: "#938073",
  line: "#efe2d4",
  yellow: "#ffb400", // golden brand
  orange: "#ff7a18", // mango
  tomato: "#e8382a", // appetite red
  good: "#1fa368",
  onBrand: "#fffaf2",
} as const;

// The brand gradient (mango → appetite red). React Native has no CSS gradient without a lib, so screens
// use these stops with expo-linear-gradient when added, or fall back to the solid `orange`.
export const brandGradient = ["#ffb400", "#ff7a18", "#e8382a"] as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const space = (n: number) => n * 4;

export const font = {
  display: { fontWeight: "800" as const, color: colors.ink },
  title: { fontSize: 20, fontWeight: "700" as const, color: colors.ink },
  body: { fontSize: 15, color: colors.ink },
  muted: { fontSize: 13, color: colors.muted },
  price: { fontSize: 15, fontWeight: "700" as const, color: colors.tomato },
} as const;
