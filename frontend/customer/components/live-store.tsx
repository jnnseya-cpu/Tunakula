"use client";
/**
 * A live storefront (/store/?id=<branch>): the real menu and availability from the API, road distance and
 * delivery time from the customer's location, and a cart that goes to checkout.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, loadCart, money, mulMinor, addMinor, saveCart, type Cart, type MoneyWire } from "../lib/api";
import { ClockIcon, PinIcon, useLocationCtx } from "./location";
import { PlateArt, recipeFor } from "./plate-art";

interface MenuItem { id: string; names: Record<string, string>; prices: Record<string, MoneyWire>; tags: string[]; allergens: string[]; available: boolean }
interface Menu { branch: { id: string; name: string; commune: string | null; status: string }; items: MenuItem[] }
interface Eta { distance_km: string; eta: { low: number; high: number; basis: string }; delivery_fee: MoneyWire; open: boolean }

const TONES = [["#7e2a10", "#e9a24a"], ["#27402a", "#d9b24a"], ["#2a1d16", "#e0643a"], ["#8a5a22", "#f2c46a"], ["#1f5a50", "#f2b84b"], ["#1f305d", "#fad20e"]] as const;
const hashOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
export const toneFor = (id: string) => TONES[hashOf(id) % TONES.length]!;
export const nameOf = (names: Record<string, string>, lang = "fr") => names[lang] ?? names.en ?? Object.values(names)[0] ?? "";
const initials = (n: string) => n.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w) && !/^(ya|la|le|de|du|chez)$/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export function LiveStore() {
  const [id, setId] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<Eta | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [q, setQ] = useState("");
  const { place } = useLocationCtx();

  useEffect(() => { setId(new URLSearchParams(window.location.search).get("id")); }, []);
  useEffect(() => {
    if (!id) return;
    api<Menu>(`/v1/branches/${id}/menu`, { auth: false }).then((m) => { setMenu(m); setCart(loadCart(id) ?? { branch_id: id, branch_name: m.branch.name, lines: [] }); }).catch((e: ApiError) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (!id || !place) return;
    api<Eta>(`/v1/branches/${id}/eta?lat=${place.lat}&lng=${place.lng}`, { auth: false }).then(setEta).catch(() => setEta(null));
  }, [id, place]);

  const ccy = "USD";
  const update = (next: Cart) => { setCart({ ...next, lines: [...next.lines] }); saveCart(next); };
  const add = (item: MenuItem) => {
    if (!cart) return;
    const line = cart.lines.find((l) => l.item_id === item.id);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else cart.lines.push({ item_id: item.id, name: nameOf(item.names), unit: item.prices[ccy] ?? Object.values(item.prices)[0]!, qty: 1 });
    update(cart);
  };
  const change = (itemId: string, d: number) => {
    if (!cart) return;
    const line = cart.lines.find((l) => l.item_id === itemId);
    if (!line) return;
    line.qty += d;
    update({ ...cart, lines: cart.lines.filter((l) => l.qty > 0) });
  };
  const count = cart?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;
  const subtotal = useMemo(() => cart?.lines.reduce((s, l) => addMinor(s, mulMinor(l.unit.amount_minor, l.qty)), "0") ?? "0", [cart]);

  if (!id) return <main className="app-page"><p className="muted">No storefront chosen. <Link className="link-btn" href="/order/">See restaurants</Link></p></main>;
  if (error) return <main className="app-page"><div className="app-card"><h1 className="app-title">This storefront is not available</h1><p className="muted">{error}</p><Link className="btn accent" href="/order/">See other restaurants</Link></div></main>;
  if (!menu || !cart) return <main className="app-page"><div className="skeleton-cover" /><div className="skeleton-line" /><div className="skeleton-line short" /></main>;

  const [bg, accent] = toneFor(menu.branch.id);
  const visible = menu.items.filter((i) => !q.trim() || nameOf(i.names).toLowerCase().includes(q.trim().toLowerCase()));
  const open = menu.branch.status === "OPEN" && (eta?.open ?? true);
  const dishes = menu.items.slice(0, 3).map((i) => recipeFor(nameOf(i.names)));

  return (
    <>
      <div className="live-cover" style={{ background: bg }}>
        <div className="cover-plates" aria-hidden>
          {dishes.map((r, k) => <PlateArt key={k} className={`cp cp${k}`} recipe={r} seed={`${menu.branch.id}-${k}`} />)}
        </div>
      </div>
      <div className="wrap live-head">
        <span className="mlogo" style={{ width: 96, height: 96, background: bg, color: accent, fontSize: 32 }}>{initials(menu.branch.name)}</span>
        <div>
          <p className="eyebrow"><Link href="/order/">Kinshasa</Link>{menu.branch.commune ? ` · ${menu.branch.commune}` : ""}</p>
          <h1 className="store-name">{menu.branch.name}</h1>
          <div className="store-meta">
            <span className={`open-badge ${open ? "on" : "off"}`}>{open ? "Open" : "Closed now"}</span>
            {eta ? (
              <span className="eta-chip lg">
                <span className="eta-km"><PinIcon /> <b className="num">{eta.distance_km}</b> km</span>
                <span className="eta-time"><ClockIcon /> <b className="num">{eta.eta.low}–{eta.eta.high}</b> min</span>
                <span className="fee">Delivery {money(eta.delivery_fee)}</span>
              </span>
            ) : <span className="eta-chip lg loading" aria-hidden><span /><span /></span>}
          </div>
        </div>
      </div>

      <div className="wrap live-body">
        <div>
          <label className="menu-search"><span className="sr">Search this menu</span><input placeholder={`Search ${menu.branch.name}`} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="live-items">
            {visible.map((i) => {
              const name = nameOf(i.names);
              const price = i.prices[ccy] ?? Object.values(i.prices)[0];
              const inCart = cart.lines.find((l) => l.item_id === i.id)?.qty ?? 0;
              return (
                <article key={i.id} className={`live-item ${i.available ? "" : "off"}`} data-reveal>
                  <div className="li-text">
                    <h3>{name}</h3>
                    {nameOf(i.names, "en") !== name ? <p className="muted">{nameOf(i.names, "en")}</p> : null}
                    {i.allergens.length ? <p className="allergen">Contains {i.allergens.join(", ")}</p> : null}
                    <p className="li-price num">{price ? money(price) : "—"}</p>
                  </div>
                  <div className="li-pic" style={{ background: bg }}>
                    <PlateArt className="pic" recipe={recipeFor(name)} seed={i.id} />
                    {i.available ? (
                      inCart ? (
                        <span className="qty-pill"><button type="button" onClick={() => change(i.id, -1)} aria-label={`One less ${name}`}>−</button><b>{inCart}</b><button type="button" onClick={() => add(i)} aria-label={`One more ${name}`}>+</button></span>
                      ) : <button type="button" className="add-btn" onClick={() => add(i)} aria-label={`Add ${name}`} disabled={!open}>+</button>
                    ) : <span className="sold-out">Sold out</span>}
                  </div>
                </article>
              );
            })}
            {visible.length === 0 ? <p className="muted">Nothing on this menu matches “{q}”.</p> : null}
          </div>
        </div>
        <aside className="cart-panel">
          <h2>Your order</h2>
          {cart.lines.length === 0 ? <p className="muted">Tap + on a dish to add it.</p> : (
            <>
              <ul className="cart-lines">
                {cart.lines.map((l) => (
                  <li key={l.item_id}>
                    <span className="qty-pill sm"><button type="button" onClick={() => change(l.item_id, -1)} aria-label={`One less ${l.name}`}>−</button><b>{l.qty}</b><button type="button" onClick={() => change(l.item_id, 1)} aria-label={`One more ${l.name}`}>+</button></span>
                    <span className="cl-name">{l.name}</span>
                    <span className="num">{money({ amount_minor: mulMinor(l.unit.amount_minor, l.qty), currency: l.unit.currency })}</span>
                  </li>
                ))}
              </ul>
              <div className="cart-sub"><span>Food</span><b className="num">{money({ amount_minor: subtotal, currency: ccy })}</b></div>
              <p className="muted small">Service charge (10%) and delivery are added at checkout, each on its own line.</p>
              <Link className="btn accent wide" href={`/checkout/?branch=${menu.branch.id}`}>Checkout</Link>
            </>
          )}
        </aside>
      </div>
      {count > 0 ? (
        <Link className="cart-bar" href={`/checkout/?branch=${menu.branch.id}`}>
          <span className="n">{count}</span><span>View order</span><b className="num">{money({ amount_minor: subtotal, currency: ccy })}</b>
        </Link>
      ) : null}
    </>
  );
}

/** Every live storefront nearby that the sample grid does not already show (when the API is connected). */
export function LiveStoreGrid({ exclude }: { exclude: readonly string[] }) {
  const { liveStores } = useLocationCtx();
  const rows = liveStores.filter((s) => !exclude.includes(s.name));
  if (!rows.length) return null;
  return (
    <div className="mgrid live-grid">
      {rows.map((s) => {
        const [bg, accent] = toneFor(s.id);
        return (
          <Link key={s.id} className="mcard" href={`/store/?id=${s.id}`} data-reveal>
            <div className="mcard-media">
              <div className="cover sm" style={{ background: bg }}>
                <div className="cover-plates" aria-hidden>
                  {(["moambe", "brochettes", "pondu"] as const).map((r, k) => <PlateArt key={k} className={`cp cp${k}`} recipe={r} seed={`${s.id}-${k}`} />)}
                </div>
              </div>
              <span className="mcard-badges"><span className={`open-badge ${s.open ? "on" : "off"}`}>{s.open ? "Open" : "Closed now"}</span></span>
            </div>
            <div className="mcard-body">
              <span className="mlogo" style={{ width: 52, height: 52, background: bg, color: accent, fontSize: 18 }}>{initials(s.name)}</span>
              <div className="mcard-text"><h3>{s.name}</h3><p className="muted">{s.commune ?? "Kinshasa"}</p></div>
            </div>
            <div className="mcard-foot">
              <span className="eta-chip"><span className="eta-km"><PinIcon /> <b className="num">{s.km}</b> km</span><span className="eta-time"><ClockIcon /> <b className="num">{s.low}–{s.high}</b> min</span></span>
              <span className="fee">{money(s.fee)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
