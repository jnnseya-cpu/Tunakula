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
import { blankDish, DishFields, dishPayload, OptionsEditor, type DishFormValue } from "../../components/dish-form";

interface Branch { id: string; name: string; status: string; items: number }
interface MoneyWire { amount_minor: string; currency: string }
interface ApiOption { id: string; name: string; price: string }
interface ApiVariation { id: string; name: string; type: "SINGLE" | "MULTI"; required: boolean; min: number; max: number; options: ApiOption[] }
interface Item {
  id: string; names: Record<string, string>; description: Record<string, string>;
  prices: Record<string, MoneyWire>; category: string | null; veg: boolean | null;
  tags: string[]; allergens: string[]; available: boolean; recommended: boolean;
  variations: ApiVariation[]; addons: ApiOption[];
  dietary?: string[]; nutrition?: Record<string, number>; age_restricted?: boolean;
}
interface Config { money: { currencies: { settlement: string; accepted: { code: string }[] } } }

export default function MenuPage() {
  return <Shell title="menu"><Gate cap="catalogue"><Menu /></Gate></Shell>;
}

const nameOf = (names: Record<string, string>, lang: string) => names[lang] || names.fr || names.en || Object.values(names)[0] || "";
type Form = DishFormValue;

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
  const [notice, setNotice] = useState<string | null>(null);

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
    veg: it.veg === true ? "veg" : it.veg === false ? "non" : "", recommended: it.recommended, age_restricted: it.age_restricted ?? false, tags: it.tags.join(", "), allergens: it.allergens.join(", "),
    dietary: [...(it.dietary ?? [])],
    kcal: it.nutrition?.kcal !== undefined ? String(it.nutrition.kcal) : "", protein_g: it.nutrition?.protein_g !== undefined ? String(it.nutrition.protein_g) : "",
    carbs_g: it.nutrition?.carbs_g !== undefined ? String(it.nutrition.carbs_g) : "", fat_g: it.nutrition?.fat_g !== undefined ? String(it.nutrition.fat_g) : "",
    variations: (it.variations ?? []).map((v) => ({ name: v.name, type: v.type, required: v.required, options: v.options.map((o) => ({ name: o.name, price: decimal(o.price, settlement) })) })),
    addons: (it.addons ?? []).map((a) => ({ name: a.name, price: decimal(a.price, settlement) })),
  });

  const branchName = branches?.find((b) => b.id === branchId)?.name ?? "menu";
  const doExport = () => {
    const rows = (items ?? []).map((it) => [
      it.id, it.names.fr ?? "", it.names.en ?? "", it.description?.fr ?? "", it.category ?? "",
      it.prices[settlement] ? decimal(it.prices[settlement]!.amount_minor, settlement) : "",
      it.veg === true ? "veg" : it.veg === false ? "non" : "", it.recommended ? "1" : "0",
      it.tags.join(";"), it.allergens.join(";"), it.available ? "1" : "0",
    ]);
    const csv = toCsv([["id", "name_fr", "name_en", "description_fr", "category", `price_${settlement}`, "veg", "recommended", "tags", "allergens", "available"], ...rows]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${branchName.replace(/[^\w-]+/g, "-").toLowerCase()}-menu.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    setBusy(true); setNotice(null); setError(null);
    try {
      const table = parseCsv(await file.text());
      if (table.length < 2) throw new Error(L("Le fichier est vide.", "The file is empty."));
      const header = table[0]!.map((h) => h.trim().toLowerCase());
      const col = (name: string) => header.indexOf(name);
      const pc = header.findIndex((h) => h.startsWith("price"));
      const rows = table.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
        const get = (name: string) => { const i = col(name); return i >= 0 ? (r[i] ?? "").trim() : ""; };
        const names: Record<string, string> = {};
        if (get("name_fr")) names.fr = get("name_fr");
        if (get("name_en")) names.en = get("name_en");
        const veg = get("veg").toLowerCase();
        const row: Record<string, unknown> = {
          names, prices: { [settlement]: pc >= 0 ? (r[pc] ?? "").trim() : "" },
          category: get("category") || null,
          veg: veg === "veg" || veg === "1" || veg === "true" ? true : veg === "non" || veg === "0" || veg === "false" ? false : null,
          recommended: ["1", "true", "oui", "yes"].includes(get("recommended").toLowerCase()),
          tags: get("tags").split(";").map((t) => t.trim()).filter(Boolean),
          allergens: get("allergens").split(";").map((t) => t.trim()).filter(Boolean),
        };
        if (get("description_fr")) row.description = { fr: get("description_fr") };
        if (get("id")) row.id = get("id");
        const av = get("available").toLowerCase();
        if (av) row.available = ["1", "true", "oui", "yes"].includes(av);
        return row;
      });
      const r = await api<{ imported: number; created: number; updated: number }>(`/v1/branches/${branchId}/menu/import`, { method: "POST", country, body: { rows } });
      setNotice(L(`${r.imported} plats importés (${r.created} ajoutés, ${r.updated} modifiés).`, `${r.imported} dishes imported (${r.created} added, ${r.updated} updated).`));
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    try {
      await api(`/v1/branches/${branchId}/items${form.id ? `/${form.id}` : ""}`, { method: "POST", country, body: dishPayload(form, settlement) });
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
        <button type="button" className="btn" onClick={doExport} disabled={!items}>{L("Exporter", "Export")}</button>
        <label className="btn" aria-disabled={busy}>{L("Importer", "Import")}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
        </label>
        <button type="button" className="btn primary" onClick={() => setForm(blankDish())}>{L("Ajouter un plat", "Add a dish")}</button>
      </div>
      {notice ? <div className="banner ok">{notice}</div> : null}

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
            <DishFields form={form} setForm={setForm} settlement={settlement} lang={lang} L={L} />

            <OptionsEditor form={form} setForm={setForm} settlement={settlement} L={L} />

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

/** Serialise a table to RFC 4180 CSV, quoting any field with a comma, quote or newline. */
function toCsv(table: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return table.map((row) => row.map(cell).join(",")).join("\r\n");
}

/** Parse RFC 4180 CSV (quoted fields, escaped quotes, CRLF or LF) into a table of strings. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function decimal(minor: string, currency: string): string {
  const digits = currency === "CDF" ? 0 : 2;
  if (digits === 0) return minor;
  const neg = minor.startsWith("-");
  const raw = (neg ? minor.slice(1) : minor).padStart(digits + 1, "0");
  return (neg ? "-" : "") + `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
}
