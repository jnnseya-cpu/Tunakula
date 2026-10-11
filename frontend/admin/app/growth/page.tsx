"use client";
/**
 * Growth (ops): the re-engagement console. The agent reads each customer's lifecycle from their own order
 * history; this screen shows the segment breakdown and the customers who have lapsed, and lets an operator win
 * one back with a message and an optional, capped goodwill wallet credit. Requires `campaign:write`.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Customer { customer_id: string; display_name: string; phone: string; segment: string; orders: number; spend_minor: string; currency: string; days: number }
type Counts = Record<string, number>;

const SEGS = ["NEW", "ACTIVE", "AT_RISK", "LAPSED", "DORMANT"] as const;
const SEG_LABEL: Record<string, { fr: string; en: string }> = {
  NEW: { fr: "Nouveaux", en: "New" }, ACTIVE: { fr: "Actifs", en: "Active" }, AT_RISK: { fr: "À risque", en: "At risk" },
  LAPSED: { fr: "Inactifs", en: "Lapsed" }, DORMANT: { fr: "Dormants", en: "Dormant" },
};
const fmt = (minor: string, ccy: string) => `${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${ccy}`;

export default function GrowthPage() {
  return <Shell title="growth"><Gate cap="growth"><Growth /></Gate></Shell>;
}

function Growth() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<{ counts: Counts; customers: Customer[] }>(`/v1/ops/growth/audience${filter ? `?segment=${filter}` : ""}`, { country })
    .then((r) => { setCounts(r.counts); setRows(r.customers); setError(null); })
    .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const winBack = async (c: Customer, credit: string) => {
    setBusy(c.customer_id); setNotice(null);
    try {
      const minor = Math.round(Number(credit || "0") * 100);
      const r = await api<{ segment: string; credited: { amount_minor: string; currency: string } | null; message?: string }>("/v1/ops/growth/win-back", {
        method: "POST", country, body: { customer_id: c.customer_id, ...(minor > 0 ? { credit_minor: String(minor), currency: c.currency } : {}) },
      });
      setNotice(L(`Message envoyé à ${c.display_name}`, `Win-back sent to ${c.display_name}`) + (r.credited ? ` · ${fmt(r.credited.amount_minor, r.credited.currency)}` : "") + (r.message ? ` — « ${r.message} »` : ""));
      void load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L(
        "L’agent de croissance lit le cycle de vie de chaque client depuis ses propres commandes. Reconquérez un client inactif avec un message et un crédit de bienvenue plafonné (financé par les promotions, versé au portefeuille).",
        "The growth agent reads each customer's lifecycle from their own orders. Win back a lapsed customer with a message and a capped goodwill credit (promotion-funded, paid to their wallet).",
      )}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      <Autonomy country={country} L={L} onRan={() => void load()} />

      <div className="growth-tiles">
        {SEGS.map((s) => (
          <button key={s} type="button" className={`growth-tile seg-${s.toLowerCase()} ${filter === s ? "on" : ""}`} onClick={() => setFilter(filter === s ? "" : s)}>
            <span className="growth-n">{counts ? (counts[s] ?? 0) : "…"}</span>
            <span className="growth-seg">{L(SEG_LABEL[s]!.fr, SEG_LABEL[s]!.en)}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="card-head"><div><h2>{L("Clients à reconquérir", "Customers to win back")}</h2><p>{rows ? `${rows.length}` : "…"}{filter ? ` · ${L(SEG_LABEL[filter]!.fr, SEG_LABEL[filter]!.en)}` : ""}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Client", "Customer")}</th><th>{L("Segment", "Segment")}</th><th>{L("Commandes", "Orders")}</th><th>{L("Dépensé", "Spent")}</th><th>{L("Depuis", "Last seen")}</th><th>{L("Reconquête", "Win back")}</th></tr></thead>
            <tbody>
              {rows?.map((c) => <Row key={c.customer_id} c={c} L={L} busy={busy === c.customer_id} onSend={winBack} />)}
              {rows && rows.length === 0 ? <tr><td colSpan={6} className="muted">{L("Personne à reconquérir ici — vos clients reviennent.", "Nobody to win back here — your customers are coming back.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

interface Money { amount_minor: string; currency: string }
interface Policy { enabled: boolean; segments: string[]; per_customer_cap: Money; daily_budget: Money; max_customers_per_run: number; currency: string }
interface Run { id: string; dry_run: boolean; reached: number; planned: number; credited: Money; would_spend: Money; capped_by: string | null; ran_at: string }
interface SweepResult { dry_run: boolean; planned: number; reached: number; would_spend: Money; credited: Money; capped_by: string | null; eligible: number; preview: { display_name: string; phone: string; segment: string; credit: Money | null }[]; sample_message?: string; sample_source?: string }
const AUTO_SEGS = ["LAPSED", "DORMANT"] as const;
const major = (m: Money) => (Number(m.amount_minor) / 100).toFixed(2);
const CAP_REASON: Record<string, { fr: string; en: string }> = {
  BUDGET: { fr: "plafond budgétaire atteint", en: "daily budget reached" },
  COUNT: { fr: "nombre maximal atteint", en: "max customers reached" },
};

/** The autonomy console: the growth agent can run win-back sweeps on its own, strictly within the caps set here,
 *  and every run is logged. Preview first (changes nothing), then run for real. Needs the agent_autonomy:set cap. */
