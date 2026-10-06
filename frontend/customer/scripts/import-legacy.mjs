#!/usr/bin/env node
/**
 * Import every restaurant the live Tunakula RDC catalogue currently serves — all zones, full menus,
 * logos, covers and dish photos — and regenerate lib/catalogue.source.json plus the images in
 * public/photos. This is the one command that keeps the website's storefronts in step with the
 * platform:
 *
 *     npm run import:legacy    -w @tunakula/web-customer   # pull every served restaurant + photos
 *     npm run fx:update        -w @tunakula/web-customer   # refresh the USD->CDF rate (free, no key)
 *     npm run catalogue:build  -w @tunakula/web-customer   # rebuild catalogue.ts from the two above
 *
 * It only ever sees what the catalogue API publishes: restaurants that are active, approved and in a
 * served zone. Restaurants still pending approval, disabled, or not assigned to a live zone are
 * withheld by the platform from every public endpoint, so they appear here automatically the moment
 * they are activated in the admin panel — nothing else to change.
 *
 * Source API (CORS-open, no auth): NEXT_PUBLIC_LEGACY_API, default https://cd.tunakula.com/api/v1.
 * Dietary flags (is_halal/veg) on the source platform are blanket defaults (even pork is flagged
 * halal), so they are deliberately NOT imported as claims.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "lib");
const PHOTOS = join(HERE, "..", "public", "photos");
const API = process.env.NEXT_PUBLIC_LEGACY_API ?? "https://cd.tunakula.com/api/v1";
const REF = { lat: "-4.3006", lng: "15.3106" };

const headers = (zone) => ({
  "X-localization": "fr",
  "Accept": "application/json",
  "zoneId": zone == null ? "[1]" : `[${zone}]`,
  "latitude": REF.lat,
  "longitude": REF.lng,
  "moduleId": "1",
});

async function getJSON(path, zone) {
  const res = await fetch(`${API}${path}`, { headers: headers(zone) });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// ── classification helpers (kept deliberately simple; real photos override the fallback art) ──
const COMMUNES = ["Gombe", "Limete", "Kintambo", "Kalamu", "Ngaliema", "Barumbu", "Lingwala", "Masina", "Ngaba", "Bandalungwa", "Lemba", "Matete", "Kasa-Vubu", "Selembao", "Mont-Ngafula", "Ngiri-Ngiri", "Ndjili", "Kimbanseke", "Kisenso", "Makala", "Bumbu", "Nsele", "Maluku", "Kinshasa"];
const communeOf = (a = "") => COMMUNES.find((c) => a.toLowerCase().includes(c.toLowerCase())) ?? "Kinshasa";

const RECIPE_KW = [
  [["poisson", "fish", "thon", "mbisi", "tilapia", "capitaine", "mackerel", "makayabu", "fume"], "poisson"],
  [["moambe", "mwambe", "palm"], "moambe"],
  [["pondu", "saka", "spinach", "epinard"], "pondu"],
  [["fumbwa"], "fumbwa"],
  [["liboke", "maboke"], "liboke"],
  [["makemba", "plantain", "banane"], "makemba"],
  [["brochette", "skewer", "grill", "braise", "viande", "boeuf", "chevre", "poulet", "chicken", "porc"], "brochettes"],
  [["mbika", "pistache", "courge", "pumpkin"], "mbika"],
  [["jus", "juice", "boisson", "drink", "eau", "cocktail", "soda", "cafe"], "jus"],
  [["beignet", "mikate", "donut", "gateau", "cake", "dessert", "glace", "crepe", "sucre"], "beignets"],
  [["pain", "baguette", "bread", "sandwich", "wrap", "burger", "hamburger", "pizza", "taco", "frites", "fries", "croissant"], "pain"],
  [["riz", "rice", "loso"], "riz"],
  [["chikwangue", "kwanga", "fufu"], "chikwangue"],
  [["fruit", "mangue", "orange", "ananas", "salade", "legume", "veget", "haricot", "pomme", "avocat"], "fruits"],
];
const recipeOf = (name, cat) => {
  const s = `${name} ${cat}`.toLowerCase();
  for (const [kws, r] of RECIPE_KW) if (kws.some((k) => s.includes(k))) return r;
  return "poisson";
};

const TONES = [
  { bg: "#7e2a10", fg: "#fbefe4", accent: "#e9a24a" }, { bg: "#1f5a50", fg: "#eef6f2", accent: "#f2b84b" },
  { bg: "#27402a", fg: "#eef0e2", accent: "#d9b24a" }, { bg: "#2a1d16", fg: "#f3e6d6", accent: "#e0643a" },
  { bg: "#8a5a22", fg: "#fff4e3", accent: "#f2c46a" }, { bg: "#1f305d", fg: "#eef2ff", accent: "#fad20e" },
  { bg: "#5a1f3d", fg: "#fbe9f3", accent: "#e98ab8" }, { bg: "#20463f", fg: "#e7f3ee", accent: "#67c9a3" },
];

const strip = (s) => (s ?? "").toString().trim();
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const extOf = (url) => { const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url || ""); const e = m ? m[1].toLowerCase() : "jpg"; return e.length <= 4 ? e : "jpg"; };

async function buildCategoryMap() {
  const map = {};
  const top = await getJSON(`/categories`, 1);
  for (const c of top) map[String(c.id)] = c.name;
  await Promise.all(top.map(async (c) => {
    try { for (const ch of await getJSON(`/categories/childes/${c.id}`, 1)) map[String(ch.id)] = ch.name; }
    catch { /* a child fetch failing just leaves that id to fall back to "Menu" */ }
  }));
  await writeFile(join(LIB, "legacy-categories.json"), JSON.stringify(map, null, 0) + "\n");
  return map;
}

