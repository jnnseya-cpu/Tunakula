"use client";
/** Order tracking (/track/?id=) with live progress and the door code, and the order history (/orders/). */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, live, money, recallCode, setSession, STATE_LABEL, type MoneyWire } from "../lib/api";
import { useSession } from "./account";
import { localHour, modelSeconds } from "@tunakula/ts-contracts/eta-model";
import { ClockIcon, PinIcon, useLocationCtx } from "./location";
import { TileMap } from "./map";

interface OrderView {
  order_id: string; state: string; type: string; total: MoneyWire; payment_mode: string; rider_id: string | null;
  lines: { name: string; quantity: number }[];
  branch: { id: string; name: string; commune: string | null; lat?: number; lng?: number } | null;
  timeline: { state: string; at: string }[];
  rider: { name: string; position?: { lat: number; lng: number; updated_at: string }; meters_to_you?: number } | null;
  drop: { lat: number; lng: number } | null;
}
interface Row { order_id: string; state: string; type: string; total: MoneyWire; created_at: string; scheduled_for?: string; branch: { id: string; name: string; commune: string | null } }

const RIDER_STEPS = ["PLACED", "ACCEPTED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"];
const COUNTER_STEPS = ["PLACED", "ACCEPTED", "PREPARING", "READY", "DELIVERED"];
const STEP_LABEL: Record<string, string> = { PLACED: "Order sent", ACCEPTED: "Accepted", PREPARING: "Cooking", READY: "Ready", PICKED_UP: "On the way", DELIVERED: "Delivered" };
/** Minutes for the rider to reach the door: road distance at this hour's traffic, plus parking and stairs. */
const riderMinutes = (meters: number) => Math.max(2, Math.round(modelSeconds(meters, "MOTO", localHour(new Date(), "Africa/Kinshasa")) / 60) + 2);
const TERMINAL = new Set(["DELIVERED", "CANCELLED", "REJECTED", "REFUNDED", "EXPIRED", "DELIVERY_FAILED", "PAYMENT_FAILED"]);
const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Kinshasa" });

function NeedSignIn({ next }: { next: string }) {
  return (
    <div className="app-card">
      <h1 className="app-title">Sign in to see your orders</h1>
      <Link className="btn accent" href={`/signin/?next=${encodeURIComponent(next)}`}>Sign in with my phone</Link>
    </div>
  );
}

