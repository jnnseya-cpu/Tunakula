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
      <Reviews branchId={id} country={country} lang={lang} L={L} />
    </>
  );
}

interface Review { id: string; restaurant_rating: number; rider_rating: number | null; comment: string | null; reviewer?: string; reply?: string | null; created_at: string }

function Reviews({ branchId, country, lang, L }: { branchId: string; country: string; lang: string; L: (fr: string, en: string) => string }) {
  const [rows, setRows] = useState<Review[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => api<{ reviews: Review[] }>(`/v1/admin/branches/${branchId}/reviews`, { country }).then((r) => setRows(r.reviews)).catch(() => setRows([]));
  useEffect(() => { void load(); }, [branchId, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const reply = async (id: string) => {
    try { await api(`/v1/admin/reviews/${id}/reply`, { method: "POST", country, body: { reply: drafts[id] ?? "" } }); setNotice(L("Réponse publiée.", "Reply posted.")); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Avis clients", "Customer reviews")}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
      {notice ? <div className="banner">{notice}</div> : null}
      {rows && rows.length === 0 ? <p className="muted">{L("Aucun avis pour l'instant.", "No reviews yet.")}</p> : null}
      {rows?.map((r) => (
        <div key={r.id} className="review">
          <div className="review-head"><span className="review-stars" title={`${r.restaurant_rating}/5`}>{stars(r.restaurant_rating)}</span><b>{r.reviewer ?? "Client"}</b><span className="muted small">{new Date(r.created_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB")}</span></div>
          {r.comment ? <p className="review-comment">{r.comment}</p> : null}
          {r.reply ? <p className="review-reply"><b>{L("Votre réponse :", "Your reply:")}</b> {r.reply}</p> : (
            <div className="review-reply-form">
              <input className="input" placeholder={L("Répondre…", "Reply…")} value={drafts[r.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} />
              <button type="button" className="btn" disabled={!(drafts[r.id] ?? "").trim()} onClick={() => reply(r.id)}>{L("Répondre", "Reply")}</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
