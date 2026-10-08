"use client";
/**
 * Group ordering: several people fill one shared cart from their own phones via an invite link, then
 * the host places it and the bill splits per person. Entry points:
 *   /group/?branch=<id>&start=1  → create a new group for that branch
 *   /group/?code=<CODE>          → join an existing group
 *   /group/?id=<cart>            → the live shared cart
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, ApiError, getSession, groupAddItem, groupCreate, groupGet, groupJoin, groupLock, groupPlace, groupQuote, groupRemoveItem,
  live, money, rememberCode, type GroupCart, type GroupQuote, type MoneyWire,
} from "../lib/api";
import { API_URL } from "../lib/geo";
import { useLocationCtx } from "./location";

interface MenuItem { id: string; names: Record<string, string>; prices: Record<string, MoneyWire>; available: boolean; variations?: { required: boolean }[] }
const nameOf = (n: Record<string, string>) => n.fr || n.en || Object.values(n)[0] || "";

export function GroupOrder() {
  const { place } = useLocationCtx();
  const [cart, setCart] = useState<GroupCart | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [quote, setQuote] = useState<GroupQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [pay, setPay] = useState<"MOBILE_MONEY_PUSH" | "CASH_ON_DELIVERY">("CASH_ON_DELIVERY");
  const bootstrapped = useRef(false);

  const me = getSession()?.userId;
  const isHost = cart && me && cart.host_user_id === me;

  const loadMenu = useCallback((branchId: string) => {
    fetch(`${API_URL}/v1/branches/${branchId}/menu`, { headers: { "x-country": "CD" } })
      .then((r) => r.json()).then((m) => setMenu(m.items ?? [])).catch(() => setMenu([]));
  }, []);

  // One-time bootstrap from the URL.
  useEffect(() => {
    if (bootstrapped.current || !live()) { if (!live()) setSignedIn(false); return; }
    bootstrapped.current = true;
    const sp = new URLSearchParams(window.location.search);
    const s = getSession();
    setSignedIn(!!s);
    if (!s) return;
    const run = async () => {
      try {
        const id = sp.get("id");
        const code = sp.get("code");
        const branch = sp.get("branch");
        if (id) setCart(await groupGet(id));
        else if (code) { const c = await groupJoin(code); window.history.replaceState(null, "", `/group/?id=${c.id}`); setCart(c); }
        else if (branch && sp.get("start")) { const c = await groupCreate(branch); window.history.replaceState(null, "", `/group/?id=${c.id}`); setCart(c); }
      } catch (e) { setError((e as ApiError).message); }
    };
    void run();
  }, []);

  useEffect(() => { if (cart) loadMenu(cart.branch.id); }, [cart?.branch.id, loadMenu]);

  // Live refresh while the group is open, so everyone sees each other's items.
  useEffect(() => {
    if (!cart || cart.status === "PLACED" || cart.status === "CANCELLED") return;
    const t = setInterval(() => { groupGet(cart.id).then(setCart).catch(() => undefined); }, 5000);
    return () => clearInterval(t);
  }, [cart?.id, cart?.status]);

  // Re-quote the split whenever the lines change.
  useEffect(() => {
    if (!cart || !cart.lines.length) { setQuote(null); return; }
    const body = cart.order_type === "DELIVERY" && place ? { delivery: { lat: place.lat, lng: place.lng } } : {};
    groupQuote(cart.id, body).then(setQuote).catch(() => setQuote(null));
  }, [cart?.lines.length, cart?.id, place?.lat, place?.lng, cart?.order_type]);

  const act = async (fn: () => Promise<GroupCart>, tag: string) => {
    setError(null); setBusy(tag);
    try { setCart(await fn()); } catch (e) { setError((e as ApiError).message); } finally { setBusy(null); }
  };

  const shareLink = cart ? `${window.location.origin}/group/?code=${cart.code}` : "";
  const copyLink = () => { navigator.clipboard?.writeText(shareLink).then(() => setBusy("copied")).then(() => setTimeout(() => setBusy(null), 1200)).catch(() => undefined); };

  const placeOrder = async () => {
    if (!cart || !quote) return;
    setError(null); setBusy("place");
    try {
      const r = await groupPlace(cart.id, {
        payment_mode: pay === "CASH_ON_DELIVERY" ? "CASH_ON_DELIVERY" : "PREPAID", expected_total: quote.breakdown.total,
        ...(cart.order_type === "DELIVERY" && place ? { delivery: { lat: place.lat, lng: place.lng } } : {}),
      });
      rememberCode(r.order_id, r.recipient_code);
      if (pay === "MOBILE_MONEY_PUSH") {
        // The host pays the whole group total by mobile money; friends settle their share with the host.
        const intent = await api<{ status: string; reason_code?: string }>("/v1/payments/intents", { method: "POST", body: { order_id: r.order_id, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: (getSession()?.phone ?? "").replace(/\s/g, "") } } });
        if (intent.status === "FAILED") { setBusy(null); setError(`The payment did not go through${intent.reason_code ? ` (${intent.reason_code.replace(/_/g, " ").toLowerCase()})` : ""}.`); return; }
      }
      window.location.href = `/track/?id=${r.order_id}`;
    } catch (e) { setError((e as ApiError).message); setBusy(null); }
  };

  if (!live()) return <div className="app-card"><h1 className="app-title">Group order</h1><p className="muted">Group ordering opens at launch.</p></div>;
  if (signedIn === false) return <div className="app-card"><h1 className="app-title">Group order</h1><p className="muted">Sign in to start or join a group order.</p><Link className="btn accent" href={`/signin/?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/group/")}`}>Sign in</Link></div>;
  if (error && !cart) return <div className="app-card"><h1 className="app-title">Group order</h1><p className="form-error">{error}</p><Link className="btn light" href="/order/">See restaurants</Link></div>;
  if (!cart) return <div className="skeleton-line" />;

  const byMember = cart.members.map((m) => ({ member: m, lines: cart.lines.filter((l) => l.member_user_id === m.user_id) }));
  const splitFor = (uid: string) => quote?.split.find((s) => s.user_id === uid);
  const addable = (menu ?? []).filter((i) => i.available);

  return (
    <div className="group">
      <div className="g-head">
        <div>
          <p className="eyebrow">Group order · {cart.branch.name}</p>
          <h1 className="app-title">Order together</h1>
          <p className="muted">{cart.members.length} {cart.members.length === 1 ? "person" : "people"} · {cart.status === "OPEN" ? "open to join" : cart.status.toLowerCase()}</p>
        </div>
        <span className={`g-status ${cart.status.toLowerCase()}`}>{cart.status}</span>
      </div>

      {cart.status === "OPEN" ? (
        <div className="g-invite">
          <div><b>Invite code {cart.code}</b><small>Share the link — friends add their own dishes</small></div>
          <button type="button" className="btn light" onClick={copyLink}>{busy === "copied" ? "Copied!" : "Copy link"}</button>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="g-body">
        <section className="g-cart">
          <h2>Everyone's order</h2>
          {byMember.map(({ member, lines }) => (
            <div key={member.user_id} className="g-member">
              <div className="g-member-head"><b>{member.name}{member.is_host ? " · host" : ""}</b>{splitFor(member.user_id) ? <span className="num">{money({ amount_minor: splitFor(member.user_id)!.share_minor, currency: splitFor(member.user_id)!.currency })}</span> : null}</div>
              {lines.length ? (
                <ul className="g-lines">
                  {lines.map((l) => (
                    <li key={l.id}><span className="q">{l.quantity}×</span><span className="cl-name">{l.name}</span><span className="num">{money(l.line_total)}</span>
                      {cart.status === "OPEN" && me === l.member_user_id ? <button type="button" className="g-x" aria-label="Remove" onClick={() => act(() => groupRemoveItem(cart.id, l.id), `rm-${l.id}`)}>✕</button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">Nothing yet</p>}
            </div>
          ))}
          {quote ? (
            <dl className="price-lines g-totals">
              <div><dt>Food</dt><dd className="num">{money(quote.breakdown.goods)}</dd></div>
              <div><dt>Service charge</dt><dd className="num">{money(quote.breakdown.service_charge)}</dd></div>
              {BigInt(quote.breakdown.delivery_fee.amount_minor) > 0n ? <div><dt>Delivery</dt><dd className="num">{money(quote.breakdown.delivery_fee)}</dd></div> : null}
              <div className="total"><dt>Total</dt><dd className="num">{money(quote.breakdown.total)}</dd></div>
            </dl>
          ) : null}
        </section>

        <aside className="g-side">
          {cart.status === "OPEN" ? (
            <section className="g-menu">
              <h2>Add your dishes</h2>
              {menu === null ? <div className="skeleton-line" /> : (
                <ul className="g-menu-list">
                  {addable.map((i) => (
                    <li key={i.id}>
                      <span className="cl-name">{nameOf(i.names)}</span>
                      <span className="num">{money(i.prices.USD ?? Object.values(i.prices)[0]!)}</span>
                      <button type="button" className="add-btn sm" disabled={!!busy} aria-label={`Add ${nameOf(i.names)}`} onClick={() => act(() => groupAddItem(cart.id, { item_id: i.id, quantity: 1 }), `add-${i.id}`)}>+</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {isHost ? (
            <section className="g-host">
              <h2>Host checkout</h2>
              {cart.status === "OPEN" ? (
                <button type="button" className="btn wide" disabled={!cart.lines.length || !!busy} onClick={() => act(() => groupLock(cart.id, true), "lock")}>Lock the group</button>
              ) : cart.status === "LOCKED" ? (
                <>
                  <p className="muted small">Locked — no one can add more. Place the order for everyone.</p>
                  <div className="pay-list" role="radiogroup" aria-label="Payment">
                    {(["CASH_ON_DELIVERY", "MOBILE_MONEY_PUSH"] as const).map((m) => (
                      <button type="button" key={m} role="radio" aria-checked={pay === m} className={`pay-opt ${pay === m ? "on" : ""}`} onClick={() => setPay(m)}>
                        <span className="radio" aria-hidden /><span><b>{m === "CASH_ON_DELIVERY" ? "Cash on delivery" : "Mobile money"}</b></span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn accent wide big" disabled={!quote || busy === "place"} onClick={placeOrder}>
                    {busy === "place" ? "Placing…" : quote ? `Place for everyone · ${money(quote.breakdown.total)}` : "Place"}
                  </button>
                  <button type="button" className="link-btn" onClick={() => act(() => groupLock(cart.id, false), "unlock")}>Unlock to keep adding</button>
                </>
              ) : null}
            </section>
          ) : cart.status !== "PLACED" ? (
            <p className="muted small">The host places the order when everyone's ready.</p>
          ) : null}

          {cart.status === "PLACED" ? (
            <p className="form-notice">This group order has been placed. {cart.placed_order_id ? <Link className="link-btn" href={`/track/?id=${cart.placed_order_id}`}>Track it</Link> : null}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
