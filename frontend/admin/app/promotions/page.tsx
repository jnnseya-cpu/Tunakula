"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Branch { id: string; name: string; status: string }
interface Item { id: string; names: Record<string, string>; category: string | null }
interface Promotion { id: string; name: string; scope: "ITEM" | "CATEGORY" | "BRANCH"; target_item_id: string | null; target_category: string | null; percent: number; percent_bps: number; hours: Record<string, [string, string][]>; active: boolean }
const WEEK: [number, string, string][] = [[1, "Lun", "Mon"], [2, "Mar", "Tue"], [3, "Mer", "Wed"], [4, "Jeu", "Thu"], [5, "Ven", "Fri"], [6, "Sam", "Sat"], [0, "Dim", "Sun"]];
const BLANK = () => ({ name: "", scope: "BRANCH" as "ITEM" | "CATEGORY" | "BRANCH", target_item_id: "", target_category: "", percent: "20", scheduled: false, hours: {} as Record<string, [string, string][]> });

export default function PromotionsPage() {
  return <Shell title="promotions"><Gate cap="catalogue"><Promotions /></Gate></Shell>;
}

const nameOf = (names: Record<string, string>, lang: string) => names[lang] || names.fr || names.en || Object.values(names)[0] || "";

function Promotions() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [form, setForm] = useState({ ...BLANK() });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("branch");
    api<{ data: Branch[] }>("/v1/admin/branches", { country })
      .then((r) => { setBranches(r.data); const pick = (wanted && r.data.some((b) => b.id === wanted)) ? wanted : r.data[0]?.id; if (pick) setBranchId((b) => b || pick); })
      .catch((e: Error) => setError(e.message));
  }, [country]);

  const load = useCallback(() => {
    if (!branchId) return;
    api<{ promotions: Promotion[] }>(`/v1/branches/${branchId}/promotions`, { country }).then((r) => { setRows(r.promotions); setError(null); }).catch((e: Error) => setError(e.message));
    api<{ items: Item[] }>(`/v1/branches/${branchId}/menu`, { country }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [branchId, country]);
  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);

  const create = async () => {
    const body: Record<string, unknown> = { name: form.name.trim(), scope: form.scope, percent: Number(form.percent) || 0, hours: form.scheduled ? form.hours : {} };
    if (form.scope === "ITEM") body.target_item_id = form.target_item_id;
    if (form.scope === "CATEGORY") body.target_category = form.target_category;
    try { await api(`/v1/branches/${branchId}/promotions`, { method: "POST", country, body }); setNotice(L("Promotion créée.", "Promotion created.")); setForm({ ...BLANK() }); load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const toggle = async (p: Promotion) => { try { await api(`/v1/branches/${branchId}/promotions/${p.id}`, { method: "POST", country, body: { active: !p.active } }); load(); } catch (e) { setNotice((e as Error).message); } };
  const remove = async (p: Promotion) => { try { await api(`/v1/branches/${branchId}/promotions/${p.id}`, { method: "DELETE", country }); load(); } catch (e) { setNotice((e as Error).message); } };

  const covers = (p: Promotion) => p.scope === "BRANCH" ? L("Toute la carte", "Whole menu") : p.scope === "CATEGORY" ? `${L("Catégorie", "Category")}: ${p.target_category}` : nameOf(items.find((i) => i.id === p.target_item_id)?.names ?? {}, lang) || L("Un plat", "One dish");
  const windowText = (p: Promotion) => Object.keys(p.hours).length === 0 ? L("À tout moment", "Any time") : WEEK.filter(([d]) => p.hours[String(d)]).map(([d, fr, en]) => `${lang === "fr" ? fr : en} ${p.hours[String(d)]![0][0]}–${p.hours[String(d)]![0][1]}`).join(", ");

  const setDay = (d: number, on: boolean) => setForm({ ...form, hours: on ? { ...form.hours, [String(d)]: [["11:00", "14:00"]] } : (() => { const h = { ...form.hours }; delete h[String(d)]; return h; })() });
  const setTime = (d: number, i: 0 | 1, v: string) => { const w = form.hours[String(d)]?.[0] ?? ["11:00", "14:00"]; const nw: [string, string] = i === 0 ? [v, w[1]] : [w[0], v]; setForm({ ...form, hours: { ...form.hours, [String(d)]: [nw] } }); };

  if (error && !branches) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Happy hour et promotions : un pourcentage de réduction sur un plat, une catégorie ou toute la carte, en option seulement sur certains créneaux. La réduction baisse le prix — le marchand la finance en recevant moins (pas d'impact sur le livreur ni la plateforme).", "Happy hour and promotions: a percentage off a dish, a category or the whole menu, optionally only during set time windows. The discount lowers the price — the merchant funds it by receiving less (no impact on the rider or the platform).")}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      <section className="card">
        <div className="card-head">
          <div><h2>{L("Promotions", "Promotions")}</h2><p>{rows ? `${rows.filter((p) => p.active).length} ${L("actives", "live")}` : "…"}</p></div>
          <label className="field inline">{L("Établissement", "Branch")}
            <select className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setRows(null); }}>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Nom", "Name")}</th><th className="num">{L("Remise", "Off")}</th><th>{L("Couvre", "Covers")}</th><th>{L("Quand", "When")}</th><th>{L("Actif", "Active")}</th><th></th></tr></thead>
            <tbody>
              {rows?.map((p) => (
                <tr key={p.id} className={p.active ? "" : "muted-row"}>
                  <td><b>{p.name}</b></td>
                  <td className="num"><b>−{p.percent}%</b></td>
                  <td className="muted">{covers(p)}</td>
                  <td className="muted">{windowText(p)}</td>
                  <td><button className="link-btn" type="button" onClick={() => toggle(p)}>{p.active ? "✓" : "—"}</button></td>
                  <td><button className="link-btn danger" type="button" onClick={() => remove(p)}>{L("Supprimer", "Delete")}</button></td>
                </tr>
              ))}
              {rows && rows.length === 0 ? <tr><td colSpan={6} className="muted">{L("Aucune promotion.", "No promotions.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Nouvelle promotion", "New promotion")}</h2></div></div>
        <div className="form-grid">
          <label>{L("Nom", "Name")}<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("Happy hour", "Happy hour")} /></label>
          <label>{L("Remise (%)", "Discount (%)")}<input className="input" inputMode="decimal" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label>{L("Portée", "Scope")}<select className="select" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}><option value="BRANCH">{L("Toute la carte", "Whole menu")}</option><option value="CATEGORY">{L("Une catégorie", "A category")}</option><option value="ITEM">{L("Un plat", "One dish")}</option></select></label>
          {form.scope === "CATEGORY" ? <label>{L("Catégorie", "Category")}<select className="select" value={form.target_category} onChange={(e) => setForm({ ...form, target_category: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label> : null}
          {form.scope === "ITEM" ? <label>{L("Plat", "Dish")}<select className="select" value={form.target_item_id} onChange={(e) => setForm({ ...form, target_item_id: e.target.value })}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{nameOf(i.names, lang)}</option>)}</select></label> : null}
          <label className="check"><input type="checkbox" checked={form.scheduled} onChange={(e) => setForm({ ...form, scheduled: e.target.checked, hours: e.target.checked ? Object.fromEntries(WEEK.map(([d]) => [String(d), [["11:00", "14:00"]]])) : {} })} />{L("Seulement à certaines heures (happy hour)", "Only at set hours (happy hour)")}</label>
        </div>
        {form.scheduled ? (
          <div className="avail-grid">
            {WEEK.map(([d, fr, en]) => {
              const w = form.hours[String(d)]?.[0];
              return (
                <div className="avail-row" key={d}>
                  <label className="check"><input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked)} /> <span className="avail-day">{lang === "fr" ? fr : en}</span></label>
                  {w ? <span className="avail-times"><input type="time" className="input" value={w[0]} onChange={(e) => setTime(d, 0, e.target.value)} /><span>→</span><input type="time" className="input" value={w[1]} onChange={(e) => setTime(d, 1, e.target.value)} /></span> : <span className="muted small">{L("inactif", "off")}</span>}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="card-foot"><button className="btn primary" type="button" disabled={!form.name.trim() || (form.scope === "ITEM" && !form.target_item_id) || (form.scope === "CATEGORY" && !form.target_category)} onClick={create}>{L("Créer la promotion", "Create promotion")}</button></div>
      </section>
    </>
  );
}
