"use client";
/**
 * Self-service kiosk — the customer-facing, full-screen in-store ordering mode (channel HUB). A staff member unlocks
 * the device once (picks the branch), then hands the tablet to customers: an attract screen, a big touch menu, a
 * cart, dine-in/takeaway, and pay now by mobile money or at the counter. The order lands on the same kitchen / KDS
 * board as every other order. Same engine as the counter POS and the storefront — it reuses the quote/place path;
 * the price always comes from the API, never totalled on the client.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, session } from "../../lib/api";
import { money } from "../../lib/format";

type Lang = "fr" | "en";
interface MoneyWire { amount_minor: string; currency: string }
interface ApiOption { id: string; name: string; price: string }
interface ApiVariation { id: string; name: string; type: "SINGLE" | "MULTI"; required: boolean; min: number; max: number; options: ApiOption[] }
interface Item { id: string; names: Record<string, string>; prices: Record<string, MoneyWire>; category: string | null; available: boolean; variations: ApiVariation[]; addons: ApiOption[]; available_now?: boolean }
interface Branch { id: string; name: string; commune?: string | null }
interface CartLine { key: string; itemId: string; name: string; qty: number; unit: MoneyWire; options: { group: string; choices: string[] }[]; descriptors: string[] }
interface Quote { lines: { item_id: string; name: string; quantity: number; total: MoneyWire; options?: string[] }[]; price_lines: { code: string; amount: MoneyWire }[]; total: MoneyWire }
interface Placed { order_id: string; recipient_code: string; order_type: string; pay_method: string }

const LINE_LABEL: Record<string, [string, string]> = { GOODS: ["Plats", "Food"], SERVICE_CHARGE: ["Service", "Service"], DELIVERY_FEE: ["Livraison", "Delivery"], TIP: ["Pourboire", "Tip"] };
const BRANCH_KEY = "tk-kiosk-branch";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const itemName = (it: Item, lang: Lang) => it.names[lang] ?? it.names.fr ?? it.names.en ?? Object.values(it.names)[0] ?? "—";
const firstPrice = (it: Item): MoneyWire => Object.values(it.prices)[0] ?? { amount_minor: "0", currency: "USD" };

export default function KioskPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (!session.token()) { router.replace("/login/"); return; } setReady(true); }, [router]);
  if (!ready) return <div className="kiosk-boot">…</div>;
  return <Kiosk />;
}

type Stage = "attract" | "ordering" | "pay" | "done";

function Kiosk() {
  const country = session.country();
  const [lang, setLang] = useState<Lang>((read("tk-admin-lang") as Lang) || "fr");
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (w: MoneyWire | undefined) => (w ? money(lang, w.amount_minor, w.currency) : "—");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(read(BRANCH_KEY));
  const [items, setItems] = useState<Item[]>([]);
  const [stage, setStage] = useState<Stage>("attract");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"TAKEAWAY" | "DINE_IN">("TAKEAWAY");
  const [payMethod, setPayMethod] = useState<"COUNTER" | "MOBILE_MONEY">("COUNTER");
  const [phone, setPhone] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Item | null>(null);
  const [done, setDone] = useState<Placed | null>(null);

  useEffect(() => { api<{ data: Branch[] }>("/v1/admin/branches", { country }).then((r) => setBranches(r.data)).catch((e: Error) => setError(e.message)); }, [country]);
  useEffect(() => {
    if (!branchId) return;
    api<{ items: Item[] }>(`/v1/branches/${branchId}/menu`, { country })
      .then((r) => setItems(r.items.filter((it) => it.available && it.available_now !== false)))
      .catch((e: Error) => setError(e.message));
  }, [branchId, country]);
  useEffect(() => { setQuote(null); }, [cart, orderType]);

  // Auto-reset to the attract screen after a finished order, so the next customer starts fresh.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetAll = useCallback(() => { setCart([]); setQuote(null); setPhone(""); setPayMethod("COUNTER"); setOrderType("TAKEAWAY"); setDone(null); setError(null); setStage("attract"); }, []);
  useEffect(() => { if (stage === "done") { resetTimer.current = setTimeout(resetAll, 12000); return () => { if (resetTimer.current) clearTimeout(resetTimer.current); }; } }, [stage, resetAll]);

  const addLine = useCallback((it: Item, options: { group: string; choices: string[] }[], descriptors: string[]) => {
    const sig = `${it.id}|${JSON.stringify(options)}`;
    setCart((prev) => {
      const at = prev.findIndex((l) => l.key === sig);
      if (at >= 0) { const next = [...prev]; next[at] = { ...next[at]!, qty: next[at]!.qty + 1 }; return next; }
      return [...prev, { key: sig, itemId: it.id, name: itemName(it, lang), qty: 1, unit: firstPrice(it), options, descriptors }];
    });
  }, [lang]);
  const tapItem = (it: Item) => { if (it.variations.length > 0) { setPicker(it); return; } addLine(it, [], []); };
  const setQty = (key: string, delta: number) => setCart((prev) => prev.flatMap((l) => (l.key === key ? (l.qty + delta <= 0 ? [] : [{ ...l, qty: l.qty + delta }]) : [l])));

  const body = useMemo(() => ({
    branch_id: branchId,
    items: cart.map((l) => ({ item_id: l.itemId, quantity: l.qty, ...(l.options.length ? { options: l.options } : {}) })),
    order_type: orderType,
  }), [branchId, cart, orderType]);

  const goPay = async () => {
    if (!cart.length) return;
    setError(null);
    try { setQuote(await api<Quote>("/v1/kiosk/quote", { method: "POST", country, body })); setStage("pay"); }
    catch (e) { setError((e as Error).message); }
  };

  const place = async () => {
    if (!quote) return;
    if (payMethod === "MOBILE_MONEY" && !/^\+[1-9][0-9]{6,14}$/.test(phone.trim())) { setError(L("Entrez un numéro valide, ex. +243…", "Enter a valid number, e.g. +243…")); return; }
    setPlacing(true); setError(null);
    try {
      const placed = await api<Placed>("/v1/kiosk/orders", { method: "POST", country, body: { ...body, pay_method: payMethod, device_id: "kiosk-web", expected_total: quote.total, ...(payMethod === "MOBILE_MONEY" ? { customer_phone: phone.trim() } : {}) } });
      // Mobile money: raise the push to the customer's phone (best-effort; they approve on their handset).
      if (payMethod === "MOBILE_MONEY") {
        await api("/v1/payments/intents", { method: "POST", country, body: { order_id: placed.order_id, method_type: "MOBILE_MONEY_PUSH", payer: { msisdn: phone.trim() } } }).catch(() => undefined);
      }
      setDone(placed); setStage("done");
    } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); } finally { setPlacing(false); }
  };

  const byCategory = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const it of items) { const c = it.category ?? "Menu"; (groups.get(c) ?? groups.set(c, []).get(c)!).push(it); }
    return [...groups.entries()];
  }, [items]);
  const estimate = cart.reduce((n, l) => n + Number(l.unit.amount_minor) * l.qty, 0);
  const estCurrency = cart[0]?.unit.currency ?? "USD";
  const count = cart.reduce((n, l) => n + l.qty, 0);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  // ── Staff setup: no branch chosen yet ──
  if (!branchId) {
    return (
      <div className="kiosk kiosk-setup">
        <div className="kiosk-setup-card">
          <h1>{L("Mode borne", "Kiosk mode")}</h1>
          <p className="muted">{L("Choisissez la succursale, puis passez la tablette aux clients.", "Pick the branch, then hand the tablet to customers.")}</p>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="kiosk-branch-list">
            {branches.map((b) => <button key={b.id} type="button" className="btn primary big" onClick={() => { setBranchId(b.id); write(BRANCH_KEY, b.id); }}>{b.name}</button>)}
            {branches.length === 0 ? <p className="muted">{L("Aucune succursale.", "No branches.")}</p> : null}
          </div>
          <a className="link-btn" href="/pos/">{L("← Retour à la console", "← Back to the console")}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk">
      {/* Thin staff strip — switch branch / language / exit. Hidden-ish, for the operator not the customer. */}
      <div className="kiosk-staff">
        <span>{L("Borne", "Kiosk")} · <b>{branchName}</b></span>
        <span className="kiosk-staff-right">
          {(["fr", "en"] as const).map((l) => <button key={l} type="button" className={lang === l ? "on" : ""} onClick={() => { setLang(l); write("tk-admin-lang", l); }}>{l.toUpperCase()}</button>)}
          <button type="button" onClick={() => { write(BRANCH_KEY, ""); setBranchId(null); resetAll(); }}>{L("Changer", "Switch")}</button>
          <a href="/pos/">{L("Quitter", "Exit")}</a>
        </span>
      </div>

      {stage === "attract" ? (
        <button type="button" className="kiosk-attract" onClick={() => setStage("ordering")}>
          <img src="/brand/tunakula-logo.jpg" alt="Tunakula" width={120} height={120} />
          <h1>{L("Touchez pour commander", "Touch to order")}</h1>
          <p>{branchName}</p>
        </button>
      ) : null}

      {stage === "ordering" ? (
        <div className="kiosk-order">
          <div className="kiosk-menu">
            {byCategory.map(([cat, list]) => (
              <section key={cat} className="kiosk-cat">
                <h2>{cat}</h2>
                <div className="kiosk-grid">
                  {list.map((it) => (
                    <button key={it.id} type="button" className="kiosk-tile" onClick={() => tapItem(it)}>
                      <b>{itemName(it, lang)}</b>
                      <span className="kiosk-tile-price">{m(firstPrice(it))}{it.variations.length ? " +" : ""}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {items.length === 0 ? <p className="muted">{L("Aucun plat disponible.", "No dishes available.")}</p> : null}
          </div>
          <aside className="kiosk-cart">
            <h2>{L("Votre commande", "Your order")}</h2>
            {cart.length === 0 ? <p className="muted kiosk-cart-empty">{L("Touchez un plat pour l'ajouter.", "Tap a dish to add it.")}</p> : (
              <ul className="kiosk-lines">
                {cart.map((l) => (
                  <li key={l.key}>
                    <div className="kiosk-line-top"><span>{l.name}{l.descriptors.length ? <small>{l.descriptors.join(" · ")}</small> : null}</span><b className="num">{m({ amount_minor: String(Number(l.unit.amount_minor) * l.qty), currency: l.unit.currency })}</b></div>
                    <div className="kiosk-qty"><button type="button" onClick={() => setQty(l.key, -1)} aria-label="−">−</button><span>{l.qty}</span><button type="button" onClick={() => setQty(l.key, +1)} aria-label="+">+</button></div>
                  </li>
                ))}
              </ul>
            )}
            {cart.length ? <div className="kiosk-estimate"><span>{L("Sous-total", "Subtotal")}</span><b>{m({ amount_minor: String(estimate), currency: estCurrency })}</b></div> : null}
            {error ? <p className="form-error">{error}</p> : null}
            <button type="button" className="btn primary big kiosk-cta" disabled={!cart.length} onClick={goPay}>{L("Payer", "Checkout")} {count ? `· ${count}` : ""}</button>
          </aside>
        </div>
      ) : null}

      {stage === "pay" && quote ? (
        <div className="kiosk-pay">
          <h1>{L("Finaliser", "Finish your order")}</h1>
          <div className="kiosk-pay-grid">
            <div>
              <h3>{L("Où mangez-vous ?", "Where are you eating?")}</h3>
              <div className="kiosk-seg">
                {(["TAKEAWAY", "DINE_IN"] as const).map((t) => <button key={t} type="button" className={orderType === t ? "on" : ""} onClick={() => setOrderType(t)}>{t === "TAKEAWAY" ? L("À emporter", "Takeaway") : L("Sur place", "Dine-in")}</button>)}
              </div>
              <h3>{L("Comment payer ?", "How to pay?")}</h3>
              <div className="kiosk-seg">
                {(["COUNTER", "MOBILE_MONEY"] as const).map((pm) => <button key={pm} type="button" className={payMethod === pm ? "on" : ""} onClick={() => setPayMethod(pm)}>{pm === "COUNTER" ? L("Au comptoir", "At the counter") : L("Mobile Money", "Mobile Money")}</button>)}
              </div>
              {payMethod === "MOBILE_MONEY" ? <input className="input kiosk-phone" inputMode="tel" placeholder="+243…" value={phone} onChange={(e) => setPhone(e.target.value)} /> : <p className="muted">{L("Prenez votre numéro de commande au comptoir pour payer.", "Take your order number to the counter to pay.")}</p>}
            </div>
            <div className="kiosk-summary">
              <dl className="kiosk-totals">
                {quote.price_lines.map((p) => <div key={p.code}><dt>{LINE_LABEL[p.code]?.[lang === "fr" ? 0 : 1] ?? p.code}</dt><dd className="num">{m(p.amount)}</dd></div>)}
                <div className="kiosk-grand"><dt>{L("Total", "Total")}</dt><dd className="num">{m(quote.total)}</dd></div>
              </dl>
              {error ? <p className="form-error">{error}</p> : null}
              <button type="button" className="btn primary big kiosk-cta" disabled={placing} onClick={place}>{placing ? "…" : `${L("Commander", "Place order")} · ${m(quote.total)}`}</button>
              <button type="button" className="link-btn" onClick={() => setStage("ordering")}>{L("← Modifier", "← Back")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "done" && done ? (
        <div className="kiosk-done">
          <div className="kiosk-tick" aria-hidden>✓</div>
          <h1>{L("C'est commandé !", "Order placed!")}</h1>
          <p className="kiosk-code">{L("Votre numéro", "Your number")}<b>{done.recipient_code}</b></p>
          <p className="kiosk-done-msg">{done.pay_method === "MOBILE_MONEY" ? L("Validez le paiement sur votre téléphone.", "Approve the payment on your phone.") : L("Présentez ce numéro au comptoir pour payer.", "Show this number at the counter to pay.")}</p>
          <button type="button" className="btn primary big" onClick={resetAll}>{L("Nouvelle commande", "New order")}</button>
        </div>
      ) : null}

      {picker ? <OptionPicker item={picker} lang={lang} onCancel={() => setPicker(null)} onAdd={(opts, desc) => { addLine(picker, opts, desc); setPicker(null); }} /> : null}
    </div>
  );
}

/** Choose a dish's option groups (required SINGLE / MULTI with min–max) before adding it. */
function OptionPicker({ item, lang, onCancel, onAdd }: { item: Item; lang: Lang; onCancel: () => void; onAdd: (opts: { group: string; choices: string[] }[], descriptors: string[]) => void }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const toggle = (v: ApiVariation, optId: string) => setChosen((prev) => {
    const cur = prev[v.id] ?? [];
    if (v.type === "SINGLE") return { ...prev, [v.id]: [optId] };
    if (cur.includes(optId)) return { ...prev, [v.id]: cur.filter((x) => x !== optId) };
    if (v.max && cur.length >= v.max) return prev;
    return { ...prev, [v.id]: [...cur, optId] };
  });
  const missing = item.variations.filter((v) => v.required || v.min > 0).some((v) => (chosen[v.id]?.length ?? 0) < Math.max(1, v.min));
  const confirm = () => {
    const opts = item.variations.filter((v) => (chosen[v.id]?.length ?? 0) > 0).map((v) => ({ group: v.id, choices: chosen[v.id]! }));
    const desc = item.variations.flatMap((v) => (chosen[v.id] ?? []).map((id) => v.options.find((o) => o.id === id)?.name).filter(Boolean) as string[]);
    onAdd(opts, desc);
  };
  return (
    <div className="kiosk-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="kiosk-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{item.names[lang] ?? item.names.fr ?? Object.values(item.names)[0]}</h3>
        {item.variations.map((v) => (
          <fieldset key={v.id} className="kiosk-optgroup">
            <legend>{v.name} {v.required || v.min > 0 ? <span className="kiosk-req">{L("requis", "required")}</span> : <span className="muted">{L("optionnel", "optional")}</span>}</legend>
            {v.options.map((o) => (
              <label key={o.id} className="kiosk-opt">
                <input type={v.type === "SINGLE" ? "radio" : "checkbox"} name={v.id} checked={(chosen[v.id] ?? []).includes(o.id)} onChange={() => toggle(v, o.id)} />
                <span>{o.name}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="kiosk-modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>{L("Annuler", "Cancel")}</button>
          <button type="button" className="btn primary" disabled={missing} onClick={confirm}>{L("Ajouter", "Add")}</button>
        </div>
      </div>
    </div>
  );
}
