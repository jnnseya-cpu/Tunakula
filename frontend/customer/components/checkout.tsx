"use client";
/**
 * Checkout: delivery or collection, where to, a live quote from the API (the client never computes a
 * total), tip, then mobile money or cash. Placing is idempotent: the same attempt never makes two orders.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, getSession, listAddresses, live, loadCart, money, rememberCode, saveAddress, saveCart, walletBalance, type Cart, type MoneyWire, type SavedAddress } from "../lib/api";
import { useLocationCtx } from "./location";

interface Quote {
  branch: { id: string; name: string };
  lines: { item_id: string; name: string; quantity: number; total: MoneyWire; options?: string[] }[];
  price_lines: { code: string; amount: MoneyWire }[];
  total: MoneyWire;
  distance_meters?: number;
  /** Present for a signed-in member: the platform-funded benefit and the resulting payable total. */
  membership?: { plan_name: string; free_delivery: boolean; discount: MoneyWire; payable_total: MoneyWire };
  /** Present when a valid promo code is applied. */
  coupon?: { code: string; discount: MoneyWire };
  /** Present for a referee's first order: the referral discount funded by the platform. */
  referral?: { discount: MoneyWire };
  /** The final amount after every discount (membership + coupon + referral); use this when present. */
  payable?: MoneyWire;
  /** The cart has an age-restricted item; the customer must confirm 18+. */
  age_restricted?: boolean;
}
type Mode = "DELIVERY" | "TAKEAWAY";
type Pay = "MOBILE_MONEY_PUSH" | "CARD" | "CASH_ON_DELIVERY" | "WALLET";

const LINE_LABEL: Record<string, string> = { GOODS: "Food", SERVICE_CHARGE: "Service charge (10%)", DELIVERY_FEE: "Delivery", DELIVERY_PROMOTION: "Delivery offer", TIP: "Tip for your rider" };
const PAY_LABEL: Record<string, [string, string]> = {
  WALLET: ["Wallet", "Pay instantly from your Tunakula balance"],
  MOBILE_MONEY_PUSH: ["Mobile money", "M-Pesa, Orange Money or Airtel Money — approve on your phone"],
  CARD: ["Card", "Visa or Mastercard"],
  CASH_ON_DELIVERY: ["Cash on delivery", "Pay the rider in francs or dollars"],
};
const TIPS = ["0", "0.50", "1.00", "2.00"];

/** Half-hour slots for the chosen day, at least the schedule lead ahead (the API enforces the real floor). */
const SCHEDULE_LEAD_MIN = 30;
function scheduleSlots(day: string): [string, string][] {
  const out: [string, string][] = [];
  const base = new Date(`${day}T00:00:00`);
  const floor = Date.now() + SCHEDULE_LEAD_MIN * 60_000;
  for (let m = 8 * 60; m <= 22 * 60; m += 30) {
    const d = new Date(base.getTime() + m * 60_000);
    if (d.getTime() < floor) continue;
    out.push([d.toISOString(), d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })]);
  }
  return out;
}

