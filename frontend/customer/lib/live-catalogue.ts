/**
 * Live storefront data, read straight from the Tunakula RDC catalogue API in the browser.
 *
 * The marketing storefronts normally render a committed snapshot (catalogue.ts) so the static
 * site is never blank and works without JavaScript or SEO. These helpers let a client component
 * refresh that snapshot from the live catalogue, so names, menus, prices and photos stay current
 * without a rebuild. The API is CORS-open (access-control-allow-origin: *), so no proxy is needed.
 *
 * Prices on the source platform are in US dollars; they are converted to Congolese francs with a
 * live rate (fetched once per load, falling back to the build-time USD_TO_CDF) and rounded to the
 * nearest 100 FC, exactly as scripts/build-catalogue.mjs does for the snapshot, so the runtime
 * money path stays in whole francs.
 */
import type { Merchant, MenuItem } from "./catalogue";
import { USD_TO_CDF } from "./catalogue";

/** Base of the live catalogue API. Overridable so the same code can point at a mirror or the new backend. */
export const LEGACY_API = process.env.NEXT_PUBLIC_LEGACY_API ?? "https://cd.tunakula.com/api/v1";

const h = (zone: number) => ({
  "zoneId": `[${zone}]`,
  "X-localization": "fr",
  "Accept": "application/json",
  "latitude": "-4.3006",
  "longitude": "15.3106",
});

async function getJSON<T>(path: string, zone: number, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${LEGACY_API}${path}`, { headers: h(zone), signal });
  if (!res.ok) throw new Error(`live API ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The live USD -> CDF rate, from a free no-key provider; falls back to the build-time rate. */
let ratePromise: Promise<number> | undefined;
export function liveRate(): Promise<number> {
  if (ratePromise) return ratePromise;
  ratePromise = (async () => {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", { headers: { accept: "application/json" } });
      if (res.ok) {
        const j = (await res.json()) as { rates?: { CDF?: number } };
        if (j.rates?.CDF && j.rates.CDF > 0) return Math.round(j.rates.CDF);
      }
    } catch { /* restricted network: use the build-time rate */ }
    return USD_TO_CDF;
  })();
  return ratePromise;
}

const cdf = (usd: number, rate: number) => Math.round((usd * rate) / 100) * 100;

interface LegacyRestaurant {
  id: number; name: string; slug?: string; address?: string; latitude?: string; longitude?: string;
  avg_rating?: number; rating_count?: number; logo_full_url?: string | null; cover_photo_full_url?: string | null;
  cuisine?: { name: string }[];
}
interface LegacyProduct {
  id: number; name: string; description?: string | null; price: number; category_id?: number;
  image_full_url?: string | null; recommended?: number; order_count?: number; sell_count?: number;
}

const COMMUNES = ["Gombe", "Limete", "Kintambo", "Kalamu", "Ngaliema", "Barumbu", "Lingwala", "Masina", "Ngaba", "Bandalungwa", "Lemba", "Matete", "Kasa-Vubu", "Selembao", "Mont-Ngafula", "Kinshasa"];
const communeOf = (addr?: string) => COMMUNES.find((c) => (addr ?? "").toLowerCase().includes(c.toLowerCase())) ?? "Kinshasa";

/** One live merchant (card data), with a remote cover/logo URL. Extends the snapshot Merchant. */
export interface LiveMerchant extends Merchant {
  readonly legacyId: number;
  readonly zone: number;
  /** Remote image URLs from the live platform (shown directly; no local file needed). */
  readonly coverUrl?: string;
  readonly logoUrl?: string;
}

/** A menu item that may carry a remote photo URL. */
export interface LiveMenuItem extends MenuItem {
  readonly photo?: string;
}

function mapRestaurant(r: LegacyRestaurant, zone: number, snapshot?: Merchant): LiveMerchant {
  const cuisines = (r.cuisine ?? []).map((c) => c.name);
  return {
    slug: r.slug ?? snapshot?.slug ?? `r-${r.id}`,
    legacyId: r.id,
    zone,
    name: r.name,
    kind: snapshot?.kind ?? "Restaurant",
    cuisine: cuisines.join(", ") || snapshot?.cuisine || "Restaurant",
    commune: communeOf(r.address),
    landmark: r.address ?? snapshot?.landmark ?? "",
    hours: snapshot?.hours ?? "—",
    rating: Math.round((Number(r.avg_rating) || 0) * 10) / 10,
    ratings: Number(r.rating_count) || 0,
    location: { lat: Number(r.latitude) || snapshot?.location.lat || -4.3006, lng: Number(r.longitude) || snapshot?.location.lng || 15.3106 },
    prep: snapshot?.prep ?? 18,
    monogram: snapshot?.monogram ?? r.name.slice(0, 2).toUpperCase(),
    tone: snapshot?.tone ?? { bg: "#1f305d", fg: "#eef2ff", accent: "#fad20e" },
    cover: snapshot?.cover ?? ["poisson", "riz", "makemba"],
    about: snapshot?.about ?? cuisines.join(", "),
    menu: snapshot?.menu ?? [],
    coverUrl: r.cover_photo_full_url ?? undefined,
    logoUrl: r.logo_full_url ?? undefined,
  };
}

/** Live list of restaurants across the given zones, each enriched from its snapshot when available. */
export async function fetchLiveMerchants(zones: readonly number[], bySlug: Map<string, Merchant>, signal?: AbortSignal): Promise<LiveMerchant[]> {
  const out: LiveMerchant[] = [];
  const seen = new Set<number>();
  for (const zone of zones) {
    const data = await getJSON<{ restaurants: LegacyRestaurant[] }>(`/restaurants/get-restaurants/all?offset=1&limit=100`, zone, signal);
    for (const r of data.restaurants ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(mapRestaurant(r, zone, bySlug.get(r.slug ?? "")));
    }
  }
  return out;
}

/** Live menu for one restaurant, mapped to the snapshot's section/item shape with remote photos. */
export async function fetchLiveMenu(legacyId: number, zone: number, slug: string, categoryName: (id?: number) => string, signal?: AbortSignal): Promise<{ section: string; items: LiveMenuItem[] }[]> {
  const data = await getJSON<{ products: LegacyProduct[] }>(`/products/latest?restaurant_id=${legacyId}&category_id=0&limit=200&offset=1`, zone, signal);
  const rate = await liveRate();
  const products = data.products ?? [];
  const ranked = [...products].sort((a, b) => (b.order_count ?? b.sell_count ?? 0) - (a.order_count ?? a.sell_count ?? 0));
  const popular = new Set(ranked.slice(0, 2).filter((p) => (p.order_count ?? p.sell_count ?? 0) > 0).map((p) => p.id));
  const sections = new Map<string, LiveMenuItem[]>();
  for (const p of products) {
    const cat = categoryName(p.category_id) || "Menu";
    const tags: MenuItem["tags"] = [];
    if (popular.has(p.id) || p.recommended) (tags as string[]).push("Popular");
    const item: LiveMenuItem = {
      id: `${slug}--${p.id}`,
      name: p.name,
      description: p.description ?? "",
      price: cdf(Number(p.price) || 0, rate),
      recipe: "poisson",
      tags: tags.length ? tags : undefined,
      photo: p.image_full_url ?? undefined,
    };
    const list = sections.get(cat) ?? [];
    list.push(item);
    sections.set(cat, list);
  }
  return [...sections.entries()].map(([section, items]) => ({ section, items }));
}
