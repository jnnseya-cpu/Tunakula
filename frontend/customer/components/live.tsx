"use client";
/**
 * Storefronts that read the live catalogue API in the browser.
 *
 * Each component is given the committed snapshot as its initial data, so the static HTML is complete
 * and correct with no JavaScript (SEO, no-JS, offline). On mount it refreshes from the live API
 * (lib/live-catalogue.ts) and swaps in the current names, menus, prices and photos. If the API is
 * unreachable, the snapshot simply stays. The cart/money path is unchanged: prices arrive as whole
 * francs, already converted from the platform's USD at the live rate.
 */
import { useEffect, useState } from "react";
import type { Merchant } from "../lib/catalogue";
import { fc } from "../lib/catalogue";
import { fetchLiveMenu, fetchLiveMerchants, type LiveMenuItem, type LiveMerchant } from "../lib/live-catalogue";
import CATEGORIES from "../lib/legacy-categories.json";
import { AddButton } from "./basket";
import { EtaChip, OpenBadge, StoreLink } from "./location";

const categoryName = (id?: number) => (CATEGORIES as Record<string, string>)[String(id)] ?? "Menu";
const anchor = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The live menu for one storefront, matching the server markup exactly so styling is identical. */
export function LiveMenu({ merchant }: { merchant: Merchant }) {
  const initial = merchant.menu.map((s) => ({ section: s.section, items: s.items as readonly LiveMenuItem[] }));
  const [sections, setSections] = useState(initial);

  useEffect(() => {
    const ctl = new AbortController();
    fetchLiveMenu(merchant.legacyId, merchant.zone, merchant.slug, categoryName, ctl.signal)
      .then((live) => { if (live.length) setSections(live); })
      .catch(() => { /* keep the snapshot */ });
    return () => ctl.abort();
  }, [merchant.legacyId, merchant.zone, merchant.slug]);

  return (
    <>
      <nav className="menu-tabs" aria-label="Menu sections">
        {sections.map((s) => <a key={s.section} href={`#${anchor(s.section)}`}>{s.section}</a>)}
        <a href="#about">About</a>
      </nav>
      {sections.map((s) => (
        <section key={s.section} id={anchor(s.section)} className="menu-sec">
          <h2>{s.section}</h2>
          <div className="items">
            {s.items.map((it) => (
              <article key={it.id} className="item">
                <div className="item-text">
                  <h3>{it.name}</h3>
                  <p>{it.description}</p>
                  <div className="item-foot">
                    <span className="price num">{fc(it.price)}</span>
                    {it.unit ? <span className="muted">{it.unit}</span> : null}
                    {it.tags?.map((t) => <span key={t} className={`chip ${t === "Popular" ? "hot" : ""}`}>{t}</span>)}
                    {it.allergens?.length ? <span className="muted">Contains {it.allergens.join(", ")}</span> : null}
                  </div>
                </div>
                <div className="item-pic">
                  <ItemPhoto item={it} />
                  <AddButton item={{ id: it.id, name: it.name, price: it.price }} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ItemPhoto({ item }: { item: LiveMenuItem }) {
  const src = item.photo || `/photos/${item.id}.png`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pic is-photo" src={src} alt={item.name} loading="lazy" />;
}

const toLive = (m: Merchant): LiveMerchant => ({ ...m, coverUrl: m.coverUrl, logoUrl: m.logoUrl });

/** The "Near you" grid, refreshed from the live list of restaurants across the platform's zones. */
export function LiveMerchantGrid({ fallback }: { fallback: readonly Merchant[] }) {
  const [rows, setRows] = useState<LiveMerchant[]>(fallback.map(toLive));

  useEffect(() => {
    const ctl = new AbortController();
    const zones = [...new Set(fallback.map((m) => m.zone))];
    const bySlug = new Map(fallback.map((m) => [m.slug, m]));
    fetchLiveMerchants(zones, bySlug, ctl.signal)
      .then((live) => { if (live.length) setRows(live); })
      .catch(() => { /* keep the snapshot */ });
    return () => ctl.abort();
  }, [fallback]);

  return <>{rows.map((m) => <LiveCard key={m.slug} m={m} />)}</>;
}

function LiveCard({ m }: { m: LiveMerchant }) {
  const search = [m.name, m.cuisine, m.commune, m.kind].join(" ").toLowerCase();
  return (
    <StoreLink slug={m.slug} className="mcard" data-store data-slug={m.slug} data-kind={m.kind} data-search={search} data-reveal>
      <div className="mcard-media">
        <div className="cover sm" style={{ background: m.tone.bg, color: m.tone.fg }}>
          {m.coverUrl ? <img src={m.coverUrl} alt={m.name} /> : null}
        </div>
        <span className="mcard-badges"><OpenBadge slug={m.slug} /></span>
        {m.ratings > 0
          ? <span className="mcard-rating"><span aria-hidden>★</span> <b className="num">{m.rating.toFixed(1)}</b></span>
          : <span className="mcard-rating is-new">Nouveau</span>}
      </div>
      <div className="mcard-body">
        <span className="mlogo" style={{ width: 52, height: 52, background: m.tone.bg, color: m.tone.accent, fontSize: 18 }}>
          {m.logoUrl ? <img src={m.logoUrl} alt={`${m.name} logo`} /> : m.monogram}
        </span>
        <div className="mcard-text">
          <h3>{m.name}</h3>
          <p className="muted">{m.cuisine} · {m.commune}</p>
        </div>
      </div>
      <div className="mcard-foot">
        <EtaChip slug={m.slug} />
        <span className="fee">Delivery from $1.00</span>
      </div>
    </StoreLink>
  );
}