async function listRestaurants() {
  const zones = await getJSON(`/zone/list`, 1);
  const byId = new Map();
  for (const z of zones) {
    let data;
    try { data = await getJSON(`/restaurants/get-restaurants/all?offset=1&limit=200`, z.id); }
    catch { continue; }
    for (const r of data.restaurants ?? []) if (!byId.has(r.id)) byId.set(r.id, { id: r.id, zone: z.id });
  }
  return [...byId.values()];
}

async function downloadPhoto(url, base) {
  if (!url) return undefined;
  const existing = (await readdir(PHOTOS)).find((f) => f.slice(0, f.lastIndexOf(".")) === base);
  if (existing) return `/photos/${existing}`;
  const ext = extOf(url);
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) return undefined;
  await writeFile(join(PHOTOS, `${base}.${ext}`), buf);
  return `/photos/${base}.${ext}`;
}

async function importRestaurant({ id, zone }, catName, toneIndex) {
  const d = await getJSON(`/restaurants/details/${id}`, zone);
  if (!d || !d.id) return null;
  const slug = d.slug || slugify(d.name);
  const foods = (await getJSON(`/products/latest?restaurant_id=${id}&category_id=0&limit=200&offset=1`, zone)).products ?? [];

  await downloadPhoto(d.logo_full_url, `logo-${slug}`);
  await downloadPhoto(d.cover_photo_full_url, `cover-${slug}`);

  const ranked = [...foods].sort((a, b) => (b.order_count ?? b.sell_count ?? 0) - (a.order_count ?? a.sell_count ?? 0));
  const popular = new Set(ranked.slice(0, 2).filter((p) => (p.order_count ?? p.sell_count ?? 0) > 0).map((p) => p.id));

  const sections = new Map();
  const cover = [];
  for (const p of foods) {
    const cat = catName[String(p.category_id)] ?? "Menu";
    const recipe = recipeOf(p.name, cat);
    if (cover.length < 3 && !cover.includes(recipe)) cover.push(recipe);
    const tags = [];
    if (popular.has(p.id) || p.recommended) tags.push("Popular");
    const nm = `${p.name} ${cat}`.toLowerCase();
    if (["pili", "epic", "piment"].some((k) => nm.includes(k))) tags.push("Spicy");
    const itemId = `${slug}--${p.id}`;
    // Dish photos are served from the live catalogue URL (committing ~2,000 of them would bloat the
    // repo). Only logos and covers are stored locally, for the cards and storefront headers.
    const list = sections.get(cat) ?? [];
    list.push({ id: itemId, name: strip(p.name), description: strip(p.description), usd: Math.round((Number(p.price) || 0) * 100) / 100, recipe, photo: p.image_full_url || "", tags: [...new Set(tags)], allergens: [] });
    sections.set(cat, list);
  }
  while (cover.length < 3) cover.push("poisson");

  const cuisines = (d.cuisine ?? []).map((c) => c.name);
  const schedules = d.schedules ?? [];
  let hours = "—";
  if (schedules.length) {
    const first = schedules[0];
    hours = `${(first.opening_time || "").slice(0, 5)} – ${(first.closing_time || "").slice(0, 5)}`;
  }
  const mono = (strip(d.name).replace(/[^A-Za-zÀ-ÿ ]/g, "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || d.name.slice(0, 2)).toUpperCase();

  return {
    slug, legacyId: id, zone,
    logoUrl: d.logo_full_url || "", coverUrl: d.cover_photo_full_url || "",
    name: strip(d.name), kind: "Restaurant", cuisine: cuisines.join(", ") || "Restaurant",
    commune: communeOf(d.address), landmark: strip(d.address), hours,
    rating: Math.round((Number(d.avg_rating) || 0) * 10) / 10, ratings: Number(d.rating_count) || 0,
    location: { lat: Math.round((Number(d.latitude) || -4.3006) * 1e6) / 1e6, lng: Math.round((Number(d.longitude) || 15.3106) * 1e6) / 1e6 },
    prep: 18, monogram: mono, tone: TONES[toneIndex % TONES.length],
    cover, about: strip(d.meta_description) || `${cuisines.join(", ") || "Restaurant"} — ${strip(d.address) || "Kinshasa"}.`,
    menu: [...sections.entries()].map(([section, items]) => ({ section, items })),
  };
}

async function main() {
  await mkdir(PHOTOS, { recursive: true });
  console.log(`Importing from ${API} …`);
  const catName = await buildCategoryMap();
  const refs = await listRestaurants();
  console.log(`Catalogue currently serves ${refs.length} restaurant(s): ${refs.map((r) => `#${r.id}(z${r.zone})`).join(", ")}`);

  const merchants = [];
  let i = 0;
  for (const ref of refs) {
    try {
      const m = await importRestaurant(ref, catName, i++);
      if (m) { merchants.push(m); console.log(`  ✓ ${m.name} — ${m.menu.reduce((n, s) => n + s.items.length, 0)} items`); }
    } catch (e) { console.warn(`  ✗ #${ref.id}: ${e.message}`); }
  }

  const src = {
    _note: "Canonical storefront data imported from the live Tunakula RDC catalogue by scripts/import-legacy.mjs. Prices are the restaurants' own US-dollar menus; scripts/build-catalogue.mjs converts them to CDF using scripts/fetch-fx.mjs. Do not hand-edit catalogue.ts.",
    importedAt: new Date().toISOString().slice(0, 10),
    source: API,
    merchants,
  };
  await writeFile(join(LIB, "catalogue.source.json"), JSON.stringify(src, null, 2) + "\n");
  console.log(`\nWrote catalogue.source.json: ${merchants.length} restaurant(s). Next: npm run fx:update && npm run catalogue:build`);
}

main().catch((e) => { console.error(e); process.exit(1); });
