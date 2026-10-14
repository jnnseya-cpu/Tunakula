import Link from "next/link";
import { PlateArt, FoodImage, type Recipe } from "./plate";
import { EtaChip } from "./location";
import { fc, MERCHANTS, type Merchant, type MenuItem } from "../lib/catalogue";

/* ─── "What's on your mind?" — cuisine category tiles ─────────────────────────
 * Each tile searches the browse page for a term that really matches the catalogue
 * (cuisine keywords and dish words present in Kinshasa kitchens), so every tile lands
 * on real results. */
const CATEGORIES: { label: string; q: string; recipe: Recipe }[] = [
  { label: "Congolese", q: "Kinoise", recipe: "moambe" },
  { label: "Grills & brochettes", q: "brochette", recipe: "brochettes" },
  { label: "Fish & liboke", q: "poisson", recipe: "liboke" },
  { label: "European", q: "Européenne", recipe: "riz" },
  { label: "Fast food", q: "Américaine", recipe: "pain" },
  { label: "African", q: "Africaine", recipe: "pondu" },
  { label: "Asian", q: "Asiatique", recipe: "riz" },
  { label: "Drinks", q: "jus", recipe: "jus" },
];

export function CategoryTiles() {
  return (
    <section className="tight cats-sec">
      <div className="wrap">
        <div className="sec-head">
          <h2 className="sec-title">What&rsquo;s on your mind?</h2>
          <Link className="link" href="/order/">See all</Link>
        </div>
        <nav className="cats" aria-label="Browse by cuisine">
          {CATEGORIES.map((c) => (
            <Link key={c.label} className="cat" href={`/order/?q=${encodeURIComponent(c.q)}`} data-reveal>
              <div className="cat-pic"><PlateArt className="cat-art" recipe={c.recipe} seed={`cat-${c.q}`} /></div>
              <span>{c.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}

/* ─── "Best reviewed" — dishes from the highest-rated kitchens ────────────────
 * Honest by construction: only kitchens that already carry a rating appear, with the
 * kitchen's real star and review count. The row fills out as live reviews arrive. */
function topRatedDishes(n = 6): { merchant: Merchant; item: MenuItem }[] {
  const rated = MERCHANTS.filter((m) => m.rating > 0).sort((a, b) => b.rating - a.rating);
  const out: { merchant: Merchant; item: MenuItem }[] = [];
  for (const m of rated) {
    const all = m.menu.flatMap((s) => s.items);
    const pops = all.filter((i) => i.tags?.includes("Popular"));
    for (const item of (pops.length ? pops : all).slice(0, 3)) {
      out.push({ merchant: m, item });
      if (out.length >= n) return out;
    }
  }
  return out;
}

export function BestReviewed() {
  const picks = topRatedDishes(6);
  if (picks.length === 0) return null;
  return (
    <section className="tight">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <h2 className="sec-title">Best reviewed</h2>
            <p className="muted">Top-rated dishes from the kitchens Kinshasa scores highest.</p>
          </div>
          <Link className="link" href="/order/?sort=rating">See top rated</Link>
        </div>
        <div className="fav-grid">
          {picks.map(({ merchant: m, item }) => (
            <Link key={`${m.slug}-${item.id}`} className="fav" href={`/r/${m.slug}/`} data-reveal>
              <div className="fav-pic" style={{ background: m.tone.bg }}>
                <FoodImage slug={item.id} recipe={item.recipe} alt={item.name} className="pic" />
                <span className="rev-star" aria-label={`Rated ${m.rating.toFixed(1)} out of 5`}>
                  <span aria-hidden>★</span> {m.rating.toFixed(1)}{m.ratings > 0 ? <small> ({m.ratings})</small> : null}
                </span>
                <span className="fav-add" aria-hidden>+</span>
              </div>
              <h3>{item.name}</h3>
              <p className="muted">{m.name} · {m.commune}</p>
              <p className="fav-foot"><b className="num">{fc(item.price)}</b></p>
              <EtaChip slug={m.slug} />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
