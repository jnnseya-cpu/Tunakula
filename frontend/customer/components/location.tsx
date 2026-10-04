"use client";
/**
 * Delivery location, and the distance (km) and delivery time of every storefront from it.
 * With NEXT_PUBLIC_API_URL set, times come from the API (live traffic and learned kitchen times,
 * GET /v1/branches/nearby), refreshed every two minutes; otherwise from the shared model
 * (@tunakula/ts-contracts/eta-model), the same one the API falls back to.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { estimateDelivery, etaRange, kmText } from "@tunakula/ts-contracts/eta-model";
import { API_URL, COMMUNES, DEFAULT_PLACE, type Place } from "../lib/geo";

export interface StoreGeo { readonly slug: string; readonly name: string; readonly lat: number; readonly lng: number; readonly prep: number; readonly hours: string; readonly rating: number }
export interface LiveStoreRow { readonly id: string; readonly name: string; readonly commune: string | null; readonly open: boolean; readonly km: string; readonly low: number; readonly high: number; readonly meters: number; readonly minutes: number; readonly fee: { amount_minor: string; currency: string } }
export interface StoreEta { readonly km: string; readonly meters: number; readonly low: number; readonly high: number; readonly minutes: number; readonly live: boolean; readonly open: boolean }

interface Ctx {
  place: Place | null;
  setPlace: (p: Place) => void;
  eta: Record<string, StoreEta>;
  stores: readonly StoreGeo[];
  /** Live storefront ids by sample slug, and every live storefront nearby (when the API is connected). */
  liveIds: Record<string, string>;
  liveStores: LiveStoreRow[];
  pickerOpen: boolean;
  setPickerOpen: (o: boolean) => void;
}
const LocationCtx = createContext<Ctx | null>(null);
export const useLocationCtx = () => {
  const c = useContext(LocationCtx);
  if (!c) throw new Error("Location outside its provider");
  return c;
};

const KEY = "tk-place";
const TZ = "Africa/Kinshasa";

/** "11:00 – 22:30" (Kinshasa time), including hours that run past midnight. */
export function openNow(hours: string, at: Date): boolean {
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const [, h1, m1, h2, m2] = m.map(Number) as [number, number, number, number, number];
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: TZ }).formatToParts(at);
  const now = Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

export function LocationProvider({ stores, children }: { stores: readonly StoreGeo[]; children: React.ReactNode }) {
  const [place, setPlaceState] = useState<Place | null>(null);
  const [eta, setEta] = useState<Record<string, StoreEta>>({});
  const [tick, setTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveIds, setLiveIds] = useState<Record<string, string>>({});
  const [liveStores, setLiveStores] = useState<LiveStoreRow[]>([]);

  useEffect(() => {
    let saved: Place | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* storage blocked */ }
    setPlaceState(saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) ? saved : DEFAULT_PLACE);
    const t = setInterval(() => setTick((n) => n + 1), 120_000);
    return () => clearInterval(t);
  }, []);

  const setPlace = useCallback((p: Place) => {
    setPlaceState(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    if (!place) return;
    const now = new Date();
    const local: Record<string, StoreEta> = {};
    for (const s of stores) {
      const e = estimateDelivery({ lat: s.lat, lng: s.lng }, place, now, { timeZone: TZ, pickupMinutes: s.prep });
      local[s.slug] = { km: e.km, meters: e.meters, low: e.low, high: e.high, minutes: e.minutes, live: false, open: openNow(s.hours, now) };
    }
    setEta(local);
    if (!API_URL) return;
    // Live: road distance, traffic and each kitchen's learned time from the API, matched by name.
    const ctl = new AbortController();
    fetch(`${API_URL}/v1/branches/nearby?lat=${place.lat}&lng=${place.lng}&limit=100&radius_km=50`, { headers: { "x-country": "CD" }, signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data: { id: string; name: string; commune: string | null; open: boolean; distance_meters: number; eta: { minutes: number }; delivery_fee: { amount_minor: string; currency: string } }[] } | null) => {
        if (!body) return;
        const next = { ...local };
        const ids: Record<string, string> = {};
        setLiveStores(body.data.map((b) => ({ id: b.id, name: b.name, commune: b.commune, open: b.open, km: kmText(b.distance_meters), meters: b.distance_meters, minutes: b.eta.minutes, ...etaRange(b.eta.minutes), fee: b.delivery_fee })));
        for (const s of stores) {
          const b = body.data.find((x) => x.name === s.name);
          if (b) ids[s.slug] = b.id;
          if (b) next[s.slug] = { km: kmText(b.distance_meters), meters: b.distance_meters, minutes: b.eta.minutes, ...etaRange(b.eta.minutes), live: true, open: b.open && local[s.slug]!.open };
        }
        setEta(next);
        setLiveIds(ids);
      })
      .catch(() => { /* offline: keep the model's estimate */ });
    return () => ctl.abort();
  }, [place, stores, tick]);

  const value = useMemo(() => ({ place, setPlace, eta, stores, pickerOpen, setPickerOpen, liveIds, liveStores }), [place, setPlace, eta, stores, pickerOpen, liveIds, liveStores]);
  return (
    <LocationCtx.Provider value={value}>
      {children}
      {pickerOpen ? <LocationSheet /> : null}
    </LocationCtx.Provider>
  );
}

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
);
export const ClockIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.2 1.9-.8 1.3L11 13V6.5h2v5.9Z" /></svg>
);