export function Tracking() {
  const session = useSession();
  const { place } = useLocationCtx();
  const [id, setId] = useState<string | null>(null);
  const [o, setO] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<{ eta: { low: number; high: number }; distance_km: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setId(new URLSearchParams(window.location.search).get("id")); }, []);
  useEffect(() => {
    if (!id || !session) return;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => api<OrderView>(`/v1/orders/${id}`).then((v) => {
      setO(v); setError(null);
      if (!TERMINAL.has(v.state)) timer = setTimeout(load, 8000);
    }).catch((e: ApiError) => { setError(e.message); timer = setTimeout(load, 15000); });
    load();
    return () => clearTimeout(timer);
  }, [id, session]);
  useEffect(() => {
    if (!o?.branch || !place || TERMINAL.has(o.state)) return;
    api<{ eta: { low: number; high: number }; distance_km: string }>(`/v1/branches/${o.branch.id}/eta?lat=${place.lat}&lng=${place.lng}`, { auth: false }).then(setEta).catch(() => undefined);
  }, [o?.branch?.id, o?.state, place]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live()) return <div className="app-card"><p className="muted">Ordering opens at launch.</p></div>;
  if (session === undefined || !id) return <div className="skeleton-line" />;
  if (!session) return <NeedSignIn next={`/track/?id=${id}`} />;
  if (error && !o) return <div className="app-card"><h1 className="app-title">We could not load this order</h1><p className="muted">{error}</p><Link className="btn light" href="/orders/">My orders</Link></div>;
  if (!o) return <div className="skeleton-cover" />;

  const steps = o.type === "DELIVERY" || o.type === "SCHEDULED" || o.type === "XBO" ? RIDER_STEPS : COUNTER_STEPS;
  const reached = new Map(o.timeline.map((t) => [t.state, t.at]));
  const current = steps.reduce((last, s, i) => (reached.has(s) ? i : last), -1);
  const code = recallCode(o.order_id);
  const failed = ["CANCELLED", "REJECTED", "DELIVERY_FAILED", "PAYMENT_FAILED", "EXPIRED"].includes(o.state);
  const cancel = async () => {
    if (!window.confirm("Cancel this order? If you paid, the money comes back to you.")) return;
    setBusy(true);
    try { setO(await api<OrderView>(`/v1/orders/${o.order_id}/transitions`, { method: "POST", body: { command: { type: "CANCEL", reasonCode: "CHANGED_MIND" } } }).then(() => api<OrderView>(`/v1/orders/${o.order_id}`))); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <div className="track">
      <div className={`track-hero ${failed ? "bad" : o.state === "DELIVERED" ? "done" : ""}`}>
        <p className="eyebrow light">{o.branch?.name}{o.branch?.commune ? ` · ${o.branch.commune}` : ""}</p>
        <h1>{STATE_LABEL[o.state] ?? o.state}</h1>
        {o.state === "PICKED_UP" && o.rider?.meters_to_you !== undefined ? (
          <p className="track-eta"><ClockIcon /> Arriving in about <b>{riderMinutes(o.rider.meters_to_you)} min</b></p>
        ) : !TERMINAL.has(o.state) && eta && o.type === "DELIVERY" ? (
          <p className="track-eta"><ClockIcon /> Arriving in about <b>{eta.eta.low}–{eta.eta.high} min</b> · <PinIcon /> {eta.distance_km} km away</p>
        ) : null}
        {o.rider && !TERMINAL.has(o.state) ? (
          <p className="track-rider">
            <span className="rider-avatar" aria-hidden>{o.rider.name.slice(0, 1)}</span>
            {o.state === "PICKED_UP"
              ? <>{o.rider.name} is on the way{o.rider.meters_to_you !== undefined ? <> · <b>{(o.rider.meters_to_you / 1000).toFixed(1)} km</b> from you</> : null}</>
              : <>{o.rider.name} will bring your order</>}
          </p>
        ) : null}
        {o.state === "PENDING_PAYMENT" ? <p className="track-eta">Approve the mobile money request on your phone. This page updates by itself.</p> : null}
      </div>

      {!TERMINAL.has(o.state) && o.branch?.lat !== undefined ? (
        <TileMap
          className="track-map"
          height={240}
          pins={[
            { lat: o.branch.lat, lng: o.branch.lng!, kind: "kitchen", label: "🍲", title: o.branch.name },
            ...(o.drop ? [{ lat: o.drop.lat, lng: o.drop.lng, kind: "drop" as const, label: "You", title: "Your door" }] : []),
            ...(o.rider?.position ? [{ lat: o.rider.position.lat, lng: o.rider.position.lng, kind: "rider-busy" as const, label: o.rider.name.slice(0, 1), title: o.rider.name }] : []),
          ]}
          routes={o.drop ? [
            ...(o.rider?.position && o.state === "PICKED_UP" ? [{ from: { lat: o.branch.lat, lng: o.branch.lng! }, to: o.rider.position, done: true }, { from: o.rider.position, to: o.drop }] : [{ from: { lat: o.branch.lat, lng: o.branch.lng! }, to: o.drop }]),
          ] : []}
        />
      ) : null}

      {!failed ? (
        <ol className="stepper" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className={i < current ? "done" : i === current ? "now" : ""}>
              <span className="dot" aria-hidden />
              <span className="lbl">{s === "DELIVERED" && steps === COUNTER_STEPS ? "Collected" : STEP_LABEL[s]}</span>
              <span className="at num">{reached.has(s) ? time(reached.get(s)!) : ""}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {o.state === "DELIVERED" ? <RateOrder orderId={o.order_id} /> : null}

      {code && !TERMINAL.has(o.state) ? (
        <div className="door-code">
          <div><b>Your door code</b><p className="muted">Give it to {o.type === "DELIVERY" ? "the rider when your food is in your hands" : "the counter when you collect"}. Never share it before.</p></div>
          <span className="code num" aria-label={`Code ${code.split("").join(" ")}`}>{code}</span>
        </div>
      ) : null}

      <div className="app-card">
        <h2>Your order</h2>
        <ul className="cart-lines">{o.lines.map((l, i) => <li key={i}><span className="q">{l.quantity}×</span><span className="cl-name">{l.name}</span></li>)}</ul>
        <div className="cart-sub"><span>Total{o.payment_mode === "CASH_ON_DELIVERY" ? " · cash to the rider" : ""}</span><b className="num">{money(o.total)}</b></div>
        <div className="row-actions">
          {["PENDING_PAYMENT", "PLACED"].includes(o.state) ? <button type="button" className="btn light" onClick={cancel} disabled={busy}>Cancel order</button> : null}
          {o.branch ? <Link className="btn light" href={`/store/?id=${o.branch.id}`}>Order again</Link> : null}
          <a className="btn light" href="mailto:info@tunakula.com?subject=Order%20help">Get help</a>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function Stars({ value, onChange, label }: { value: number; onChange?: (n: number) => void; label: string }) {
  return (
    <div className="stars" role={onChange ? "radiogroup" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        onChange
          ? <button type="button" key={n} className={`star ${n <= value ? "on" : ""}`} aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={n <= value} onClick={() => onChange(n)}>★</button>
          : <span key={n} className={`star ${n <= value ? "on" : ""}`} aria-hidden>★</span>
      ))}
    </div>
  );
}

function RateOrder({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"loading" | "form" | "done" | "hidden">("loading");
  const [rating, setRating] = useState(0);
  const [riderRating, setRiderRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ reviewable: boolean; review: { restaurant_rating: number } | null }>(`/v1/orders/${orderId}/review`)
      .then((r) => setState(r.review ? "done" : r.reviewable ? "form" : "hidden"))
      .catch(() => setState("hidden"));
  }, [orderId]);

  const submit = async () => {
    if (rating < 1) return;
    setBusy(true); setError(null);
    try {
      await api(`/v1/orders/${orderId}/review`, { method: "POST", body: { restaurant_rating: rating, ...(riderRating ? { rider_rating: riderRating } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) } });
      setState("done");
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  if (state === "loading" || state === "hidden") return null;
  if (state === "done") return <div className="app-card rate"><p className="form-notice">Thanks for rating your order! ★</p></div>;
  return (
    <div className="app-card rate">
      <h2>How was your order?</h2>
      <label className="rate-row"><span>The restaurant</span><Stars value={rating} onChange={setRating} label="Rate the restaurant" /></label>
      <label className="rate-row"><span>Your rider</span><Stars value={riderRating} onChange={setRiderRating} label="Rate the rider" /></label>
      <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell them what you loved (optional)" />
      {error ? <p className="form-error small">{error}</p> : null}
      <button type="button" className="btn accent wide" disabled={rating < 1 || busy} onClick={submit}>{busy ? "Sending…" : "Submit rating"}</button>
    </div>
  );
}

export function OrderHistory() {
  const session = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    api<{ data: Row[] }>("/v1/me/orders?limit=50").then((r) => setRows(r.data)).catch((e: ApiError) => setError(e.message));
  }, [session]);
  if (!live()) return <div className="app-card"><h1 className="app-title">My orders</h1><p className="muted">Ordering opens at launch.</p></div>;
  if (session === undefined) return <div className="skeleton-line" />;
  if (!session) return <NeedSignIn next="/orders/" />;
  return (
    <div>
      <div className="page-head">
        <h1 className="app-title">My orders</h1>
        <button type="button" className="link-btn" onClick={() => { setSession(null); window.location.href = "/"; }}>Sign out</button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {!rows ? <div className="skeleton-line" /> : rows.length === 0 ? (
        <div className="app-card"><p className="muted">No orders yet.</p><Link className="btn accent" href="/order/">Find food near me</Link></div>
      ) : (
        <ul className="order-list">
          {rows.map((r) => (
            <li key={r.order_id} data-reveal>
              <Link href={`/track/?id=${r.order_id}`} className="order-row">
                <span className="or-main"><b>{r.branch.name}</b><small>{r.scheduled_for ? <>⏰ Scheduled {day(r.scheduled_for)} · {time(r.scheduled_for)}</> : <>{day(r.created_at)} · {time(r.created_at)}</>} · {r.type === "DELIVERY" ? "Delivery" : r.type === "TAKEAWAY" ? "Collected" : r.type}</small></span>
                <span className={`state-chip s-${r.state.toLowerCase()}`}>{STATE_LABEL[r.state] ?? r.state}</span>
                <b className="num">{money(r.total)}</b>
              </Link>
              <Link className="link-btn again" href={`/store/?id=${r.branch.id}`}>Order again</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
