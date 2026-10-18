"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Banner { id: string; headline: string; subtext: string; cta_label: string; cta_href: string; tone: "ACCENT" | "DARK" | "GREEN" | "ORANGE"; sort: number; active: boolean; starts_at: string; ends_at: string; status: "LIVE" | "UPCOMING" | "ENDED" | "OFF" }
const TONES: Banner["tone"][] = ["ACCENT", "DARK", "GREEN", "ORANGE"];
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const BLANK = () => ({ headline: "", subtext: "", cta_label: "", cta_href: "", tone: "ACCENT" as Banner["tone"], sort: "0", starts_at: localInput(new Date()), ends_at: localInput(new Date(Date.now() + 7 * 86400000)) });
const STATUS: Record<string, [string, string, string]> = { LIVE: ["En cours", "Live", "live"], UPCOMING: ["À venir", "Upcoming", "up"], ENDED: ["Terminé", "Ended", "end"], OFF: ["Désactivé", "Off", "off"] };

export default function BannersPage() {
  return <Shell title="banners"><Gate cap="markets"><Banners /></Gate></Shell>;
}

function Banners() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Banner[] | null>(null);
  const [form, setForm] = useState({ ...BLANK() });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ banners: Banner[] }>("/v1/admin/banners", { country }).then((r) => { setRows(r.banners); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setForm({ ...BLANK() }); setEditing(null); };
  const edit = (b: Banner) => { setEditing(b.id); setForm({ headline: b.headline, subtext: b.subtext, cta_label: b.cta_label, cta_href: b.cta_href, tone: b.tone, sort: String(b.sort), starts_at: localInput(new Date(b.starts_at)), ends_at: localInput(new Date(b.ends_at)) }); };
  const save = async () => {
    const body = { headline: form.headline.trim(), subtext: form.subtext.trim(), cta_label: form.cta_label.trim(), cta_href: form.cta_href.trim(), tone: form.tone, sort: Number(form.sort) || 0, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() };
    try { await api(editing ? `/v1/admin/banners/${editing}` : "/v1/admin/banners", { method: "POST", country, body }); setNotice(L(editing ? "Bannière mise à jour." : "Bannière créée.", editing ? "Banner updated." : "Banner created.")); reset(); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const toggle = async (b: Banner) => { try { await api(`/v1/admin/banners/${b.id}`, { method: "POST", country, body: { active: !b.active } }); void load(); } catch (e) { setNotice((e as Error).message); } };
  const remove = async (b: Banner) => { try { await api(`/v1/admin/banners/${b.id}`, { method: "DELETE", country }); void load(); } catch (e) { setNotice((e as Error).message); } };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Bannières marketing affichées aux clients sur la page commander, pendant leur fenêtre.", "Marketing banners shown to customers on the order page, during their window.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      {/* A live preview of the banner being edited. */}
      <section className="card">
        <div className="card-head"><div><h2>{editing ? L("Modifier la bannière", "Edit banner") : L("Nouvelle bannière", "New banner")}</h2></div>{editing ? <button className="btn ghost" type="button" onClick={reset}>{L("Annuler", "Cancel")}</button> : null}</div>
        <div className={`bnr-preview tone-${form.tone.toLowerCase()}`}>
          <div><b>{form.headline || L("Votre titre", "Your headline")}</b>{form.subtext ? <span>{form.subtext}</span> : null}</div>
          {form.cta_label ? <span className="bnr-cta">{form.cta_label} →</span> : null}
        </div>
        <div className="form-grid">
          <label>{L("Titre", "Headline")}<input className="input" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} /></label>
          <label>{L("Sous-titre", "Subtext")}<input className="input" value={form.subtext} onChange={(e) => setForm({ ...form, subtext: e.target.value })} /></label>
          <label>{L("Libellé du bouton", "Button label")}<input className="input" value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} placeholder={L("Commander", "Order now")} /></label>
          <label>{L("Lien (/order ou https://…)", "Link (/order or https://…)")}<input className="input" value={form.cta_href} onChange={(e) => setForm({ ...form, cta_href: e.target.value })} placeholder="/order" /></label>
          <label>{L("Couleur", "Tone")}<select className="select" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value as Banner["tone"] })}>{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>{L("Ordre", "Sort")}<input className="input" inputMode="numeric" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Début", "Starts")}<input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
          <label>{L("Fin", "Ends")}<input className="input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
        </div>
        <div className="card-foot"><button className="btn primary" type="button" disabled={!form.headline.trim()} onClick={save}>{editing ? L("Enregistrer", "Save") : L("Créer la bannière", "Create banner")}</button></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Bannières", "Banners")} · {country}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Titre", "Headline")}</th><th>{L("Couleur", "Tone")}</th><th>{L("Fenêtre", "Window")}</th><th>{L("Statut", "Status")}</th><th></th></tr></thead>
            <tbody>
              {rows?.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.headline}</b>{b.subtext ? <><br /><small className="muted">{b.subtext}</small></> : null}</td>
                  <td><span className={`bnr-dot tone-${b.tone.toLowerCase()}`} /> {b.tone}</td>
                  <td className="muted">{new Date(b.starts_at).toLocaleDateString()} → {new Date(b.ends_at).toLocaleDateString()}</td>
                  <td><span className={`st ${STATUS[b.status][2]}`}>{L(STATUS[b.status][0], STATUS[b.status][1])}</span></td>
                  <td>
                    <button className="link-btn" type="button" onClick={() => edit(b)}>{L("Modifier", "Edit")}</button>
                    <button className="link-btn" type="button" onClick={() => toggle(b)}>{b.active ? L("Désactiver", "Off") : L("Activer", "On")}</button>
                    <button className="link-btn danger" type="button" onClick={() => remove(b)}>{L("Supprimer", "Delete")}</button>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 ? <tr><td colSpan={5} className="muted">{L("Aucune bannière", "No banners")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
