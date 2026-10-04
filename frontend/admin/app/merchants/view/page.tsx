"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../../components/shell";
import { api, type Money } from "../../../lib/api";
import { money } from "../../../lib/format";

interface Item { id: string; names: Record<string, string>; prices: Record<string, Money>; tags: string[]; allergens: string[]; available: boolean }
interface Menu { branch: { id: string; name: string; commune: string | null; status: string }; items: Item[] }

export default function MerchantPage() {
  return <Shell title="merchants"><Gate cap="catalogue"><Suspense><MerchantMenu /></Suspense></Gate></Shell>;
}

function MerchantMenu() {
  const id = useSearchParams().get("id") ?? "";
  const { country, lang } = useConsole();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ fr: "", en: "", usd: "", cdf: "", allergens: "" });
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<Menu>(`/v1/branches/${id}/menu`, { country }).then((m) => { setMenu(m); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (item: Item) => {
    try {
      await api(`/v1/branches/${id}/items/${item.id}/availability`, { method: "POST", country, body: { available: !item.available } });
      void load();
    } catch (e) { setNotice((e as Error).message); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const prices: Record<string, string> = {};
    if (form.usd) prices["USD"] = form.usd;
    if (form.cdf) prices["CDF"] = form.cdf;
    try {
      await api(`/v1/branches/${id}/items`, { method: "POST", country, body: { names: { fr: form.fr, ...(form.en ? { en: form.en } : {}) }, prices, allergens: form.allergens.split(",").map((a) => a.trim()).filter(Boolean) } });
      setForm({ fr: "", en: "", usd: "", cdf: "", allergens: "" });
      setNotice(L("Article ajouté.", "Item added.")); void load();
    } catch (err) { setNotice((err as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!menu) return <div className="muted">…</div>;
  return (
    <>
      <p><Link className="link-btn" href="/merchants/">← {L("Restaurants et commerces", "Merchants")}</Link></p>
      <section className="card">
        <div className="card-head"><div><h2>{menu.branch.name}</h2><p>{menu.branch.commune ?? ""} · {menu.items.length} {L("articles", "items")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Article", "Item")}</th><th className="num">USD</th><th className="num">CDF</th><th>{L("Allergènes", "Allergens")}</th><th>{L("Disponible", "Available")}</th></tr></thead>
            <tbody>
              {menu.items.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.names[lang] ?? i.names["fr"] ?? Object.values(i.names)[0]}</b>{i.names["en"] && lang === "fr" ? <span className="muted"> · {i.names["en"]}</span> : null}</td>
                  <td className="num">{i.prices["USD"] ? money(lang, i.prices["USD"].amount_minor, "USD") : "—"}</td>
                  <td className="num">{i.prices["CDF"] ? money(lang, i.prices["CDF"].amount_minor, "CDF") : "—"}</td>
                  <td>{i.allergens.join(", ") || <span className="muted">—</span>}</td>
                  <td><button className={`btn ${i.available ? "ghost" : "danger"}`} type="button" onClick={() => toggle(i)} aria-pressed={i.available}>{i.available ? L("Oui", "Yes") : L("Épuisé", "Sold out")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>{L("Ajouter un article", "Add an item")}</h2><p>{L("Prix du comptoir, en unités normales (ex. 12.50). Un prix USD est obligatoire.", "Counter prices in normal units (e.g. 12.50). A USD price is required.")}</p></div></div>
        <form className="filters" onSubmit={add}>
          <input className="input" required placeholder={L("Nom (français)", "Name (French)")} value={form.fr} onChange={(e) => setForm({ ...form, fr: e.target.value })} />
          <input className="input" placeholder={L("Nom (anglais)", "Name (English)")} value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} />
          <input className="input" required inputMode="decimal" placeholder="USD" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} style={{ width: 100 }} />
          <input className="input" inputMode="decimal" placeholder="CDF" value={form.cdf} onChange={(e) => setForm({ ...form, cdf: e.target.value })} style={{ width: 110 }} />
          <input className="input" placeholder={L("Allergènes (virgules)", "Allergens (commas)")} value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} />
          <button className="btn primary" type="submit">{L("Ajouter", "Add")}</button>
        </form>
        {notice ? <div className="banner" style={{ marginTop: 10 }}>{notice}</div> : null}
      </section>
    </>
  );
}