export function Checkout() {
  const { place, setPlace, setPickerOpen } = useLocationCtx();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [mode, setMode] = useState<Mode>("DELIVERY");
  const [landmark, setLandmark] = useState("");
  const [kitchenNote, setKitchenNote] = useState("");
  const [when, setWhen] = useState<"ASAP" | "LATER">("ASAP");
  const [schedDay, setSchedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [schedTime, setSchedTime] = useState("");
  const [tip, setTip] = useState("0");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [wallet, setWallet] = useState<MoneyWire | null>(null);
  const [pay, setPay] = useState<Pay>("MOBILE_MONEY_PUSH");
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [promo, setPromo] = useState("");
  const [ageOk, setAgeOk] = useState(false);
  const [promoApplied, setPromoApplied] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; total: string } | null>(null);
  const placed = useRef<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("branch");
    setBranchId(id);
    if (id) setCart(loadCart(id));
    const s = getSession();
    setSignedIn(!!s);
    if (s) walletBalance().then((bs) => setWallet(bs.find((b) => b.currency === "USD") ?? bs[0] ?? null)).catch(() => undefined);
    if (s) {
      setMsisdn(s.phone);
      listAddresses().then((a) => { setAddresses(a); const d = a.find((x) => x.is_default); if (d && !place) pickAddress(d); }).catch(() => undefined);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickAddress = (a: SavedAddress) => {
    setPlace({ lat: a.lat, lng: a.lng, label: a.label, source: "saved" });
    if (a.landmark) setLandmark(a.landmark);
  };
  const saveCurrent = async () => {
    if (!place) return;
    try {
      const label = window.prompt("Name this address (e.g. Home, Work)", place.label ?? "Home");
      if (!label) return;
      const a = await saveAddress({ label, lat: place.lat, lng: place.lng, ...(landmark.trim() ? { landmark: landmark.trim() } : {}) });
      setAddresses((prev) => [a, ...prev.filter((x) => x.id !== a.id)]);
      setSavedMsg("Saved to your addresses.");
    } catch (e) { setSavedMsg((e as ApiError).message); }
  };

  const body = useMemo(() => cart && {
    branch_id: cart.branch_id,
    items: cart.lines.map((l) => ({ item_id: l.item_id, quantity: l.qty, ...(l.options?.length ? { options: l.options } : {}), ...(l.addons?.length ? { addons: l.addons } : {}) })),
    order_type: mode,
    ...(mode === "DELIVERY" && place ? { delivery: { lat: place.lat, lng: place.lng } } : {}),
    ...(mode === "DELIVERY" && tip !== "0" ? { tip } : {}),
    ...(promoApplied ? { coupon_code: promoApplied } : {}),
  }, [cart, mode, place, tip, promoApplied]);

  useEffect(() => {
    if (!body || !body.items.length || !live()) return;
    let stale = false;
    setQuoteError(null);
    // Signed in → the quote carries the member's benefit (the token identifies them); a guest sees the plain price.
    api<Quote>("/v1/carts/quote", { method: "POST", body })
      .then((q) => { if (!stale) { setQuote(q); if (q.coupon) setPromoError(null); } })
      .catch((e: ApiError) => {
        if (stale) return;
        // A bad promo code must not blank the whole checkout: drop it and show a promo error instead.
        if (e.code.startsWith("COUPON_") && promoApplied) { setPromoError(e.message); setPromoApplied(""); }
        else { setQuote(null); setQuoteError(e.message); }
      });
    return () => { stale = true; };
  }, [body]);

  useEffect(() => {
    if (!quote) return;
    const due = quote.payable ?? quote.membership?.payable_total ?? quote.total;
    api<{ data: string[] }>(`/v1/countries/CD/payment-methods?amount_minor=${due.amount_minor}&currency=${due.currency}`, { auth: false })
      .then((r) => {
        const usable = r.data.filter((m) => m === "MOBILE_MONEY_PUSH" || m === "CARD" || m === "CASH_ON_DELIVERY");
        if (mode === "DELIVERY" && !usable.includes("CASH_ON_DELIVERY")) usable.push("CASH_ON_DELIVERY");
        setMethods(usable);
        if (pay !== "WALLET" && !usable.includes(pay)) setPay((usable[0] as Pay) ?? "MOBILE_MONEY_PUSH");
      })
      .catch(() => setMethods(["MOBILE_MONEY_PUSH", "CASH_ON_DELIVERY"]));
  }, [quote?.total.amount_minor, quote?.membership?.payable_total.amount_minor, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // A member pays the discounted total; everyone else the plain total.
      const due = quote.payable ?? quote.membership?.payable_total ?? quote.total;
      let orderId = placed.current;
      if (!orderId) {
        // One Idempotency-Key per total: a retry of the same attempt replays, a new price is a new attempt.
        if (!attempt.current || attempt.current.total !== due.amount_minor) attempt.current = { key: crypto.randomUUID(), total: due.amount_minor };
        setBusy("Placing your order…");
        const r = await api<{ order_id: string; recipient_code: string; state: string }>("/v1/orders", {
          method: "POST", key: attempt.current.key,
          body: { ...body, payment_mode: pay === "CASH_ON_DELIVERY" ? "CASH_ON_DELIVERY" : pay === "WALLET" ? "WALLET" : "PREPAID", expected_total: due, ...(quote.age_restricted ? { age_confirmed: true } : {}), ...(kitchenNote.trim() ? { kitchen_note: kitchenNote.trim() } : {}), ...(when === "LATER" ? { scheduled_for: schedTime || scheduleSlots(schedDay)[0]?.[0] } : {}), ...(landmark.trim() ? { address: { landmark: landmark.trim() } } : {}) },
        });
        orderId = r.order_id;
        placed.current = orderId;
        rememberCode(orderId, r.recipient_code);
      }
      // Cash and wallet orders are placed already paid; only card/mobile money need a payment intent.
      if (pay !== "CASH_ON_DELIVERY" && pay !== "WALLET") {
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
        api<Quote>("/v1/carts/quote", { method: "POST", body }).then(setQuote).catch(() => undefined);
      } else setError(err.message);
    }
  };

  const km = quote?.distance_meters !== undefined ? (Math.round(quote.distance_meters / 100) / 10).toFixed(1) : null;
  const dueNow = quote ? (quote.payable ?? quote.membership?.payable_total ?? quote.total) : null;
  const walletCovers = !!(wallet && dueNow && wallet.currency === dueNow.currency && BigInt(wallet.amount_minor) >= BigInt(dueNow.amount_minor));
  // Always offer the wallet to a signed-in customer; it is only selectable once the balance covers the total.
  const payOptions = [...(wallet ? ["WALLET"] : []), ...methods];
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

        <section className="co-sec">
          <h2>When?</h2>
          <div className="seg2 big" role="radiogroup" aria-label="Now or scheduled">
            {(["ASAP", "LATER"] as const).map((w) => (
              <button type="button" key={w} role="radio" aria-checked={when === w} className={when === w ? "on" : ""} onClick={() => setWhen(w)}>
                <b>{w === "ASAP" ? "As soon as possible" : "Schedule for later"}</b><small>{w === "ASAP" ? "We start cooking now" : "Pick a day and time"}</small>
              </button>
            ))}
          </div>
          {when === "LATER" ? (
            <div className="sched-grid">
              <label className="field"><span>Day</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={schedDay} onChange={(e) => { setSchedDay(e.target.value); setSchedTime(""); }} /></label>
              <label className="field"><span>Time</span>
                <select value={schedTime || scheduleSlots(schedDay)[0]?.[0] || ""} onChange={(e) => setSchedTime(e.target.value)}>
                  {scheduleSlots(schedDay).length ? scheduleSlots(schedDay).map(([v, l]) => <option key={v} value={v}>{l}</option>) : <option value="">No slots left today</option>}
                </select>
              </label>
            </div>
          ) : null}
        </section>

        {mode === "DELIVERY" ? (
          <section className="co-sec">
            <h2>Where to?</h2>
            <div className="addr">
              <div><b>{place?.label ?? "…"}</b><small>{place?.source === "gps" ? "Your current location" : place?.source === "saved" ? "Saved address" : "Commune centre — use your exact location for a precise fee"}</small></div>
              <button type="button" className="btn light" onClick={() => setPickerOpen(true)}>Change</button>
            </div>
            {signedIn ? (
              <div className="saved-addr">
                {addresses.map((a) => (
                  <button type="button" key={a.id} className={`saved-chip ${place?.label === a.label ? "on" : ""}`} onClick={() => pickAddress(a)}>📍 {a.label}{a.is_default ? " ·default" : ""}</button>
                ))}
                {place && !addresses.some((a) => a.label === place.label) ? <button type="button" className="saved-chip add" onClick={saveCurrent}>+ Save this address</button> : null}
                {savedMsg ? <span className="muted small">{savedMsg}</span> : null}
              </div>
            ) : null}
            <label className="field"><span>Directions for the rider</span><textarea rows={2} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Avenue, number, landmark — e.g. blue gate opposite the Sainte-Anne pharmacy" /></label>
            <div className="tips" role="radiogroup" aria-label="Tip for your rider">
              <span>Tip your rider</span>
              {TIPS.map((t) => <button type="button" key={t} role="radio" aria-checked={tip === t} className={tip === t ? "on" : ""} onClick={() => setTip(t)}>{t === "0" ? "No tip" : `$${t}`}</button>)}
            </div>
          </section>
        ) : null}

        <section className="co-sec">
          <h2>Note for the kitchen</h2>
          <label className="field"><span>Anything the kitchen should know</span><textarea rows={2} value={kitchenNote} onChange={(e) => setKitchenNote(e.target.value)} placeholder="e.g. no cutlery, extra spicy, no onions" maxLength={280} /></label>
        </section>

        <section className="co-sec">
          <h2>Pay with</h2>
          <div className="pay-list" role="radiogroup" aria-label="Payment method">
            {payOptions.map((m) => (
              <button type="button" key={m} role="radio" aria-checked={pay === m} className={`pay-opt ${pay === m ? "on" : ""}`} onClick={() => setPay(m as Pay)} disabled={(m === "CASH_ON_DELIVERY" && mode !== "DELIVERY") || (m === "WALLET" && !walletCovers)}>
                <span className="radio" aria-hidden /><span><b>{PAY_LABEL[m]?.[0] ?? m}</b><small>{m === "WALLET" && wallet ? (walletCovers ? `Balance ${money(wallet)}` : `Balance ${money(wallet)} · top up to use`) : PAY_LABEL[m]?.[1]}</small></span>
              </button>
            ))}
            {wallet && !walletCovers ? <Link className="wallet-topup-hint" href="/wallet/">Top up your wallet ({money(wallet)}) to pay from your balance →</Link> : null}
          </div>
          {pay === "MOBILE_MONEY_PUSH" ? <label className="field"><span>Mobile money number</span><input inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} /></label> : null}
        </section>
      </div>

      <aside className="co-summary">
        <h2>Summary</h2>
        <ul className="cart-lines">
          {(quote?.lines ?? cart.lines.map((l) => ({ item_id: l.item_id, name: l.name, quantity: l.qty, total: null as MoneyWire | null, options: l.descriptors }))).map((l, i) => (
            <li key={i}><span className="q">{l.quantity}×</span><span className="cl-name">{l.name}{l.options?.length ? <small className="cl-opts">{l.options.join(" · ")}</small> : null}</span><span className="num">{l.total ? money(l.total) : "…"}</span></li>
          ))}
        </ul>
        {signedIn ? (
          <div className="promo">
            {quote?.coupon ? (
              <div className="promo-applied"><span>✓ Promo <b>{quote.coupon.code}</b> applied</span><button type="button" className="link-btn" onClick={() => { setPromoApplied(""); setPromo(""); setPromoError(null); }}>Remove</button></div>
            ) : (
              <div className="promo-row">
                <input value={promo} onChange={(e) => { setPromo(e.target.value.toUpperCase()); setPromoError(null); }} placeholder="Promo code" aria-label="Promo code" />
                <button type="button" className="btn light" disabled={!promo.trim()} onClick={() => setPromoApplied(promo.trim())}>Apply</button>
              </div>
            )}
            {promoError ? <p className="form-error small">{promoError}</p> : null}
          </div>
        ) : null}
        {quote ? (
          <dl className="price-lines">
            {quote.price_lines.map((p) => (
              <div key={p.code}><dt>{LINE_LABEL[p.code] ?? p.code}{p.code === "DELIVERY_FEE" && km ? ` · ${km} km` : ""}</dt><dd className="num">{money(p.amount)}</dd></div>
            ))}
            {quote.membership ? (
              <div className="member-save"><dt>{quote.membership.plan_name}{quote.membership.free_delivery ? " · free delivery" : ""}</dt><dd className="num">−{money(quote.membership.discount)}</dd></div>
            ) : null}
            {quote.coupon ? (
              <div className="member-save"><dt>Promo {quote.coupon.code}</dt><dd className="num">−{money(quote.coupon.discount)}</dd></div>
            ) : null}
            {quote.referral ? (
              <div className="member-save"><dt>Referral — no service fee</dt><dd className="num">−{money(quote.referral.discount)}</dd></div>
            ) : null}
            <div className="total"><dt>Total</dt><dd className="num">{money(quote.payable ?? quote.membership?.payable_total ?? quote.total)}</dd></div>
          </dl>
        ) : quoteError ? <p className="form-error">{quoteError}</p> : <div className="skeleton-line" />}
        <p className="muted small">Restaurants pay 0% commission: dishes are at the counter price. Our 10% service charge is shown on its own line.</p>
        {quote?.age_restricted ? (
          <label className="age-gate"><input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} /> I confirm I am 18 or older. The rider will check ID at the door for the age-restricted items.</label>
        ) : null}
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="button" className="btn accent wide big" disabled={!quote || !!busy || (quote?.age_restricted && !ageOk) || (pay === "MOBILE_MONEY_PUSH" && msisdn.replace(/\D/g, "").length < 9)} onClick={placeOrder}>
          {busy ?? (quote ? `Place order · ${money(quote.payable ?? quote.membership?.payable_total ?? quote.total)}` : "Place order")}
        </button>
        <Link className="link-btn" href={`/store/?id=${cart.branch_id}`}>Change my order</Link>
      </aside>
    </div>
  );
}
