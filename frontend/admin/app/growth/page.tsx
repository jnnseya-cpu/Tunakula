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
      const r = await api<{ segment: string; credited: { amount_minor: string; currency: string } | null }>("/v1/ops/growth/win-back", {
        method: "POST", country, body: { customer_id: c.customer_id, ...(minor > 0 ? { credit_minor: String(minor), currency: c.currency } : {}) },
      });
      setNotice(L(`Message envoyé à ${c.display_name}`, `Win-back sent to ${c.display_name}`) + (r.credited ? ` · ${fmt(r.credited.amount_minor, r.credited.currency)}` : ""));
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
