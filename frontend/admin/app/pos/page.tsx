"use client";
/**
 * Built-in POS (point of sale): branch staff ring up a walk-in order at the counter — pick dishes (with their
 * options), choose takeaway or dine-in, take cash — and it lands PLACED on the same kitchen board as an online
 * order, stamped with the POS channel and the till. A printable receipt follows. The StackFood free-POS equivalent.
 * The price always comes from the API quote; the client never totals the bill itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import type { Lang } from "../../lib/i18n";

interface MoneyWire { amount_minor: string; currency: string }
interface ApiOption { id: string; name: string; price: string }
interface ApiVariation { id: string; name: string; type: "SINGLE" | "MULTI"; required: boolean; min: number; max: number; options: ApiOption[] }
interface Item {
  id: string; names: Record<string, string>; prices: Record<string, MoneyWire>; category: string | null;
  available: boolean; variations: ApiVariation[]; addons: ApiOption[]; available_now?: boolean;
}
interface Branch { id: string; name: string; commune?: string | null }
interface CartLine { key: string; itemId: string; name: string; qty: number; unit: MoneyWire; options: { group: string; choices: string[] }[]; descriptors: string[] }
interface QuoteLine { item_id: string; name: string; quantity: number; total: MoneyWire; options?: string[] }
interface Quote { lines: QuoteLine[]; price_lines: { code: string; amount: MoneyWire }[]; total: MoneyWire }
interface Placed { order_id: string; recipient_code: string; order_type: string; customer_phone?: string }

const LINE_LABEL: Record<string, [string, string]> = {
  GOODS: ["Plats", "Food"], SERVICE_CHARGE: ["Service (10%)", "Service (10%)"], DELIVERY_FEE: ["Livraison", "Delivery"], TIP: ["Pourboire", "Tip"],
};
const deviceId = () => {
  try {
    let id = localStorage.getItem("tk-pos-device");
    if (!id) { id = `web-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem("tk-pos-device", id); }
    return id;
  } catch { return "web-till"; }
};
const itemName = (it: Item, lang: Lang) => it.names[lang] ?? it.names.fr ?? it.names.en ?? Object.values(it.names)[0] ?? "—";
const firstPrice = (it: Item): MoneyWire => Object.values(it.prices)[0] ?? { amount_minor: "0", currency: "USD" };

export default function POSPage() {
  return <Shell title="pos"><Gate cap="pos"><POS /></Gate></Shell>;
}

function POS() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (w: MoneyWire | undefined) => (w ? money(lang, w.amount_minor, w.currency) : "—");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"TAKEAWAY" | "DINE_IN">("TAKEAWAY");
  const [table, setTable] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Item | null>(null);
  const [receipt, setReceipt] = useState<{ placed: Placed; quote: Quote; at: string; branch: string } | null>(null);

  useEffect(() => {
    setBranchId(null); setItems([]); setCart([]); setQuote(null);
    api<{ data: Branch[] }>("/v1/admin/branches", { country })
      .then((r) => { setBranches(r.data); setBranchId((b) => b ?? r.data[0]?.id ?? null); })
      .catch((e: Error) => setError(e.message));
  }, [country]);

  useEffect(() => {
    if (!branchId) return;
    setLoadingMenu(true); setCart([]); setQuote(null);
    api<{ items: Item[] }>(`/v1/branches/${branchId}/menu`, { country })
      .then((r) => setItems(r.items.filter((it) => it.available && it.available_now !== false)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMenu(false));
  }, [branchId, country]);

  // Any change to the cart or order shape invalidates a shown total.
  useEffect(() => { setQuote(null); }, [cart, orderType]);

  const addLine = useCallback((it: Item, options: { group: string; choices: string[] }[], descriptors: string[]) => {
    const sig = `${it.id}|${JSON.stringify(options)}`;
    setCart((prev) => {
      const at = prev.findIndex((l) => l.key === sig);
      if (at >= 0) { const next = [...prev]; next[at] = { ...next[at]!, qty: next[at]!.qty + 1 }; return next; }
      return [...prev, { key: sig, itemId: it.id, name: itemName(it, lang), qty: 1, unit: firstPrice(it), options, descriptors }];
    });
  }, [lang]);

  const tapItem = (it: Item) => {
    if (it.variations.length > 0) { setPicker(it); return; }
    addLine(it, [], []);
  };
  const setQty = (key: string, delta: number) => setCart((prev) => prev.flatMap((l) => (l.key === key ? (l.qty + delta <= 0 ? [] : [{ ...l, qty: l.qty + delta }]) : [l])));

  const body = useMemo(() => ({
    branch_id: branchId,
    items: cart.map((l) => ({ item_id: l.itemId, quantity: l.qty, ...(l.options.length ? { options: l.options } : {}) })),
    order_type: orderType,
    ...(orderType === "DINE_IN" && table.trim() ? { table_id: table.trim() } : {}),
    ...(phone.trim() ? { customer_phone: phone.trim() } : {}),
    ...(name.trim() ? { customer_name: name.trim() } : {}),
    ...(note.trim() ? { kitchen_note: note.trim() } : {}),
  }), [branchId, cart, orderType, table, phone, name, note]);

  const doQuote = async () => {
    if (!cart.length) return;
    setQuoting(true); setError(null);
    try { setQuote(await api<Quote>("/v1/pos/quote", { method: "POST", country, body })); }
    catch (e) { setError((e as Error).message); } finally { setQuoting(false); }
  };

  const place = async () => {
    if (!quote) return;
    setPlacing(true); setError(null);
    try {
      const placed = await api<Placed>("/v1/pos/orders", { method: "POST", country, body: { ...body, device_id: deviceId(), expected_total: quote.total } });
      const branch = branches.find((b) => b.id === branchId)?.name ?? "";
      setReceipt({ placed, quote, at: new Date().toLocaleString(lang === "fr" ? "fr-CD" : "en-GB", { timeZone: "Africa/Kinshasa" }), branch });
      setCart([]); setQuote(null); setTable(""); setPhone(""); setName(""); setNote("");
    } catch (e) { setError((e as Error).message); } finally { setPlacing(false); }
  };

  const estimate = cart.reduce((n, l) => n + Number(l.unit.amount_minor) * l.qty, 0);
  const estCurrency = cart[0]?.unit.currency ?? "USD";
  const byCategory = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const it of items) { const c = it.category ?? L("Menu", "Menu"); (groups.get(c) ?? groups.set(c, []).get(c)!).push(it); }
    return [...groups.entries()];
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pos">
      <div className="pos-menu">
        <div className="pos-menu-head">
          <select className="select" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} aria-label={L("Succursale", "Branch")}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {loadingMenu ? <p className="muted">{L("Chargement du menu…", "Loading menu…")}</p>
          : items.length === 0 ? <p className="muted">{L("Aucun plat disponible dans cette succursale.", "No dishes available at this branch.")}</p>
          : byCategory.map(([cat, list]) => (
            <section key={cat} className="pos-cat">
              <h3>{cat}</h3>
              <div className="pos-grid">
                {list.map((it) => (
                  <button key={it.id} type="button" className="pos-tile" onClick={() => tapItem(it)}>
                    <b>{itemName(it, lang)}</b>
                    <span className="pos-tile-price">{m(firstPrice(it))}{it.variations.length ? " +" : ""}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>

      <aside className="pos-ticket">
        <h2>{L("Ticket", "Ticket")}</h2>
        <div className="seg" role="group" aria-label={L("Type", "Type")}>
          {(["TAKEAWAY", "DINE_IN"] as const).map((t) => (
            <button key={t} type="button" className={orderType === t ? "on" : ""} onClick={() => setOrderType(t)}>{t === "TAKEAWAY" ? L("À emporter", "Takeaway") : L("Sur place", "Dine-in")}</button>
          ))}
        </div>
        {orderType === "DINE_IN" ? <input className="input" placeholder={L("N° de table", "Table number")} value={table} onChange={(e) => setTable(e.target.value)} /> : null}

        {cart.length === 0 ? <p className="muted pos-empty">{L("Touchez un plat pour commencer.", "Tap a dish to start.")}</p> : (
          <ul className="pos-lines">
            {cart.map((l) => (
              <li key={l.key}>
                <div className="pos-line-main">
                  <span className="pos-line-name">{l.name}{l.descriptors.length ? <small>{l.descriptors.join(" · ")}</small> : null}</span>
                  <span className="num">{m({ amount_minor: String(Number(l.unit.amount_minor) * l.qty), currency: l.unit.currency })}</span>
                </div>
                <div className="pos-qty">
                  <button type="button" onClick={() => setQty(l.key, -1)} aria-label="−">−</button>
                  <span>{l.qty}</span>
                  <button type="button" onClick={() => setQty(l.key, +1)} aria-label="+">+</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="pos-fields">
          <input className="input" placeholder={L("Téléphone client (optionnel)", "Customer phone (optional)")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          {phone.trim() ? <input className="input" placeholder={L("Nom (optionnel)", "Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} /> : null}
          <input className="input" placeholder={L("Note cuisine (optionnel)", "Kitchen note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
        </div>

        {quote ? (
          <dl className="pos-totals">
            {quote.price_lines.map((p) => (<div key={p.code}><dt>{(LINE_LABEL[p.code]?.[lang === "fr" ? 0 : 1]) ?? p.code}</dt><dd className="num">{m(p.amount)}</dd></div>))}
            <div className="pos-grand"><dt>{L("Total", "Total")}</dt><dd className="num">{m(quote.total)}</dd></div>
          </dl>
        ) : cart.length ? (
          <div className="pos-estimate"><span>{L("Estimation", "Estimate")}</span><b>{m({ amount_minor: String(estimate), currency: estCurrency })}</b></div>
        ) : null}

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {quote
          ? <button type="button" className="btn primary pos-charge" disabled={placing} onClick={place}>{placing ? L("Enregistrement…", "Placing…") : `${L("Encaisser (espèces)", "Take cash")} · ${m(quote.total)}`}</button>
          : <button type="button" className="btn primary pos-charge" disabled={!cart.length || quoting} onClick={doQuote}>{quoting ? L("Calcul…", "Pricing…") : L("Calculer le total", "Charge")}</button>}
      </aside>

      {picker ? <OptionPicker item={picker} lang={lang} onCancel={() => setPicker(null)} onAdd={(opts, desc) => { addLine(picker, opts, desc); setPicker(null); }} /> : null}
      {receipt ? <Receipt data={receipt} lang={lang} onClose={() => setReceipt(null)} /> : null}
    </div>
  );
}

/** Choose a dish's option groups (required SINGLE / MULTI with min–max) before adding it to the ticket. */
function OptionPicker({ item, lang, onCancel, onAdd }: { item: Item; lang: Lang; onCancel: () => void; onAdd: (opts: { group: string; choices: string[] }[], descriptors: string[]) => void }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const toggle = (v: ApiVariation, optId: string) => setChosen((prev) => {
    const cur = prev[v.id] ?? [];
    if (v.type === "SINGLE") return { ...prev, [v.id]: [optId] };
    const has = cur.includes(optId);
    if (has) return { ...prev, [v.id]: cur.filter((x) => x !== optId) };
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
    <div className="pos-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="pos-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{item.names[lang] ?? item.names.fr ?? Object.values(item.names)[0]}</h3>
        {item.variations.map((v) => (
          <fieldset key={v.id} className="pos-optgroup">
            <legend>{v.name} {v.required || v.min > 0 ? <span className="pos-req">{L("requis", "required")}</span> : <span className="muted">{L("optionnel", "optional")}</span>}</legend>
            {v.options.map((o) => (
              <label key={o.id} className="pos-opt">
                <input type={v.type === "SINGLE" ? "radio" : "checkbox"} name={v.id} checked={(chosen[v.id] ?? []).includes(o.id)} onChange={() => toggle(v, o.id)} />
                <span>{o.name}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="pos-modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>{L("Annuler", "Cancel")}</button>
          <button type="button" className="btn primary" disabled={missing} onClick={confirm}>{L("Ajouter", "Add")}</button>
        </div>
      </div>
    </div>
  );
}

/** The printable counter receipt (80mm-friendly). Only this element prints. */
function Receipt({ data, lang, onClose }: { data: { placed: Placed; quote: Quote; at: string; branch: string }; lang: Lang; onClose: () => void }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (w: MoneyWire) => money(lang, w.amount_minor, w.currency);
  const { placed, quote, at, branch } = data;
  return (
    <div className="pos-modal" role="dialog" aria-modal="true">
      <div className="pos-modal-card">
        <div className="pos-receipt">
          <div className="rc-head">
            <b>Tunakula</b>
            <span>{branch}</span>
            <span>{placed.order_type === "DINE_IN" ? L("Sur place", "Dine-in") : L("À emporter", "Takeaway")} · {L("Espèces", "Cash")}</span>
            <span>{at}</span>
          </div>
          <div className="rc-code">{L("Code", "Code")} <b>{placed.recipient_code}</b></div>
          <ul className="rc-lines">
            {quote.lines.map((l, i) => (
              <li key={i}><span>{l.quantity}× {l.name}{l.options?.length ? <small>{l.options.join(" · ")}</small> : null}</span><span className="num">{m(l.total)}</span></li>
            ))}
          </ul>
          <dl className="rc-totals">
            {quote.price_lines.map((p) => (<div key={p.code}><dt>{(LINE_LABEL[p.code]?.[lang === "fr" ? 0 : 1]) ?? p.code}</dt><dd>{m(p.amount)}</dd></div>))}
            <div className="rc-grand"><dt>{L("TOTAL", "TOTAL")}</dt><dd>{m(quote.total)}</dd></div>
          </dl>
          <p className="rc-foot">{L("Merci ! À bientôt.", "Thank you! See you soon.")}</p>
        </div>
        <div className="pos-modal-actions pos-noprint">
          <button type="button" className="btn ghost" onClick={onClose}>{L("Nouvelle vente", "New sale")}</button>
          <button type="button" className="btn primary" onClick={() => window.print()}>{L("Imprimer le reçu", "Print receipt")}</button>
        </div>
      </div>
    </div>
  );
}
