"use client";
/**
 * A live storefront (/store/?id=<branch>): the real menu and availability from the API, road distance and
 * delivery time from the customer's location, and a cart that goes to checkout.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, foodPhotoUrl, getSession, listFavourites, loadCart, lineSig, money, mulMinor, addMinor, saveCart, toggleFavourite, type Cart, type CartLine, type CartLineOption, type MoneyWire } from "../lib/api";
import { ClockIcon, PinIcon, useLocationCtx } from "./location";
import { PlateArt, recipeFor } from "./plate-art";
import { BookTable } from "./book-table";

interface VOption { id: string; name: string; price: string }
interface Variation { id: string; name: string; type: "SINGLE" | "MULTI"; required: boolean; min: number; max: number; options: VOption[] }
interface MenuItem { id: string; names: Record<string, string>; prices: Record<string, MoneyWire>; tags: string[]; allergens: string[]; available: boolean; variations?: Variation[]; addons?: VOption[]; veg?: boolean | null; dietary?: string[]; nutrition?: Record<string, number>; age_restricted?: boolean; image_id?: string | null }

const DIETARY_LABEL: Record<string, string> = { VEGETARIAN: "Vegetarian", VEGAN: "Vegan", HALAL: "Halal", KOSHER: "Kosher", GLUTEN_FREE: "Gluten-free", DAIRY_FREE: "Dairy-free", NUT_FREE: "Nut-free", ORGANIC: "Organic", SPICY: "Spicy" };
/** The dietary tags the storefront offers as quick filters. */
const DIETARY_FILTERS = ["VEGETARIAN", "VEGAN", "HALAL", "GLUTEN_FREE", "DAIRY_FREE", "NUT_FREE"] as const;
/** A dish's effective dietary tags, treating the legacy `veg` flag as VEGETARIAN. */
const dietaryOf = (i: MenuItem): string[] => [...new Set([...(i.dietary ?? []), ...(i.veg === true ? ["VEGETARIAN"] : [])])];
interface Branch { id: string; name: string; commune: string | null; status: string; address?: string | null; phone?: string | null; description?: Record<string, string>; cuisines?: string[]; logo_id?: string | null; cover_id?: string | null }
interface Menu { branch: Branch; items: MenuItem[] }
const hasOptions = (i: MenuItem) => (i.variations?.length ?? 0) > 0 || (i.addons?.length ?? 0) > 0;
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
  const [diet, setDiet] = useState<string[]>([]);
  const [rating, setRating] = useState<{ average: number | null; count: number } | null>(null);
  const [fav, setFav] = useState<boolean | null>(null);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const { place } = useLocationCtx();

  useEffect(() => { setId(new URLSearchParams(window.location.search).get("id")); }, []);
  useEffect(() => {
    if (!id) return;
    api<Menu>(`/v1/branches/${id}/menu`, { auth: false }).then((m) => {
      setMenu(m);
      const saved = loadCart(id);
      // Backfill a line key for carts saved before options existed.
      if (saved) saved.lines = saved.lines.map((l) => (l.key ? l : { ...l, key: crypto.randomUUID() }));
      setCart(saved ?? { branch_id: id, branch_name: m.branch.name, lines: [] });
    }).catch((e: ApiError) => setError(e.message));
    api<{ average: number | null; count: number }>(`/v1/branches/${id}/reviews`, { auth: false }).then(setRating).catch(() => undefined);
    if (getSession()) listFavourites().then((f) => setFav(f.some((x) => x.branch_id === id))).catch(() => undefined);
  }, [id]);

  const heart = async () => {
    if (!id || !getSession()) { window.location.href = `/signin/?next=${encodeURIComponent(`/store/?id=${id}`)}`; return; }
    try { setFav((await toggleFavourite(id)).favourite); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (!id || !place) return;
    api<Eta>(`/v1/branches/${id}/eta?lat=${place.lat}&lng=${place.lng}`, { auth: false }).then(setEta).catch(() => setEta(null));
  }, [id, place]);

  const ccy = "USD";
  const update = (next: Cart) => { setCart({ ...next, lines: [...next.lines] }); saveCart(next); };

  /** Add a dish. With options, `sel` carries the chosen variations/add-ons and the per-unit price. */
  const addLine = (item: MenuItem, sel?: { options: CartLineOption[]; addons: string[]; descriptors: string[]; unit: MoneyWire }) => {
    if (!cart) return;
    const draft: CartLine = {
      key: crypto.randomUUID(), item_id: item.id, name: nameOf(item.names),
      unit: sel?.unit ?? item.prices[ccy] ?? Object.values(item.prices)[0]!, qty: 1,
      ...(sel && sel.options.length ? { options: sel.options } : {}),
      ...(sel && sel.addons.length ? { addons: sel.addons } : {}),
      ...(sel && sel.descriptors.length ? { descriptors: sel.descriptors } : {}),
    };
    const same = cart.lines.find((l) => lineSig(l) === lineSig(draft));
    if (same) same.qty = Math.min(99, same.qty + 1);
    else cart.lines.push(draft);
    update(cart);
  };
  const add = (item: MenuItem) => { if (hasOptions(item)) setPicking(item); else addLine(item); };
  const change = (key: string, d: number) => {
    if (!cart) return;
    const line = cart.lines.find((l) => l.key === key);
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
  // A dish shows when it matches the search and carries every selected dietary tag.
  const dietaryAvailable = [...new Set(menu.items.flatMap(dietaryOf))];
  const filters = DIETARY_FILTERS.filter((d) => dietaryAvailable.includes(d));
  const visible = menu.items.filter((i) =>
    (!q.trim() || nameOf(i.names).toLowerCase().includes(q.trim().toLowerCase())) &&
    diet.every((d) => dietaryOf(i).includes(d)),
  );
  const open = menu.branch.status === "OPEN" && (eta?.open ?? true);
  const dishes = menu.items.slice(0, 3).map((i) => recipeFor(nameOf(i.names)));

  return (
    <>
      <div className="live-cover" style={{ background: bg }}>
        {menu.branch.cover_id ? <img className="cover-photo" src={foodPhotoUrl(menu.branch.cover_id)} alt="" /> : (
          <div className="cover-plates" aria-hidden>
            {dishes.map((r, k) => <PlateArt key={k} className={`cp cp${k}`} recipe={r} seed={`${menu.branch.id}-${k}`} />)}
          </div>
        )}
      </div>
      <div className="wrap live-head">
        {menu.branch.logo_id ? <img className="mlogo mlogo-photo" src={foodPhotoUrl(menu.branch.logo_id)} alt="" /> : <span className="mlogo" style={{ width: 96, height: 96, background: bg, color: accent, fontSize: 32 }}>{initials(menu.branch.name)}</span>}
        <div>
          <p className="eyebrow"><Link href="/order/">Kinshasa</Link>{menu.branch.commune ? ` · ${menu.branch.commune}` : ""}{menu.branch.cuisines?.length ? ` · ${menu.branch.cuisines.join(", ")}` : ""}</p>
          <h1 className="store-name">{menu.branch.name}</h1>
          {menu.branch.description?.en || menu.branch.description?.fr ? <p className="store-about">{menu.branch.description.en ?? menu.branch.description.fr}</p> : null}
          {menu.branch.address || menu.branch.phone ? <p className="store-contact">{[menu.branch.address, menu.branch.phone].filter(Boolean).join(" · ")}</p> : null}
          <div className="store-meta">
            <span className={`open-badge ${open ? "on" : "off"}`}>{open ? "Open" : "Closed now"}</span>
            {rating && rating.average !== null ? <span className="store-rating">★ {rating.average} <small>({rating.count})</small></span> : null}
            <button type="button" className={`fav-btn ${fav ? "on" : ""}`} aria-pressed={!!fav} aria-label={fav ? "Remove from favourites" : "Add to favourites"} onClick={heart}>{fav ? "♥" : "♡"}</button>
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
          <Link className="group-cta" href={`/group/?branch=${menu.branch.id}&start=1`}>👥 Start a group order — everyone adds their own dishes, the bill splits</Link>
          <BookTable branchId={menu.branch.id} branchName={menu.branch.name} />
          {filters.length ? (
            <div className="diet-filter" role="group" aria-label="Filter by diet">
              {filters.map((d) => {
                const on = diet.includes(d);
                return <button type="button" key={d} className={`diet-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setDiet(on ? diet.filter((x) => x !== d) : [...diet, d])}>{DIETARY_LABEL[d] ?? d}</button>;
              })}
              {diet.length ? <button type="button" className="diet-chip clear" onClick={() => setDiet([])}>Clear</button> : null}
            </div>
          ) : null}
          <div className="live-items">
            {visible.map((i) => {
              const name = nameOf(i.names);
              const price = i.prices[ccy] ?? Object.values(i.prices)[0];
              const plainLine = cart.lines.find((l) => l.item_id === i.id && !l.options && !l.addons);
              const inCart = cart.lines.filter((l) => l.item_id === i.id).reduce((n, l) => n + l.qty, 0);
              const optioned = hasOptions(i);
              return (
                <article key={i.id} className={`live-item ${i.available ? "" : "off"}`} data-reveal>
                  <div className="li-text">
                    <h3>{name}</h3>
                    {nameOf(i.names, "en") !== name ? <p className="muted">{nameOf(i.names, "en")}</p> : null}
                    {optioned ? <p className="muted small">{(i.variations?.length ?? 0) > 0 ? "Choices" : "Add-ons"} available</p> : null}
                    {dietaryOf(i).length || i.nutrition?.kcal !== undefined || i.age_restricted ? (
                      <p className="diet-badges">
                        {i.age_restricted ? <span className="diet-tag age">18+</span> : null}
                        {dietaryOf(i).map((d) => <span key={d} className="diet-tag">{DIETARY_LABEL[d] ?? d}</span>)}
                        {i.nutrition?.kcal !== undefined ? <span className="kcal">{i.nutrition.kcal} kcal</span> : null}
                      </p>
                    ) : null}
                    {i.allergens.length ? <p className="allergen">Contains {i.allergens.join(", ")}</p> : null}
                    <p className="li-price num">{price ? money(price) : "—"}{optioned ? "+" : ""}</p>
                  </div>
                  <div className="li-pic" style={{ background: bg }}>
                    {i.image_id ? <img className="pic li-photo" src={foodPhotoUrl(i.image_id)} alt="" loading="lazy" /> : <PlateArt className="pic" recipe={recipeFor(name)} seed={i.id} />}
                    {i.available ? (
                      !optioned && plainLine ? (
                        <span className="qty-pill"><button type="button" onClick={() => change(plainLine.key, -1)} aria-label={`One less ${name}`}>−</button><b>{inCart}</b><button type="button" onClick={() => add(i)} aria-label={`One more ${name}`}>+</button></span>
                      ) : <button type="button" className="add-btn" onClick={() => add(i)} aria-label={optioned ? `Choose ${name}` : `Add ${name}`} disabled={!open}>{inCart > 0 ? inCart : "+"}</button>
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
                  <li key={l.key}>
                    <span className="qty-pill sm"><button type="button" onClick={() => change(l.key, -1)} aria-label={`One less ${l.name}`}>−</button><b>{l.qty}</b><button type="button" onClick={() => change(l.key, 1)} aria-label={`One more ${l.name}`}>+</button></span>
                    <span className="cl-name">{l.name}{l.descriptors?.length ? <small className="cl-opts">{l.descriptors.join(" · ")}</small> : null}</span>
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
      {picking ? <OptionPicker item={picking} ccy={ccy} onClose={() => setPicking(null)} onAdd={(sel) => { addLine(picking, sel); setPicking(null); }} /> : null}
    </>
  );
}

/** The customer's option picker: choose variations and add-ons for a dish; the price updates live. */
function OptionPicker({ item, ccy, onClose, onAdd }: { item: MenuItem; ccy: string; onClose: () => void; onAdd: (sel: { options: CartLineOption[]; addons: string[]; descriptors: string[]; unit: MoneyWire }) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [addons, setAddons] = useState<string[]>([]);
  const base = BigInt(item.prices[ccy]?.amount_minor ?? Object.values(item.prices)[0]?.amount_minor ?? "0");
  const variations = item.variations ?? [];
  const addonList = item.addons ?? [];

  const pickSingle = (g: Variation, optId: string) => setChosen((c) => ({ ...c, [g.id]: [optId] }));
  const toggleMulti = (g: Variation, optId: string) => setChosen((c) => {
    const cur = c[g.id] ?? [];
    if (cur.includes(optId)) return { ...c, [g.id]: cur.filter((x) => x !== optId) };
    if (cur.length >= g.max) return c; // at the limit
    return { ...c, [g.id]: [...cur, optId] };
  });
  const toggleAddon = (id: string) => setAddons((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]);

  const missing = variations.filter((g) => g.required && (chosen[g.id]?.length ?? 0) < Math.max(1, g.min));
  let surcharge = 0n;
  const descriptors: string[] = [];
  for (const g of variations) for (const oid of chosen[g.id] ?? []) { const o = g.options.find((x) => x.id === oid); if (o) { surcharge += BigInt(o.price); descriptors.push(`${g.name}: ${o.name}`); } }
  for (const id of addons) { const a = addonList.find((x) => x.id === id); if (a) { surcharge += BigInt(a.price); descriptors.push(`+ ${a.name}`); } }
  const unit: MoneyWire = { amount_minor: (base + surcharge).toString(), currency: ccy };

  const confirm = () => {
    if (missing.length) return;
    const options: CartLineOption[] = variations.filter((g) => (chosen[g.id]?.length ?? 0) > 0).map((g) => ({ group: g.id, choices: chosen[g.id]! }));
    onAdd({ options, addons, descriptors, unit });
  };

  return (
    <div className="picker-wrap" role="dialog" aria-modal="true" aria-label={`Options for ${nameOf(item.names)}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker">
        <div className="picker-head"><h2>{nameOf(item.names)}</h2><button type="button" className="picker-x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="picker-body">
          {variations.map((g) => (
            <fieldset className="pk-group" key={g.id}>
              <legend>{g.name} {g.required ? <span className="pk-req">Required</span> : <span className="muted small">Optional</span>}{g.type === "MULTI" && g.max ? <span className="muted small"> · up to {g.max}</span> : null}</legend>
              {g.options.map((o) => {
                const on = (chosen[g.id] ?? []).includes(o.id);
                return (
                  <label className={`pk-opt ${on ? "on" : ""}`} key={o.id}>
                    <input type={g.type === "SINGLE" ? "radio" : "checkbox"} name={g.id} checked={on} onChange={() => (g.type === "SINGLE" ? pickSingle(g, o.id) : toggleMulti(g, o.id))} />
                    <span className="pk-name">{o.name}</span>
                    <span className="pk-price num">{o.price === "0" ? "" : `+ ${money({ amount_minor: o.price, currency: ccy })}`}</span>
                  </label>
                );
              })}
            </fieldset>
          ))}
          {addonList.length ? (
            <fieldset className="pk-group">
              <legend>Add-ons <span className="muted small">Optional</span></legend>
              {addonList.map((a) => {
                const on = addons.includes(a.id);
                return (
                  <label className={`pk-opt ${on ? "on" : ""}`} key={a.id}>
                    <input type="checkbox" checked={on} onChange={() => toggleAddon(a.id)} />
                    <span className="pk-name">{a.name}</span>
                    <span className="pk-price num">{a.price === "0" ? "" : `+ ${money({ amount_minor: a.price, currency: ccy })}`}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
        </div>
        <div className="picker-foot">
          {missing.length ? <p className="muted small">Choose {missing.map((g) => g.name).join(", ")}</p> : null}
          <button type="button" className="btn accent wide" disabled={missing.length > 0} onClick={confirm}>Add · {money(unit)}</button>
        </div>
      </div>
    </div>
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
