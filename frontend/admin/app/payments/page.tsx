"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { dateTime, money } from "../../lib/format";
import { stateLabel } from "../../lib/i18n";
import { stateTone } from "../../lib/status";

interface Intent { id: string; order_id: string; status: string; method_type: string; amount_minor: string; currency: string; connector_id: string | null; reason_code: string | null; payer_country: string; created_at: string }

export default function PaymentsPage() {
  return <Shell title="payments"><Gate cap="payments"><Payments /></Gate></Shell>;
}

function Payments() {
  const { country, lang } = useConsole();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Intent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  useEffect(() => {
    api<{ data: Intent[] }>(`/v1/admin/payments${status ? `?status=${status}` : ""}`, { country }).then((r) => { setRows(r.data); setError(null); }).catch((e: Error) => setError(e.message));
  }, [country, status]);
  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label={L("Statut", "Status")}>
          {["", "SUCCEEDED", "FAILED", "PENDING_CUSTOMER_ACTION", "PROCESSING"].map((s) => <button key={s || "all"} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? stateLabel(lang, s) : L("Tous", "All")}</button>)}
        </div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Date", "Date")}</th><th>{L("Commande", "Order")}</th><th>{L("Méthode", "Method")}</th><th>{L("Rail", "Rail")}</th><th className="num">{L("Montant", "Amount")}</th><th>{L("Statut", "Status")}</th><th>{L("Motif", "Reason")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="muted">{dateTime(lang, r.created_at)}</td><td className="num">{r.order_id.slice(-8).toUpperCase()}</td><td>{stateLabel(lang, r.method_type)}</td><td>{r.connector_id ?? "—"}</td>
                <td className="num">{money(lang, r.amount_minor, r.currency)}</td><td><span className={`pill ${stateTone(r.status)}`}>{stateLabel(lang, r.status)}</span></td><td className="muted">{r.reason_code ?? ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
