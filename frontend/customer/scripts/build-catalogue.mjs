#!/usr/bin/env node
/**
 * Generate lib/catalogue.ts from the canonical storefront data (lib/catalogue.source.json,
 * imported from the live cd.tunakula.com catalogue) and the current exchange rate
 * (lib/fx-rate.json, written by scripts/fetch-fx.mjs).
 *
 *     npm run fx:update        -w @tunakula/web-customer   # refresh the rate (free, no key)
 *     npm run catalogue:build  -w @tunakula/web-customer   # re-rate and rewrite catalogue.ts
 *
 * Prices are the restaurants' own US-dollar menus, converted to CDF at the fetched rate and
 * rounded to the nearest 100 FC. catalogue.ts is generated — do not hand-edit it; edit the
 * source JSON (or re-import) and run this instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const src = JSON.parse(readFileSync(join(LIB, "catalogue.source.json"), "utf8"));
const fx = JSON.parse(readFileSync(join(LIB, "fx-rate.json"), "utf8"));
const RATE = fx.rate;
if (!(RATE > 0)) throw new Error(`fx-rate.json has no usable rate: ${JSON.stringify(fx)}`);

/** USD -> CDF at the current rate, rounded to the nearest 100 FC (a tidy counter price). */
const cdf = (usd) => Math.round((usd * RATE) / 100) * 100;
const s = (v) => JSON.stringify(String(v)); // safe double-quoted TS string

const out = [];
out.push(`/**
 * GENERATED FILE — do not edit by hand.
 * Real Tunakula RDC storefronts, imported from the live cd.tunakula.com catalogue on ${src.importedAt}.
 * Names, descriptions, menus, logos, covers and dish photos are the restaurants' own.
 * Prices are the restaurants' US-dollar menus, converted to Congolese francs at the live rate
 * below and rounded to the nearest 100 FC. Rebuild with:
 *   npm run fx:update       -w @tunakula/web-customer   (fetch a free live USD->CDF rate)
 *   npm run catalogue:build -w @tunakula/web-customer   (re-rate and rewrite this file)
 * At launch the same components read the live catalogue from the API (GET /v1/branches/{id}/menu).
 */
import type { Recipe } from "../components/plate";

/** USD -> CDF rate used for the prices below. Source: ${fx.source}; as of ${fx.asOf}. */
export const USD_TO_CDF = ${RATE};

export type MerchantKind = "Restaurant" | "Grill" | "Malewa" | "Bakery" | "Grocery";

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Congolese francs, whole francs (the kitchen's counter price). */
  readonly price: number;
  readonly recipe: Recipe;
  readonly tags?: readonly ("Popular" | "Spicy" | "Vegan" | "Vegetarian" | "Halal" | "New")[];
  readonly allergens?: readonly string[];
  /** For shops: the unit sold. */
  readonly unit?: string;
}

export interface Merchant {
  readonly slug: string;
  readonly name: string;
  readonly kind: MerchantKind;
  readonly cuisine: string;
  readonly commune: string;
  readonly landmark: string;
  readonly hours: string;
  readonly rating: number;
  readonly ratings: number;
  readonly location: { readonly lat: number; readonly lng: number };
  readonly prep: number;
  readonly monogram: string;
  readonly tone: { readonly bg: string; readonly fg: string; readonly accent: string };
  readonly cover: readonly [Recipe, Recipe, Recipe];
  readonly about: string;
  readonly menu: readonly { readonly section: string; readonly items: readonly MenuItem[] }[];
}
`);
out.push("export const MERCHANTS: readonly Merchant[] = [");
for (const m of src.merchants) {
  out.push("  {");
  out.push(`    slug: ${s(m.slug)},`);
  out.push(`    name: ${s(m.name)},`);
  out.push(`    kind: ${s(m.kind)},`);
  out.push(`    cuisine: ${s(m.cuisine)},`);
  out.push(`    commune: ${s(m.commune)},`);
  out.push(`    landmark: ${s(m.landmark)},`);
  out.push(`    hours: ${s(m.hours)},`);
  out.push(`    rating: ${m.rating},`);
  out.push(`    ratings: ${m.ratings},`);
  out.push(`    location: { lat: ${m.location.lat}, lng: ${m.location.lng} },`);
  out.push(`    prep: ${m.prep},`);
  out.push(`    monogram: ${s(m.monogram)},`);
  out.push(`    tone: { bg: ${s(m.tone.bg)}, fg: ${s(m.tone.fg)}, accent: ${s(m.tone.accent)} },`);
  out.push(`    cover: [${m.cover.map(s).join(", ")}],`);
  out.push(`    about: ${s(m.about)},`);
  out.push("    menu: [");
  for (const sec of m.menu) {
    out.push("      {");
    out.push(`        section: ${s(sec.section)},`);
    out.push("        items: [");
    for (const it of sec.items) {
      const parts = [`id: ${s(it.id)}`, `name: ${s(it.name)}`, `description: ${s(it.description)}`, `price: ${cdf(it.usd)}`, `recipe: ${s(it.recipe)}`];
      if (it.tags?.length) parts.push(`tags: [${it.tags.map(s).join(", ")}]`);
      if (it.allergens?.length) parts.push(`allergens: [${it.allergens.map(s).join(", ")}]`);
      if (it.unit) parts.push(`unit: ${s(it.unit)}`);
      out.push(`          { ${parts.join(", ")} },`);
    }
    out.push("        ],");
    out.push("      },");
  }
  out.push("    ],");
  out.push("  },");
}
out.push("];");
out.push(`
export const merchant = (slug: string) => MERCHANTS.find((m) => m.slug === slug);

/** "16 000 FC" — French grouping with a narrow no-break space, as on a Kinshasa receipt. */
export function fc(amount: number): string {
  return \`\${amount.toLocaleString("fr-FR").replace(/\\s/g, " ")} FC\`;
}

/** The dishes people order most, across merchants, for the home page. */
export function favourites(n = 8): { merchant: Merchant; item: MenuItem }[] {
  const out: { merchant: Merchant; item: MenuItem }[] = [];
  for (const m of MERCHANTS) for (const s of m.menu) for (const item of s.items) if (item.tags?.includes("Popular")) out.push({ merchant: m, item });
  return out.slice(0, n);
}
`);
writeFileSync(join(LIB, "catalogue.ts"), out.join("\n"));
const items = src.merchants.reduce((a, m) => a + m.menu.reduce((b, s) => b + s.items.length, 0), 0);
console.log(`Wrote catalogue.ts: ${src.merchants.length} merchants, ${items} items, at ${RATE} FC/USD (${fx.source}).`);