function Autonomy({ country, L, onRan }: { country: string; L: (fr: string, en: string) => string; onRan: () => void }) {
  const [data, setData] = useState<{ policy: Policy; can_manage: boolean; cap_minor: string; eligible_segments: string[]; runs: Run[] } | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; segments: string[]; cap: string; budget: string; max: string } | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<{ policy: Policy; can_manage: boolean; cap_minor: string; eligible_segments: string[]; runs: Run[] }>("/v1/ops/growth/autonomy", { country })
    .then((r) => { setData(r); setForm({ enabled: r.policy.enabled, segments: r.policy.segments, cap: major(r.policy.per_customer_cap), budget: major(r.policy.daily_budget), max: String(r.policy.max_customers_per_run) }); })
    .catch(() => setData(null));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !form) return null;
  const ccy = data.policy.currency;
  const capCeiling = (Number(data.cap_minor) / 100).toFixed(0);
  const ro = !data.can_manage;

  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      await api("/v1/ops/growth/autonomy", { method: "POST", country, body: {
        enabled: form.enabled, segments: form.segments,
        per_customer_cap_minor: String(Math.round(Number(form.cap || "0") * 100)),
        daily_budget_minor: String(Math.round(Number(form.budget || "0") * 100)),
        max_customers_per_run: Math.round(Number(form.max || "0")), currency: ccy,
      } });
      setMsg(L("Règles enregistrées.", "Policy saved.")); await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };

  const sweep = async (dry: boolean) => {
    setBusy(dry ? "preview" : "run"); setMsg(null); setResult(null);
    try {
      const r = await api<SweepResult>("/v1/ops/growth/sweep", { method: "POST", country, body: { dry_run: dry } });
      setResult(r); await load(); if (!dry) onRan();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };

  const toggleSeg = (s: string) => setForm((f) => f ? { ...f, segments: f.segments.includes(s) ? f.segments.filter((x) => x !== s) : [...f.segments, s] } : f);

  return (
    <section className="card auto-card">
      <div className="card-head">
        <div><h2>{L("Reconquêtes autonomes", "Autonomous win-backs")}</h2><p>{L(
          "L’agent peut lancer des campagnes de reconquête tout seul — uniquement dans les limites ci-dessous, et chaque passage est journalisé.",
          "The agent can run win-back sweeps on its own — only within the caps below, and every run is logged.",
        )}</p></div>
        <span className={`pill ${form.enabled ? "good" : ""}`}>{form.enabled ? L("Activé", "On") : L("Désactivé", "Off")}</span>
      </div>

      <div className="auto-grid">
        <label className="auto-switch">
          <input type="checkbox" checked={form.enabled} disabled={ro} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>{L("Autoriser l’agent à lancer des reconquêtes", "Let the agent run sweeps")}</span>
        </label>
        <div className="auto-field">
          <span>{L("Crédit max / client", "Max credit / customer")} <small className="muted">({L("plafond", "ceiling")} {capCeiling} {ccy})</small></span>
          <input type="number" min="0" step="0.5" value={form.cap} disabled={ro} onChange={(e) => setForm({ ...form, cap: e.target.value })} /> <em>{ccy}</em>
        </div>
        <div className="auto-field">
          <span>{L("Budget max / passage", "Max budget / run")}</span>
          <input type="number" min="0" step="1" value={form.budget} disabled={ro} onChange={(e) => setForm({ ...form, budget: e.target.value })} /> <em>{ccy}</em>
        </div>
        <div className="auto-field">
          <span>{L("Clients max / passage", "Max customers / run")}</span>
          <input type="number" min="0" step="1" value={form.max} disabled={ro} onChange={(e) => setForm({ ...form, max: e.target.value })} />
        </div>
        <div className="auto-field">
          <span>{L("Segments ciblés", "Target segments")}</span>
          <div className="auto-segs">
            {AUTO_SEGS.map((s) => (
              <label key={s} className={form.segments.includes(s) ? "on" : ""}>
                <input type="checkbox" checked={form.segments.includes(s)} disabled={ro} onChange={() => toggleSeg(s)} />
                {L(SEG_LABEL[s]!.fr, SEG_LABEL[s]!.en)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="auto-actions">
        {!ro ? <button type="button" className="btn primary sm" disabled={!!busy} onClick={save}>{busy === "save" ? "…" : L("Enregistrer les règles", "Save policy")}</button> : null}
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => sweep(true)}>{busy === "preview" ? "…" : L("Simuler un passage", "Preview sweep")}</button>
        {!ro ? <button type="button" className="btn sm" disabled={!!busy || !data.policy.enabled} onClick={() => sweep(false)} title={!data.policy.enabled ? L("Enregistrez d’abord des règles activées", "Save an enabled policy first") : ""}>{busy === "run" ? "…" : L("Lancer maintenant", "Run now")}</button> : null}
      </div>
      {msg ? <div className="banner" style={{ marginTop: 10 }}>{msg}</div> : null}

      {result ? (
        <div className="auto-result">
          <div className="auto-result-head">
            <span className="pill">{result.dry_run ? L("Simulation", "Preview") : L("Passage réel", "Live run")}</span>
            <span>{result.dry_run
              ? L(`${result.planned} client(s) seraient contactés · ${fmt(result.would_spend.amount_minor, result.would_spend.currency)} de crédits`, `${result.planned} customer(s) would be reached · ${fmt(result.would_spend.amount_minor, result.would_spend.currency)} in credits`)
              : L(`${result.reached} client(s) contactés · ${fmt(result.credited.amount_minor, result.credited.currency)} versés`, `${result.reached} customer(s) reached · ${fmt(result.credited.amount_minor, result.credited.currency)} issued`)}
            </span>
            {result.capped_by ? <span className="pill warn">{L("Plafonné : ", "Capped: ")}{L(CAP_REASON[result.capped_by]?.fr ?? result.capped_by, CAP_REASON[result.capped_by]?.en ?? result.capped_by)}</span> : null}
          </div>
          {result.sample_message ? (
            <div className="auto-sample">
              <div className="auto-sample-head"><span>{L("Exemple de message", "Sample message")}</span><span className={`pill ${result.sample_source === "ai" ? "good" : ""}`}>{result.sample_source === "ai" ? L("IA", "AI") : L("Modèle", "Template")}</span></div>
              <p>{result.sample_message}</p>
            </div>
          ) : null}
          {result.dry_run && result.preview.length > 0 ? (
            <ul className="auto-preview">
              {result.preview.slice(0, 8).map((p, i) => (
                <li key={i}><b>{p.display_name}</b> <small className="muted">{p.phone}</small> <span className={`pill seg-${p.segment.toLowerCase()}`}>{L(SEG_LABEL[p.segment]!.fr, SEG_LABEL[p.segment]!.en)}</span> {p.credit ? <em>{fmt(p.credit.amount_minor, p.credit.currency)}</em> : <small className="muted">{L("message seul", "message only")}</small>}</li>
              ))}
              {result.preview.length > 8 ? <li className="muted">+{result.preview.length - 8} {L("autres", "more")}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {data.runs.length > 0 ? (
        <div className="auto-runs">
          <h3>{L("Passages récents", "Recent runs")}</h3>
          <ul>
            {data.runs.slice(0, 6).map((r) => (
              <li key={r.id}>
                <span className={`pill ${r.dry_run ? "" : "good"}`}>{r.dry_run ? L("Simulation", "Preview") : L("Réel", "Live")}</span>
                <span className="muted">{new Date(r.ran_at).toLocaleString()}</span>
                <span>{r.dry_run
                  ? L(`${r.planned} prévus · ${fmt(r.would_spend.amount_minor, r.would_spend.currency)}`, `${r.planned} planned · ${fmt(r.would_spend.amount_minor, r.would_spend.currency)}`)
                  : L(`${r.reached} contactés · ${fmt(r.credited.amount_minor, r.credited.currency)}`, `${r.reached} reached · ${fmt(r.credited.amount_minor, r.credited.currency)}`)}
                </span>
                {r.capped_by ? <span className="pill warn">{L(CAP_REASON[r.capped_by]?.fr ?? r.capped_by, CAP_REASON[r.capped_by]?.en ?? r.capped_by)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Row({ c, L, busy, onSend }: { c: Customer; L: (fr: string, en: string) => string; busy: boolean; onSend: (c: Customer, credit: string) => void }) {
  const [credit, setCredit] = useState("");
  return (
    <tr>
      <td><b>{c.display_name}</b><br /><small className="muted">{c.phone}</small></td>
      <td><span className={`pill seg-${c.segment.toLowerCase()}`}>{L(SEG_LABEL[c.segment]!.fr, SEG_LABEL[c.segment]!.en)}</span></td>
      <td className="num">{c.orders}</td>
      <td className="num">{fmt(c.spend_minor, c.currency)}</td>
      <td className="muted">{L(`${c.days} j`, `${c.days}d`)}</td>
      <td>
        <div className="growth-win">
          <input type="number" min="0" step="0.5" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={L("crédit", "credit")} aria-label={L("Crédit de bienvenue", "Goodwill credit")} />
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => onSend(c, credit)}>{busy ? "…" : L("Envoyer", "Send")}</button>
        </div>
      </td>
    </tr>
  );
}
