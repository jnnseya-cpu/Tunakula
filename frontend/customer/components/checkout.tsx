"use client";
/**
 * Checkout: delivery or collection, where to, a live quote from the API (the client never computes a
 * total), tip, then mobile money or cash. Placing is idempotent: the same attempt never makes two orders.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, getSession, live, loadCart, money, rememberCode, saveCart, type Cart, type MoneyWire } from "../lib/api";
import { useLocationCtx } from "./location";

interface Quote {
  branch: { id: string; name: string };
  lines: { item_id: string; name: string; quantity: number; total: MoneyWire }[];
  price_lines: { code: string; amount: MoneyWire }[];
  total: MoneyWire;
  distance_meters?: number;
}
type Mode = "DELIVERY" | "TAKEAWAY";
type Pay = "MOBILE_MONEY_PUSH" | "CARD" | "CASH_ON_DELIVERY";

const LINE_LABEL: Record<string, string> = { GOODS: "Food", SERVICE_CHARGE: "Service charge (10%)", DELIVERY_FEE: "Delivery", DELIVERY_PROMOTION: "Delivery offer", TIP: "Tip for your rider" };
const PAY_LABEL: Record<string, [string, string]> = {
  MOBILE_MONEY_PUSH: ["Mobile money", "M-Pesa, Orange Money or Airtel Money — approve on your phone"],
  CARD: ["Card", "Visa or Mastercard"],
  CASH_ON_DELIVERY: ["Cash on delivery", "Pay the rider in francs or dollars"],
};
const TIPS = ["0", "0.50", "1.00", "2.00"];

export function Checkout() {
  const { place, setPickerOpen } = useLocationCtx();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [mode, setMode] = useState<Mode>("DELIVERY");
  const [landmark, setLandmark] = useState("");
  const [tip, setTip] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [pay, setPay] = useState<Pay>("MOBILE_MONEY_PUSH");
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const attempt = useRef<{ key: string; total: string } | null>(null);
  const placed = useRef<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("branch");
    setBranchId(id);
    if (id) setCart(loadCart(id));
    const s = getSession();
    setSignedIn(!!s);
    if (s) setMsisdn(s.phone);
  }, []);

  const body = useMemo(() => cart && {
    branch_id: cart.branch_id,
    items: cart.lines.map((l) => ({ item_id: l.item_id, quantity: l.qty })),
    order_type: mode,
    ...(mode === "DELIVERY" && place ? { delivery: { lat: place.lat, lng: place.lng } } : {}),
    ...(mode === "DELIVERY" && tip !== "0" ? { tip } : {}),
  }, [cart, mode, place, tip]);

  useEffect(() => {
    if (!body || !body.items.length || !live()) return;
    let stale = false;
    setQuoteError(null);
    api<Quote>("/v1/carts/quote", { method: "POST", body, auth: false })
      .then((q) => { if (!stale) setQuote(q); })
      .catch((e: ApiError) => { if (!stale) { setQuote(null); setQuoteError(e.message); } });
    return () => { stale = true; };
  }, [body]);

  useEffect(() => {
    if (!quote) return;
    api<{ data: string[] }>(`/v1/countries/CD/payment-methods?amount_minor=${quote.total.amount_minor}&currency=${quote.total.currency}`, { auth: false })
      .then((r) => {
        const usable = r.data.filter((m) => m === "MOBILE_MONEY_PUSH" || m === "CARD" || m === "CASH_ON_DELIVERY");
        if (mode === "DELIVERY" && !usable.includes("CASH_ON_DELIVERY")) usable.push("CASH_ON_DELIVERY");
        setMethods(usable);
        if (!usable.includes(pay)) setPay((usable[0] as Pay) ?? "MOBILE_MONEY_PUSH");
      })
      .catch(() => setMethods(["MOBILE_MONEY_PUSH", "CASH_ON_DELIVERY"]));
  }, [quote?.total.amount_minor, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live()) return <div className="app-card"><h1 className="app-title">Checkout</h1><p className="muted">Ordering opens at launch.</p></div>;
  if (signedIn === null || branchId === null) return <div className="skeleton-line" />;
  if (!cart || !cart.lines.length) {
    return <div className="app-card"><h1 className="app-title">Your order is empty</h1><p className="muted">Add dishes from a restaurant first.</p><Link className="btn accent" href="/order/">See restaurants</Link></div>;
  }
  if (!signedIn) {
    const next = encodeURIComponent(`/checkout/?branch=${branchId}`);
    return (
      <div className="app-card">
        <h1 className="app-title">Sign in to order</h1>
        <p className="muted">Your phone number is your account: the kitchen and your rider can reach you, and only you can pay for your order.</p>
        <Link className="btn accent" href={`/signin/?next=${next}`}>Sign in with my phone</Link>
      </div>
    );
  }

  const placeOrder = async () => {
    if (!quote || !body) return;
    setError(null); setNotice(null);
    try {
      let orderId = placed.current;
      if (!orderId) {
        // One Idempotency-Key per total: a retry of the same attempt replays, a new price is a new attempt.
        if (!attempt.current || attempt.current.total !== quote.total.amount_minor) attempt.current = { key: crypto.randomUUID(), total: quote.total.amount_minor };
        setBusy("Placing your order…");
        const r = await api<{ order_id: string; recipient_code: string; state: string }>("/v1/orders", {
          method: "POST", key: attempt.current.key,
          body: { ...body, payment_mode: pay === "CASH_ON_DELIVERY" ? "CASH_ON_DELIVERY" : "PREPAID", expected_total: quote.total, ...(landmark.trim() ? { address: { landmark: landmark.trim() } } : {}) },
        });
        orderId = r.order_id;
        placed.current = orderId;
        rememberCode(orderId, r.recipient_code);
      }
      if (pay !== "CASH_ON_DELIVERY") {
        setBusy(pay === "MOBILE_MONEY_PUSH" ? "Approve the payment on your phone…" : "Processing your card…");
        const intent = await api<{ status: string; reason_code?: string; next_action?: { url?: string } }>("/v1/payments/intents", {
          method: "POST", key: `pay-${orderId}-${pay}-${msisdn}`,
          body: { order_id: orderId, method_type: pay, payer: pay === "MOBILE_MONEY_PUSH" ? { msisdn: msisdn.replace(/\s/g, "") } : {} },
        });
        if (intent.status === "FAILED") {
          setBusy(null);
          setError(`The payment did not go through${intent.reason_code ? ` (${intent.reason_code.replace(/_/g, " ").toLowerCase()})` : ""}. Try again or choose another way to pay.`);
          return;
        }
        if (intent.next_action?.url) { window.location.href = intent.next_action.url; return; }
      }
      saveCart({ ...cart, lines: [] });
      window.location.href = `/track/?id=${orderId}`;
    } catch (e) {
      const err = e as ApiError;
      setBusy(null);
      if (err.code === "PRICE_CHANGED") {
        setNotice("The price changed since you opened checkout. Here is the new total — tap Place order to confirm it.");
        api<Quote>("/v1/carts/quote", { method: "POST", body, auth: false }).then(setQuote).catch(() => undefined);
      } else setError(err.message);
    }
  };

  const km = quote?.distance_meters !== undefined ? (Math.round(quote.distance_meters / 100) / 10).toFixed(1) : null;
  return (
    <div className="checkout">
      <div className="co-main">
        <h1 className="app-title">Checkout</h1>
        <p className="muted">From <b>{cart.branch_name}</b></p>

        <section className="co-sec">
          <h2>How do you want it?</h2>
          <div className="seg2 big" role="radiogroup" aria-label="Delivery or collection">
            {(["DELIVERY", "TAKEAWAY"] as const).map((m) => (
              <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                <b>{m === "DELIVERY" ? "Delivery" : "Collect it"}</b><small>{m === "DELIVERY" ? "A rider brings it to you" : "Pick it up at the counter"}</small>
              </button>
            ))}
          </div>
        </section>

        {mode === "DELIVERY" ? (
          <section className="co-sec">
            <h2>Where to?</h2>
            <div className="addr">
              <div><b>{place?.label ?? "…"}</b><small>{place?.source === "gps" ? "Your current location" : "Commune centre — use your exact location for a precise fee"}</small></div>
              <button type="button" className="btn light" onClick={() => setPickerOpen(true)}>Change</button>
            </div>
            <label className="field"><span>Directions for the rider</span><textarea rows={2} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Avenue, number, landmark — e.g. blue gate opposite the Sainte-Anne pharmacy" /></label>
            <div className="tips" role="radiogroup" aria-label="Tip for your rider">
              <span>Tip your rider</span>
              {TIPS.map((t) => <button type="button" key={t} role="radio" aria-checked={tip === t} className={tip === t ? "on" : ""} onClick={() => setTip(t)}>{t === "0" ? "No tip" : `$${t}`}</button>)}
            </div>
          </section>
        ) : null}

        <section className="co-sec">
          <h2>Pay with</h2>
          <div className="pay-list" role="radiogroup" aria-label="Payment method">
            {methods.map((m) => (
              <button type="button" key={m} role="radio" aria-checked={pay === m} className={`pay-opt ${pay === m ? "on" : ""}`} onClick={() => setPay(m as Pay)} disabled={m === "CASH_ON_DELIVERY" && mode !== "DELIVERY"}>
                <span className="radio" aria-hidden /><span><b>{PAY_LABEL[m]?.[0] ?? m}</b><small>{PAY_LABEL[m]?.[1]}</small></span>
              </button>
            ))}
          </div>
          {pay === "MOBILE_MONEY_PUSH" ? <label className="field"><span>Mobile money number</span><input inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} /></label> : null}
        </section>
      </div>

      <aside className="co-summary">
        <h2>Summary</h2>
        <ul className="cart-lines">
          {(quote?.lines ?? cart.lines.map((l) => ({ item_id: l.item_id, name: l.name, quantity: l.qty, total: null as MoneyWire | null }))).map((l) => (
            <li key={l.item_id}><span className="q">{l.quantity}×</span><span className="cl-name">{l.name}</span><span className="num">{l.total ? money(l.total) : "…"}</span></li>
          ))}
        </ul>
        {quote ? (
          <dl className="price-lines">
            {quote.price_lines.map((p) => (
              <div key={p.code}><dt>{LINE_LABEL[p.code] ?? p.code}{p.code === "DELIVERY_FEE" && km ? ` · ${km} km` : ""}</dt><dd className="num">{money(p.amount)}</dd></div>
            ))}
            <div className="total"><dt>Total</dt><dd className="num">{money(quote.total)}</dd></div>
          </dl>
        ) : quoteError ? <p className="form-error">{quoteError}</p> : <div className="skeleton-line" />}
        <p className="muted small">Restaurants pay 0% commission: dishes are at the counter price. Our 10% service charge is shown on its own line.</p>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="button" className="btn accent wide big" disabled={!quote || !!busy || (pay === "MOBILE_MONEY_PUSH" && msisdn.replace(/\D/g, "").length < 9)} onClick={placeOrder}>
          {busy ?? (quote ? `Place order · ${money(quote.total)}` : "Place order")}
        </button>
        <Link className="link-btn" href={`/store/?id=${cart.branch_id}`}>Change my order</Link>
      </aside>
    </div>
  );
}
