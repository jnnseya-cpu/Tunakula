"use client";
/**
 * Rider applications: automatic checks at the top, the ID photo and the selfie side by side, then approve
 * (grants the RIDER role in the chosen communes) or reject with a reason the applicant sees.
 */
import { useCallback, useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface Check { code: string; ok: boolean; detail: string }
interface Application {
  id: string; status: string; full_name: string; date_of_birth: string; zones: string[]; vehicle: string; plate: string | null;
  id_type: string; id_number: string; id_photo: string; selfie: string; licence_photo: string | null; checks: Check[];
  created_at: string; reviewed_at: string | null; decision_note: string | null; phone: string | null;
}
const CHECK: Record<string, [string, string]> = {
  AGE: ["Âge 18 ans ou plus", "Age 18+"], ID_FORMAT: ["Format du numéro d'identité", "ID number format"], PHOTOS: ["Pièce et selfie reçus", "ID and selfie received"],
  PHOTOS_DISTINCT: ["Selfie différent de la pièce", "Selfie differs from ID"], DUPLICATE_ID: ["Pièce non utilisée par un autre", "ID not used by someone else"], LICENCE: ["Permis et plaque", "Licence and plate"],
};
const ID_LABEL: Record<string, [string, string]> = { VOTER_CARD: ["Carte d'électeur", "Voter card"], NATIONAL_ID: ["Carte d'identité", "National ID"], PASSPORT: ["Passeport", "Passport"], DRIVING_LICENCE: ["Permis de conduire", "Driving licence"] };
const VEH: Record<string, [string, string]> = { MOTO: ["Moto", "Motorbike"], BICYCLE: ["Vélo", "Bicycle"], CAR: ["Voiture", "Car"], FOOT: ["À pied", "On foot"] };

export default function RidersPage() {
  return <Shell title="riders"><Gate cap="riders"><Riders /></Gate></Shell>;
}

function Photo({ id, alt, country }: { id: string; alt: string; country: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { api<{ content_type: string; data_base64: string }>(`/v1/media/${id}`, { country }).then((m) => setSrc(`data:${m.content_type};base64,${m.data_base64}`)).catch(() => setSrc("")); }, [id, country]);
  return <figure className="rv-photo">{src ? <img src={src} alt={alt} /> : <div className="rv-ph">{src === "" ? "✕" : "…"}</div>}<figcaption>{alt}</figcaption></figure>;
}

function Riders() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows((await api<{ data: Application[] }>(`/v1/ops/rider-applications?status=${status}`, { country })).data); setError(null); } catch (e) { setError((e as Error).message); }
  }, [country, status]);
  useEffect(() => { void load(); }, [load]);
  const decide = async (a: Application, approve: boolean) => {
    setBusy(a.id); setError(null);
    try { await api(`/v1/ops/rider-applications/${a.id}/${approve ? "approve" : "reject"}`, { method: "POST", body: { note: notes[a.id] ?? "" }, country }); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const age = (dob: string) => Math.floor((Date.now() - Date.parse(dob)) / (365.2425 * 86_400_000));

  return (
    <div className="rv">
      <Quests country={country} L={L} />
      <div className="seg">{["PENDING", "APPROVED", "REJECTED"].map((s) => <button key={s} type="button" className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s === "PENDING" ? L("À examiner", "To review") : s === "APPROVED" ? L("Approuvées", "Approved") : L("Refusées", "Rejected")}</button>)}</div>
      {error ? <div className="banner error">{error}</div> : null}
      {!rows ? <div className="muted">…</div> : rows.length === 0 ? <div className="banner">{L("Aucune candidature.", "No applications.")}</div> : null}
      {rows?.map((a) => {
        const flags = a.checks.filter((c) => !c.ok);
        return (
          <section key={a.id} className={`card rv-card ${flags.length ? "flagged" : ""}`}>
            <div className="card-head"><div><h2>{a.full_name}</h2><p>{a.phone} · {age(a.date_of_birth)} {L("ans", "years")} · {L(...(VEH[a.vehicle] ?? [a.vehicle, a.vehicle]))}{a.plate ? ` · ${a.plate}` : ""} · {a.zones.join(", ")}</p></div>
              <span className="muted small">{new Date(a.created_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kinshasa" })}</span></div>
            <ul className="rv-checks">{a.checks.map((c) => <li key={c.code} className={c.ok ? "ok" : "flag"} title={c.detail}>{c.ok ? "✓" : "!"} {L(...(CHECK[c.code] ?? [c.code, c.code]))}{c.ok ? "" : ` — ${c.detail}`}</li>)}</ul>
            <p className="rv-id">{L(...(ID_LABEL[a.id_type] ?? [a.id_type, a.id_type]))} <b>{a.id_number}</b></p>
            <div className="rv-photos">
              <Photo id={a.id_photo} alt={L("Pièce d'identité", "ID document")} country={country} />
              <Photo id={a.selfie} alt="Selfie" country={country} />
              {a.licence_photo ? <Photo id={a.licence_photo} alt={L("Permis", "Licence")} country={country} /> : null}
            </div>
            {a.status === "PENDING" ? (
              <div className="rv-act">
                <input className="input" placeholder={flags.length ? L("Obligatoire : pourquoi approuver malgré l'alerte, ou pourquoi refuser", "Required: why approve despite the flag, or why reject") : L("Raison (obligatoire pour refuser — le candidat la voit)", "Reason (required to reject — the applicant sees it)")} value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                <button type="button" className="btn danger" disabled={busy === a.id} onClick={() => decide(a, false)}>{L("Refuser", "Reject")}</button>
                <button type="button" className="btn primary" disabled={busy === a.id} onClick={() => decide(a, true)}>{L("Approuver", "Approve")}</button>
              </div>
            ) : <p className="muted">{a.status === "APPROVED" ? L("Approuvée", "Approved") : L("Refusée", "Rejected")}{a.decision_note ? ` — “${a.decision_note}”` : ""}</p>}
          </section>
        );
      })}
    </div>
  );
}

interface Quest { id: string; name: string; target_deliveries: number; bonus: Money; ends_at: string; active: boolean; claims: number }

function Quests({ country, L }: { country: string; L: (fr: string, en: string) => string }) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [form, setForm] = useState({ name: "", target: "10", bonus: "", days: "7" });
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => api<{ quests: Quest[] }>("/v1/ops/quests", { country }).then((r) => setQuests(r.quests)).catch(() => setQuests([]));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    try {
      await api("/v1/ops/quests", { method: "POST", country, body: { name: form.name.trim(), target_deliveries: Number(form.target), bonus_minor: form.bonus.trim(), days: Number(form.days) } });
      setNotice(L("Quête créée.", "Quest created.")); setForm({ name: "", target: "10", bonus: "", days: "7" }); void load();
    } catch (e) { setNotice((e as Error).message); }
  };
  const lang = useConsole().lang;
  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Quêtes livreurs (primes)", "Rider quests (bonuses)")}</h2><p>{L("Récompensez un nombre de livraisons sur une période — comme DoorDash Quests / Uber Boost.", "Reward a number of deliveries in a window — like DoorDash Quests / Uber Boost.")}</p></div></div>
      {notice ? <div className="banner">{notice}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{L("Nom", "Name")}</th><th className="num">{L("Objectif", "Target")}</th><th className="num">{L("Prime", "Bonus")}</th><th>{L("Fin", "Ends")}</th><th className="num">{L("Réclamées", "Claimed")}</th></tr></thead>
          <tbody>
            {quests?.map((q) => (
              <tr key={q.id}><td><b>{q.name}</b>{!q.active ? <span className="muted"> · {L("inactive", "inactive")}</span> : null}</td><td className="num">{q.target_deliveries}</td><td className="num">{money(lang, q.bonus.amount_minor, q.bonus.currency)}</td><td>{new Date(q.ends_at).toLocaleDateString()}</td><td className="num">{q.claims}</td></tr>
            ))}
            {quests && quests.length === 0 ? <tr><td colSpan={5} className="muted">{L("Aucune quête", "No quests")}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <label>{L("Nom", "Name")}<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("Sprint du week-end", "Weekend sprint")} /></label>
        <label>{L("Livraisons cibles", "Target deliveries")}<input className="input" inputMode="numeric" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value.replace(/[^0-9]/g, "") })} /></label>
        <label>{L("Prime (unités mineures)", "Bonus (minor units)")}<input className="input" inputMode="numeric" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value.replace(/[^0-9]/g, "") })} placeholder="500" /></label>
        <label>{L("Durée (jours)", "Window (days)")}<input className="input" inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/[^0-9]/g, "") })} /></label>
      </div>
      <div className="card-foot"><button type="button" className="btn primary" disabled={!form.name.trim() || !form.bonus.trim()} onClick={create}>{L("Créer la quête", "Create quest")}</button></div>
    </section>
  );
}
