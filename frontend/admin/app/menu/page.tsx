"use client";
/**
 * Menu management (the restaurant food panel): a merchant lists their branch's foods, searches and
 * filters them, toggles availability, flags "recommended", and adds or edits a food — name and
 * description per language, category, price, veg flag, tags and allergens. Scoped to the branches the
 * signed-in person may manage (menu:write), exactly like the legacy restaurant panel's food list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { money } from "../../lib/format";

interface Branch { id: string; name: string; status: string; items: number }
interface MoneyWire { amount_minor: string; currency: string }
interface Item {
  id: string; names: Record<string, string>; description: Record<string, string>;
  prices: Record<string, MoneyWire>; category: string | null; veg: boolean | null;
  tags: string[]; allergens: string[]; available: boolean; recommended: boolean;
}
interface Config { money: { currencies: { settlement: string; accepted: { code: string }[] } } }

const CATEGORIES = ["Restaurant", "Cuisine Locale", "Fast Food", "Boisson", "Dessert", "Végétarienne", "Accompagnements", "Fruits et Légumes", "Viande et Poisson", "Boulangeries", "Pizzérias", "Taco", "Menu Enfant", "Supermarché", "Épiceries", "Essentiel", "Promo"];

export default function MenuPage() {
  return <Shell title="menu"><Gate cap="catalogue"><Menu /></Gate></Shell>;
}

const nameOf = (names: Record<string, string>, lang: string) => names[lang] || names.fr || names.en || Object.values(names)[0] || "";
const blankForm = () => ({ id: "", name_fr: "", name_en: "", desc_fr: "", category: "", price: "", veg: "" as "" | "veg" | "non", recommended: false, tags: "", allergens: "" });
type Form = ReturnType<typeof blankForm>;

function Menu() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState<string>("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [settlement, setSettlement] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: Branch[] }>("/v1/admin/branches", { country })
      .then((r) => { setBranches(r.data); if (r.data[0]) setBranchId((b) => b || r.data[0]!.id); })
      .catch((e: Error) => setError(e.message));
    api<Config>(`/v1/countries/${country}/config`, { country }).then((c) => setSettlement(c.money.currencies.settlement)).catch(() => undefined);
  }, [country]);

  const load = useCallback(() => {
    if (!branchId) return;
    api<{ items: Item[] }>(`/v1/branches/${branchId}/menu`, { country }).then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  }, [branchId, country]);
  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);
  const shown = useMemo(() => (items ?? []).filter((i) =>
    (!cat || i.category === cat) &&
    (!q || nameOf(i.names, lang).toLowerCase().includes(q.toLowerCase()) || (i.category ?? "").toLowerCase().includes(q.toLowerCase()))), [items, cat, q, lang]);

  const toggle = async (it: Item) => {
    try { await api(`/v1/branches/${branchId}/items/${it.id}/availability`, { method: "POST", country, body: { available: !it.available } }); load(); }
    catch (e) { setError((e as Error).message); }
  };

  const edit = (it: Item) => setForm({
    id: it.id, name_fr: it.names.fr ?? "", name_en: it.names.en ?? "", desc_fr: it.description?.fr ?? "",
    category: it.category ?? "", price: it.prices[settlement] ? decimal(it.prices[settlement]!.amount_minor, settlement) : "",
    veg: it.veg === true ? "veg" : it.veg === false ? "non" : "", recommended: it.recommended, tags: it.tags.join(", "), allergens: it.allergens.join(", "),
  });

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    const names: Record<string, string> = {};
    if (form.name_fr.trim()) names.fr = form.name_fr.trim();
    if (form.name_en.trim()) names.en = form.name_en.trim();
    const body = {
      names,
      ...(form.desc_fr.trim() ? { description: { fr: form.desc_fr.trim() } } : { description: {} }),
      prices: { [settlement]: form.price.trim() },
      category: form.category.trim() || null,
      veg: form.veg === "veg" ? true : form.veg === "non" ? false : null,
      recommended: form.recommended,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      allergens: form.allergens.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      await api(`/v1/branches/${branchId}/items${form.id ? `/${form.id}` : ""}`, { method: "POST", country, body });
      setForm(null); load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (error && !items) return <div className="banner error">{error}</div>;
  if (!branches) return <div className="muted">…</div>;
  if (branches.length === 0) return <div className="banner">{L("Aucun établissement à gérer. Demandez le rôle de propriétaire dans Équipe et rôles.", "No branch to manage. Ask for the owner role in Team and roles.")}</div>;

  return (
    <div className="menu">
      {error ? <div className="banner error">{error}</div> : null}
      <div className="menu-bar">
        {branches.length > 1
          ? <select className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setItems(null); }}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          : <h2 className="menu-branch">{branches[0]!.name}</h2>}
        <input className="input" placeholder={L("Rechercher un plat", "Search a dish")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{L("Toutes les catégories", "All categories")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="btn primary" onClick={() => setForm(blankForm())}>{L("Ajouter un plat", "Add a dish")}</button>
      </div>

      {!items ? <div className="muted">…</div> : (
        <table className="tbl menu-tbl">
          <thead><tr><th>#</th><th>{L("Nom", "Name")}</th><th>{L("Catégorie", "Category")}</th><th>{L("Prix", "Price")}</th><th>{L("Recommandé", "Recommended")}</th><th>{L("Disponible", "Available")}</th><th></th></tr></thead>
          <tbody>
            {shown.map((it, i) => (
              <tr key={it.id}>
                <td className="num muted">{i + 1}</td>
                <td>{nameOf(it.names, lang)}{it.veg === true ? <span className="dot veg" title="veg" /> : null}</td>
                <td className="muted">{it.category ?? "—"}</td>
                <td className="num">{it.prices[settlement] ? money(lang, it.prices[settlement]!.amount_minor, settlement) : "—"}</td>
                <td>{it.recommended ? <span className="pill on">★</span> : <span className="muted">—</span>}</td>
                <td><button type="button" className={`sw ${it.available ? "on" : ""}`} onClick={() => toggle(it)} aria-pressed={it.available} aria-label={L("Disponibilité", "Availability")}><span /></button></td>
                <td><button type="button" className="btn ghost sm" onClick={() => edit(it)}>{L("Modifier", "Edit")}</button></td>
              </tr>
            ))}
            {shown.length === 0 ? <tr><td colSpan={7} className="muted" style={{ padding: 18 }}>{L("Aucun plat.", "No dishes.")}</td></tr> : null}
          </tbody>
        </table>
      )}

      {form ? (
        <div className="menu-form-wrap" role="dialog" aria-modal="true">
          <div className="menu-form card">
            <div className="card-head"><div><h2>{form.id ? L("Modifier le plat", "Edit dish") : L("Nouveau plat", "New dish")}</h2></div><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>✕</button></div>
            <div className="ff">
              <label>{L("Nom (FR)", "Name (FR)")}<input className="input" value={form.name_fr} onChange={(e) => setForm({ ...form, name_fr: e.target.value })} /></label>
              <label>{L("Nom (EN)", "Name (EN)")}<input className="input" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
              <label className="wide">{L("Description (FR)", "Description (FR)")}<textarea className="input" rows={2} value={form.desc_fr} onChange={(e) => setForm({ ...form, desc_fr: e.target.value })} /></label>
              <label>{L("Catégorie", "Category")}<input className="input" list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></label>
              <label>{L("Prix", "Price")} ({settlement})<input className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
              <label>{L("Type", "Type")}<select className="select" value={form.veg} onChange={(e) => setForm({ ...form, veg: e.target.value as Form["veg"] })}><option value="">—</option><option value="veg">{L("Végétarien", "Veg")}</option><option value="non">{L("Non végétarien", "Non-veg")}</option></select></label>
              <label className="chk"><input type="checkbox" checked={form.recommended} onChange={(e) => setForm({ ...form, recommended: e.target.checked })} /> {L("Recommandé", "Recommended")}</label>
              <label>{L("Balises (séparées par des virgules)", "Tags (comma-separated)")}<input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
              <label>{L("Allergènes (virgules)", "Allergens (commas)")}<input className="input" value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} /></label>
            </div>
            <div className="menu-form-foot">
              <button type="button" className="btn" onClick={() => setForm(null)}>{L("Annuler", "Cancel")}</button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "…" : L("Enregistrer", "Save")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function decimal(minor: string, currency: string): string {
  const digits = currency === "CDF" ? 0 : 2;
  if (digits === 0) return minor;
  const neg = minor.startsWith("-");
  const raw = (neg ? minor.slice(1) : minor).padStart(digits + 1, "0");
  return (neg ? "-" : "") + `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
}