/** A storefront link: the live store when the API knows this kitchen, else the sample page. */
export function StoreLink({ slug, className, children, ...rest }: { slug: string; className?: string; children: React.ReactNode } & Record<string, unknown>) {
  const { liveIds } = useLocationCtx();
  const id = liveIds[slug];
  return <Link className={className} href={id ? `/store/?id=${id}` : `/r/${slug}/`} {...rest}>{children}</Link>;
}

/** "2.5 km · 25–35 min" for one storefront, from the customer's location. */
export function EtaChip({ slug, size = "sm" }: { slug: string; size?: "sm" | "lg" }) {
  const { eta, place, setPickerOpen } = useLocationCtx();
  const e = eta[slug];
  if (!e || !place) return <span className={`eta-chip ${size} loading`} aria-hidden><span /><span /></span>;
  return (
    <span className={`eta-chip ${size}`} title={e.live ? "Live: road distance, traffic now and this kitchen's current cooking time" : "Estimated from distance and the usual traffic at this hour"}>
      <span className="eta-km"><PinIcon /> <b className="num">{e.km}</b> km</span>
      <span className="eta-time"><ClockIcon /> <b className="num">{e.low}–{e.high}</b> min{e.live ? <i className="live" aria-label="live traffic" /> : null}</span>
      {size === "lg" ? <button type="button" className="link-btn" onClick={() => setPickerOpen(true)}>from {place.label}</button> : null}
    </span>
  );
}

export function OpenBadge({ slug }: { slug: string }) {
  const { eta } = useLocationCtx();
  const e = eta[slug];
  if (!e) return null;
  return <span className={`open-badge ${e.open ? "on" : "off"}`}>{e.open ? "Open" : "Closed now"}</span>;
}

/** Header button: where we deliver to. */
export function LocationButton() {
  const { place, setPickerOpen } = useLocationCtx();
  return (
    <button type="button" className="loc-btn" onClick={() => setPickerOpen(true)} aria-haspopup="dialog">
      <PinIcon />
      <span className="loc-text"><small>Deliver to</small><b>{place ? place.label : "…"}</b></span>
      <span className="caret" aria-hidden>▾</span>
    </button>
  );
}

function LocationSheet() {
  const { setPlace, setPickerOpen, place } = useLocationCtx();
  const [q, setQ] = useState("");
  const [gps, setGps] = useState<"idle" | "busy" | "denied">("idle");
  const close = () => setPickerOpen(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const useGps = () => {
    if (!navigator.geolocation) { setGps("denied"); return; }
    setGps("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => { setPlace({ label: "My location", lat: p.coords.latitude, lng: p.coords.longitude, source: "gps" }); close(); },
      () => setGps("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const list = COMMUNES.filter(([n]) => n.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="loc-backdrop" onClick={close}>
      <div className="loc-sheet" role="dialog" aria-modal="true" aria-label="Where should we deliver?" onClick={(e) => e.stopPropagation()}>
        <div className="loc-head">
          <h2>Where should we deliver?</h2>
          <button type="button" className="sheet-x" onClick={close} aria-label="Close">×</button>
        </div>
        <button type="button" className="gps-btn" onClick={useGps} disabled={gps === "busy"}>
          <span className="gps-dot" aria-hidden /> {gps === "busy" ? "Finding you…" : "Use my current location"}
        </button>
        {gps === "denied" ? <p className="muted small">Location is off for this site. Pick your commune instead; you can drop an exact pin at checkout.</p> : null}
        <input className="sheet-search" autoFocus placeholder="Search your commune" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="commune-grid">
          {list.map(([n, lat, lng]) => (
            <button type="button" key={n} className={place?.label === n ? "on" : ""} onClick={() => { setPlace({ label: n, lat, lng, source: "commune" }); close(); }}>{n}</button>
          ))}
        </div>
        <p className="muted small">Distances are by road from each kitchen; times include cooking and the traffic right now.</p>
      </div>
    </div>
  );
}

/** Sorts and filters the server-rendered storefront cards in place ([data-store][data-slug]). */
export function StoreSorter({ scope }: { scope: string }) {
  const { eta, stores } = useLocationCtx();
  const [sort, setSort] = useState<"near" | "fast" | "top">("near");
  const [openOnly, setOpenOnly] = useState(false);
  useEffect(() => {
    const rating = new Map(stores.map((s) => [s.slug, s.rating]));
    const cards = [...document.querySelectorAll<HTMLElement>(`[data-scope="${scope}"] [data-store]`)];
    const key = (slug: string) => {
      const e = eta[slug];
      if (!e) return 0;
      return sort === "near" ? e.meters : sort === "fast" ? e.minutes : -(rating.get(slug) ?? 0);
    };
    cards
      .map((el) => ({ el, slug: el.dataset.slug ?? "" }))
      .sort((a, b) => Number(eta[b.slug]?.open ?? true) - Number(eta[a.slug]?.open ?? true) || key(a.slug) - key(b.slug))
      .forEach(({ el, slug }, i) => {
        el.style.order = String(i);
        el.dataset.closed = openOnly && eta[slug] && !eta[slug].open ? "1" : "";
      });
  }, [eta, sort, openOnly, stores, scope]);
  const chip = (k: typeof sort, label: string) => (
    <button type="button" role="radio" aria-checked={sort === k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{label}</button>
  );
  return (
    <div className="sorter">
      <div className="chips" role="radiogroup" aria-label="Sort">
        {chip("near", "Nearest")}
        {chip("fast", "Fastest")}
        {chip("top", "Top rated")}
      </div>
      <button type="button" className={`chip-toggle ${openOnly ? "on" : ""}`} aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>Open now</button>
    </div>
  );
}
