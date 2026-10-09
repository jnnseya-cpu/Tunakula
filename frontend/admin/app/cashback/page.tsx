"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface Campaign {
  id: string; name: string; percent: number; percent_bps: number;
  min_spend: Money; max_cashback: Money | null; starts_at: string; ends_at: string; active: boolean;
  status: "LIVE" | "UPCOMING" | "ENDED" | "OFF";
}
// A datetime-local default: now, and now + 3 days, as "YYYY-MM-DDTHH:MM".
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const BLANK = () => ({ name: "", percent: "10", min_spend: "", max_cashback: "", starts_at: localInput(new Date()), ends_at: localInput(new Date(Date.now() + 3 * 86400000)) });

export default function CashbackPage() {
  return <Shell title="cashback"><Gate cap="markets"><Cashback /></Gate></Shell>;
}

const STATUS: Record<string, [string, string, string]> = { LIVE: ["En cours", "Live", "live"], UPCOMING: ["À venir", "Upcoming", "up"], ENDED: ["Terminé", "Ended", "end"], OFF: ["Désactivé", "Off", "off"] };

function Cashback() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [form, setForm] = useState({ ...BLANK() });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ campaigns: Campaign[] }>("/v1/admin/cashback", { country }).then((r) => { setRows(r.campaigns); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setForm({ ...BLANK() }); setEditing(null); };
  const edit = (c: Campaign) => {
    setEditing(c.id);
    setForm({ name: c.name, percent: String(c.percent), min_spend: BigInt(c.min_spend.amount_minor) > 0n ? decimal(c.min_spend.amount_minor) : "", max_cashback: c.max_cashback ? decimal(c.max_cashback.amount_minor) : "", starts_at: localInput(new Date(c.starts_at)), ends_at: localInput(new Date(c.ends_at)) });
  };
  const save = async () => {
    const body = {
      name: form.name.trim(), percent_bps: Math.round((Number(form.percent) || 0) * 100),
      min_spend: form.min_spend.trim() || "0", max_cashback: form.max_cashback.trim() || null,
      starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(),
    };
    try { await api(editing ? `/v1/admin/cashback/${editing}` : "/v1/admin/cashback", { method: "POST", country, body }); setNotice(L(editing ? "Campagne mise à jour." : "Campagne créée.", editing ? "Campaign updated." : "Campaign created.")); reset(); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const toggle = async (c: Campaign) => { try { await api(`/v1/admin/cashback/${c.id}`, { method: "POST", country, body: { active: !c.active } }); void load(); } catch (e) { setNotice((e as Error).message); } };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Cashback promotionnel : un pourcentage reversé au portefeuille du client sur les commandes livrées pendant la campagne. Financé par la plateforme — le marchand et le livreur sont payés en entier.", "Promotional cashback: a percentage credited to the customer's wallet on orders delivered during the campaign. Funded by the platform — the merchant and rider are paid in full.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}
      <section className="card">
        <div className="card-head"><div><h2>{L("Campagnes cashback", "Cashback campaigns")} · {country}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Nom", "Name")}</th><th className="num">{L("Taux", "Rate")}</th><th className="num">{L("Min", "Min")}</th><th className="num">{L("Plafond", "Cap")}</th><th>{L("Fenêtre", "Window")}</th><th>{L("Statut", "Status")}</th><th></th></tr></thead>
            <tbody>
              {rows?.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td className="num">{c.percent}%</td>
                  <td className="num">{BigInt(c.min_spend.amount_minor) > 0n ? money(lang, c.min_spend.amount_minor, c.min_spend.currency) : "—"}</td>
                  <td className="num">{c.max_cashback ? money(lang, c.max_cashback.amount_minor, c.max_cashback.currency) : "—"}</td>
                  <td className="muted">{new Date(c.starts_at).toLocaleDateString()} → {new Date(c.ends_at).toLocaleDateString()}</td>
                  <td><span className={`st ${STATUS[c.status][2]}`}>{L(STATUS[c.status][0], STATUS[c.status][1])}</span></td>
                  <td>
                    <button className="link-btn" type="button" onClick={() => edit(c)}>{L("Modifier", "Edit")}</button>
                    <button className="link-btn" type="button" onClick={() => toggle(c)}>{c.active ? L("Désactiver", "Turn off") : L("Activer", "Turn on")}</button>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 ? <tr><td colSpan={7} className="muted">{L("Aucune campagne", "No campaigns")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{editing ? L("Modifier la campagne", "Edit campaign") : L("Nouvelle campagne", "New campaign")}</h2></div>{editing ? <button className="btn ghost" type="button" onClick={reset}>{L("Annuler", "Cancel")}</button> : null}</div>
        <div className="form-grid">
          <label>{L("Nom", "Name")}<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("Cashback du week-end", "Weekend cashback")} /></label>
          <label>{L("Taux (%)", "Rate (%)")}<input className="input" inputMode="decimal" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label>{L("Dépense min (vide = aucune)", "Min spend (blank = none)")}<input className="input" inputMode="decimal" value={form.min_spend} onChange={(e) => setForm({ ...form, min_spend: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label>{L("Plafond par commande (vide = aucun)", "Cap per order (blank = none)")}<input className="input" inputMode="decimal" value={form.max_cashback} onChange={(e) => setForm({ ...form, max_cashback: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label>{L("Début", "Starts")}<input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
          <label>{L("Fin", "Ends")}<input className="input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
        </div>
        <div className="card-foot"><button className="btn primary" type="button" disabled={!form.name.trim()} onClick={save}>{editing ? L("Enregistrer", "Save") : L("Créer la campagne", "Create campaign")}</button></div>
      </section>
    </>
  );
}

// Minor units → a plain decimal string for the form inputs (USD-style 2 dp; good enough for the editor).
function decimal(minor: string) { const n = BigInt(minor); return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`; }
