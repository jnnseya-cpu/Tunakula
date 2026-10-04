"use client";
/**
 * The storefront basket. Lines, quantities, the 10% service charge (from the published pricing
 * policy) and delivery or collection. Kept per store in this browser only. On the preview site,
 * checkout explains that ordering opens at launch; in production it hands over to the API
 * (POST /v1/carts/quote, then POST /v1/orders).
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export interface BasketItem { readonly id: string; readonly name: string; readonly price: number }
interface Line extends BasketItem { qty: number }
interface Basket {
  lines: Line[];
  add: (item: BasketItem) => void;
  change: (id: string, delta: number) => void;
  count: number;
  subtotal: number;
  service: number;
  mode: "DELIVERY" | "COLLECTION";
  setMode: (m: "DELIVERY" | "COLLECTION") => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  checkout: boolean;
  setCheckout: (o: boolean) => void;
  merchantName: string;
}

const Ctx = createContext<Basket | null>(null);
const useBasket = () => {
  const b = useContext(Ctx);
  if (!b) throw new Error("Basket outside its provider");
  return b;
};

/** Whole francs × basis points, rounded half-to-even once (MR-8). */
function bpsOf(amount: number, bps: number): number {
  const n = amount * bps;
  const q = Math.floor(n / 10_000);
  const r = n - q * 10_000;
  if (r > 5_000 || (r === 5_000 && q % 2 === 1)) return q + 1;
  return q;
}

export const fc = (n: number) => `${n.toLocaleString("fr-FR").replace(/\s/g, " ")} FC`;

export function BasketProvider({ merchant, merchantName, serviceBps, children }: { merchant: string; merchantName: string; serviceBps: number; children: React.ReactNode }) {
  const key = `tk-basket:${merchant}`;
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<"DELIVERY" | "COLLECTION">("DELIVERY");
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(saved)) setLines(saved.filter((l) => l && typeof l.id === "string" && Number.isInteger(l.qty) && l.qty > 0));
    } catch { /* private mode or blocked storage: start empty */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, JSON.stringify(lines)); } catch { /* ignore */ }
  }, [key, lines, loaded]);

  const value = useMemo<Basket>(() => {
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    return {
      lines,
      add: (item) => setLines((ls) => ls.some((l) => l.id === item.id) ? ls.map((l) => (l.id === item.id ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...ls, { ...item, qty: 1 }]),
      change: (id, delta) => setLines((ls) => ls.flatMap((l) => (l.id !== id ? [l] : l.qty + delta <= 0 ? [] : [{ ...l, qty: Math.min(99, l.qty + delta) }]))),
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal,
      service: bpsOf(subtotal, serviceBps),
      mode, setMode, open, setOpen, checkout, setCheckout, merchantName,
    };
  }, [lines, serviceBps, mode, open, checkout, merchantName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AddButton({ item, label }: { item: BasketItem; label?: string }) {
  const b = useBasket();
  const qty = b.lines.find((l) => l.id === item.id)?.qty ?? 0;
  return qty > 0 ? (
    <span className="qty" role="group" aria-label={`${item.name} in basket`}>
      <button type="button" onClick={() => b.change(item.id, -1)} aria-label={`One less ${item.name}`}>−</button>
      <b className="num">{qty}</b>
      <button type="button" onClick={() => b.add(item)} aria-label={`One more ${item.name}`}>+</button>
    </span>
  ) : (
    <button type="button" className="add" onClick={() => b.add(item)} aria-label={`Add ${item.name}`}>
      {label ?? "+"}
    </button>
  );
}

function Lines() {
  const b = useBasket();
  return (
    <ul className="b-lines">
      {b.lines.map((l) => (
        <li key={l.id}>
          <span className="qty sm">
            <button type="button" onClick={() => b.change(l.id, -1)} aria-label={`One less ${l.name}`}>−</button>
            <b className="num">{l.qty}</b>
            <button type="button" onClick={() => b.change(l.id, 1)} aria-label={`One more ${l.name}`}>+</button>
          </span>
          <span className="b-name">{l.name}</span>
          <span className="num">{fc(l.price * l.qty)}</span>
        </li>
      ))}
    </ul>
  );
}

function Summary() {
  const b = useBasket();
  return (
    <>
      <div className="b-mode" role="radiogroup" aria-label="Delivery or collection">
        {(["DELIVERY", "COLLECTION"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={b.mode === m} className={b.mode === m ? "on" : ""} onClick={() => b.setMode(m)}>
            {m === "DELIVERY" ? "Delivery" : "Collect"}
          </button>
        ))}
      </div>
      <Lines />
      <dl className="b-sum">
        <div><dt>Food</dt><dd className="num">{fc(b.subtotal)}</dd></div>
        <div><dt>Service charge 10%</dt><dd className="num">{fc(b.service)}</dd></div>
        {b.mode === "DELIVERY" ? <div><dt>Delivery</dt><dd>shown at checkout</dd></div> : <div><dt>Collection</dt><dd>free</dd></div>}
        <div className="tot"><dt>{b.mode === "DELIVERY" ? "Before delivery" : "Total"}</dt><dd className="num">{fc(b.subtotal + b.service)}</dd></div>
      </dl>
      <button type="button" className="btn accent b-go" onClick={() => b.setCheckout(true)}>
        Go to checkout
      </button>
      <p className="b-note">Same prices as at the counter. Pay with M-Pesa, Orange Money, Airtel Money or card, in francs or dollars.</p>
    </>
  );
}

/** Desktop: a sticky panel beside the menu. */
export function BasketPanel() {
  const b = useBasket();
  return (
    <aside className="basket" aria-label="Your basket">
      <h2>Your basket</h2>
      {b.count === 0 ? (
        <div className="b-empty">
          <p>Nothing here yet.</p>
          <p className="small">Tap + on a dish to add it. Your basket stays here while you browse.</p>
        </div>
      ) : (
        <Summary />
      )}
    </aside>
  );
}

/** Mobile: a bar at the bottom, opening the basket as a sheet. Also hosts the checkout notice. */
export function BasketBar() {
  const b = useBasket();
  return (
    <>
      {b.count > 0 ? (
        <button type="button" className="basket-bar" onClick={() => b.setOpen(true)}>
          <span className="n num">{b.count}</span>
          <span>View basket</span>
          <span className="num">{fc(b.subtotal + b.service)}</span>
        </button>
      ) : null}
      {b.open ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Your basket" onClick={() => b.setOpen(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>Your basket</h2><button type="button" onClick={() => b.setOpen(false)} aria-label="Close">×</button></div>
            {b.count === 0 ? <p className="small">Your basket is empty.</p> : <Summary />}
          </div>
        </div>
      ) : null}
      {b.checkout ? (
        <div className="sheet center" role="dialog" aria-modal="true" aria-label="Checkout" onClick={() => b.setCheckout(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>Almost there</h2><button type="button" onClick={() => b.setCheckout(false)} aria-label="Close">×</button></div>
            <p>
              This is a preview of {b.merchantName}&rsquo;s storefront. Ordering opens when Tunakula launches in Kinshasa; your basket of{" "}
              <b className="num">{fc(b.subtotal + b.service)}</b> will be here.
            </p>
            <p className="small" style={{ marginTop: 12 }}>At checkout you drop a pin, see the delivery fee and the total, then approve the payment on your phone.</p>
            <button type="button" className="btn b-go" onClick={() => b.setCheckout(false)}>Keep browsing</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
