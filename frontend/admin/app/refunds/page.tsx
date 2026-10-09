"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface RefundRequest {
  id: string; order_id: string; reason_code: string; comment: string | null; status: string;
  amount: Money; customer: string; created_at: string;
}
const REASON: Record<string, [string, string]> = {
  ITEM_MISSING: ["Article manquant", "Item missing"], WRONG_ORDER: ["Mauvaise commande", "Wrong order"],
  FOOD_QUALITY: ["Qualité", "Food quality"], DAMAGED: ["Endommagé", "Damaged"], LATE: ["En retard", "Late"],
  NEVER_ARRIVED: ["Jamais arrivée", "Never arrived"], OTHER: ["Autre", "Other"],
};

export default function RefundsPage() {
  return <Shell title="refunds"><Gate cap="refunds"><Refunds /></Gate></Shell>;
}

function Refunds() {
  const { country, lang } = useConsole();
  const [rows, setRows] = useState<RefundRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<{ requests: RefundRequest[] }>("/v1/admin/refunds", { country }).then((r) => { setRows(r.requests); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (id: string, approve: boolean) => {
    setBusy(id); setError(null);
    try { await api(`/v1/admin/refunds/${id}/decision`, { method: "POST", country, body: { approve, ...(note[id]?.trim() ? { note: note[id]!.trim() } : {}) } }); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Demandes de remboursement", "Refund requests")}</h2><p>{L("Les clients demandent un remboursement après livraison. Approuver rembourse via le même moyen de paiement et annule le règlement.", "Customers request a refund after delivery. Approving refunds through the same payment method and reverses the settlement.")}</p></div></div>
      {error ? <div className="banner" style={{ marginBottom: 10 }}>{error}</div> : null}
      {rows === null ? <p className="muted">{L("Chargement…", "Loading…")}</p> : !rows.length ? <p className="muted">{L("Aucune demande en attente. 🎉", "No pending requests. 🎉")}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{L("Quand", "When")}</th><th>{L("Client", "Customer")}</th><th>{L("Motif", "Reason")}</th><th className="num">{L("Montant", "Amount")}</th><th>{L("Note interne", "Internal note")}</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{r.customer}<br /><a className="muted" href={`/orders/view/?id=${r.order_id}`}>#{r.order_id.slice(-5).toUpperCase()}</a></td>
                  <td>{(REASON[r.reason_code] ?? [r.reason_code, r.reason_code])[lang === "fr" ? 0 : 1]}{r.comment ? <><br /><span className="muted">“{r.comment}”</span></> : null}</td>
                  <td className="num">{money(lang, r.amount.amount_minor, r.amount.currency)}</td>
                  <td><input className="input" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder={L("Optionnel", "Optional")} style={{ minWidth: 140 }} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn primary" type="button" disabled={busy === r.id} onClick={() => decide(r.id, true)} style={{ marginRight: 6 }}>{L("Rembourser", "Refund")}</button>
                    <button className="btn danger" type="button" disabled={busy === r.id} onClick={() => decide(r.id, false)}>{L("Refuser", "Decline")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
