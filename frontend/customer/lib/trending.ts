/**
 * "Trending this week" — the dishes rising across Kinshasa kitchens, for the home page.
 *
 * At launch this ranks the live catalogue by recent order volume (the API returns a trend
 * score per item). Until then it ranks the snapshot in lib/catalogue.ts by a stable, explainable
 * score — the kitchen's standing, a lift for newly added dishes, and a deterministic per-dish
 * nudge so the row isn't just alphabetical. It is intentionally pure (no Date / Math.random), so
 * the server-rendered HTML and the client match exactly and the static export stays stable.
 */
import { MERCHANTS, type Merchant, type MenuItem } from "./catalogue";

export interface TrendingPick {
  readonly merchant: Merchant;
  readonly item: MenuItem;
  /** 1-based position in the trending chart. */
  readonly rank: number;
}

// FNV-1a: a tiny, stable string hash so each dish gets the same nudge on server and client.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function score(m: Merchant, item: MenuItem): number {
  const standing = (m.rating || 3.8) * 2;            // a well-rated kitchen trends more
  const fresh = item.tags?.includes("New") ? 3 : 0;  // newly added dishes get a lift
  const liked = item.tags?.includes("Popular") ? 2 : 0;
  const nudge = (hash(item.id) % 1000) / 1000 * 3;   // 0–3, stable per dish
  return standing + fresh + liked + nudge;
}

/**
 * The top `n` trending dishes, highest score first, at most `perMerchant` from any one kitchen
 * so the row shows the city, not a single restaurant.
 */
export function trending(n = 8, perMerchant = 2): TrendingPick[] {
  const pool: { merchant: Merchant; item: MenuItem; s: number }[] = [];
  for (const m of MERCHANTS)
    for (const section of m.menu)
      for (const item of section.items)
        if (item.tags?.includes("Popular") || item.tags?.includes("New"))
          pool.push({ merchant: m, item, s: score(m, item) });

  pool.sort((a, b) => b.s - a.s);

  const perCount = new Map<string, number>();
  const seen = new Set<string>();
  const out: TrendingPick[] = [];
  for (const p of pool) {
    if (seen.has(p.item.id)) continue;
    const taken = perCount.get(p.merchant.slug) ?? 0;
    if (taken >= perMerchant) continue;
    seen.add(p.item.id);
    perCount.set(p.merchant.slug, taken + 1);
    out.push({ merchant: p.merchant, item: p.item, rank: out.length + 1 });
    if (out.length >= n) break;
  }
  return out;
}
