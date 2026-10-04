"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type OrderRow } from "../../lib/api";
import { dateTime, money } from "../../lib/format";
import { stateLabel } from "../../lib/i18n";
import { stateTone } from "../../lib/status";

const GROUPS = ["all", "open", "awaiting_payment", "delivered", "lost", "refunded"] as const;
const GROUP_LABEL: Record<(typeof GROUPS)[number], [string, string]> = {
  all: ["Toutes", "All"], open: ["En cours", "Open"], awaiting_payment: ["Paiement en attente", "Awaiting payment"],
  delivered: ["Livrées", "Delivered"], lost: ["Perdues", "Lost"], refunded: ["Remboursées", "Refunded"],
};
export default function OrdersPage() {
  return <Shell title="orders"><Gate cap="orders"><Orders /></Gate></Shell>;
}

function Orders() {
  const { country, lang } = useConsole();
  const router = useRouter();
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("all");
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = (before?: string) => {
    const qs = new URLSearchParams({ limit: "50", ...(group !== "all" ? { group } : {}), ...(before ? { before } : {}) });
    api<{ data: OrderRow[]; next: string | null }>(`/v1/admin/orders?${qs}`, { country })
      .then((r) => { setRows((old) => (before ? [...old, ...r.data] : r.data)); setNext(r.next); setError(null); })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => { load(); }, [group, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = rows.filter((r) => !q || `${r.order_id} ${r.branch_name} ${r.customer_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label={L("Statut", "Status")}>
          {GROUPS.map((g) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g][lang === "fr" ? 0 : 1]}</button>)}
        </div>
        <input className="input" placeholder={L("Rechercher : numéro, commerce, client", "Search: id, merchant, customer")} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>{L("Commande", "Order")}</th><th>{L("Date", "Date")}</th><th>{L("Client", "Customer")}</th><th>{L("Commerce", "Merchant")}</th>
              <th>{L("Type", "Type")}</th><th>{L("Paiement", "Payment")}</th><th className="num">{L("Total", "Total")}</th><th>{L("Statut", "Status")}</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.order_id} className="clickable" onClick={() => router.push(`/orders/view/?id=${r.order_id}`)}>
                  <td className="num">{r.order_id.slice(-8).toUpperCase()}</td>
                  <td>{dateTime(lang, r.created_at)}</td>
                  <td>{r.customer_name ?? "—"}</td>
                  <td>{r.branch_name}</td>
                  <td>{stateLabel(lang, r.type)}</td>
                  <td>{stateLabel(lang, r.payment_mode)}</td>
                  <td className="num">{money(lang, r.total_minor, r.currency)}</td>
                  <td><span className={`pill ${stateTone(r.state)}`}>{stateLabel(lang, r.state)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length ? <p className="muted" style={{ padding: 12 }}>{L("Aucune commande.", "No orders.")}</p> : null}
        {next ? <div style={{ paddingTop: 12 }}><button className="btn ghost" type="button" onClick={() => load(next)}>{L("Plus de commandes", "More orders")}</button></div> : null}
      </section>
    </>
  );
}
