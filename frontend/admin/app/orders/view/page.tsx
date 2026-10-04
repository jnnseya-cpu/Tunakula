"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../../components/shell";
import { api, type Money } from "../../../lib/api";
import { dateTime, money } from "../../../lib/format";
import { stateLabel } from "../../../lib/i18n";
import { stateTone } from "../../../lib/status";

interface OrderView { order_id: string; state: string; type: string; branch_id: string; total: Money; payment_mode: string; rider_id: string | null; lines: { name: string; quantity: number; allergens: string[] }[]; flagged_for_review: boolean; version: number }
interface Evidence {
  orderId: string; finalState: string;
  timeline: { at: string; to: string; actor: string; reasonCode?: string }[];
  pack?: { confirmedLineIds: string[]; packageCount: number; allergenAcknowledged?: boolean };
  ready?: { labelIds: string[]; sealIds: string[]; packPhotoRef?: string };
  pickup?: { at: string; riderId: string; scannedLabelIds: string[]; packageCount: number };
  drop?: { at: string; scannedLabelIds?: string[]; distanceM?: number; verificationMethod: string; proofPhotoRef?: string };
  exceptions: { gate: string; code: string; reason?: string }[];
}

export default function OrderPage() {
  return <Shell title="orders"><Gate cap="orders"><Suspense><OrderDetail /></Suspense></Gate></Shell>;
}

function OrderDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { country, lang } = useConsole();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("CUSTOMER_REQUEST");
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => {
    Promise.all([api<OrderView>(`/v1/orders/${id}`, { country }), api<Evidence>(`/v1/orders/${id}/evidence`, { country })])
      .then(([o, e]) => { setOrder(o); setEv(e); setError(null); })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [id, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    try {
      await api(`/v1/orders/${id}/transitions`, { method: "POST", body: { command: { type: "CANCEL", reasonCode: reason } }, country });
      setNotice(L("Commande annulée.", "Order cancelled.")); load();
    } catch (e) { setNotice((e as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!order || !ev) return <div className="muted">…</div>;
  return (
    <>
      <p><Link className="link-btn" href="/orders/">← {L("Commandes", "Orders")}</Link></p>
      <div className="grid g2">
        <section className="card">
          <div className="card-head"><div><h2>{L("Commande", "Order")} {order.order_id.slice(-8).toUpperCase()}</h2><p>{order.order_id}</p></div><span className={`pill ${stateTone(order.state)}`}>{stateLabel(lang, order.state)}</span></div>
          <dl className="kv">
            <dt>{L("Type", "Type")}</dt><dd>{stateLabel(lang, order.type)}</dd>
            <dt>{L("Paiement", "Payment")}</dt><dd>{stateLabel(lang, order.payment_mode)}</dd>
            <dt>{L("Total", "Total")}</dt><dd className="num">{money(lang, order.total.amount_minor, order.total.currency)}</dd>
            <dt>{L("Livreur", "Rider")}</dt><dd>{order.rider_id ? order.rider_id.slice(-8) : "—"}</dd>
            <dt>{L("Articles", "Items")}</dt><dd>{order.lines.map((l) => `${l.quantity} × ${l.name}${l.allergens.length ? ` (${l.allergens.join(", ")})` : ""}`).join(" · ")}</dd>
          </dl>
          {notice ? <div className="banner" style={{ marginTop: 12 }}>{notice}</div> : null}
          {["PLACED"].includes(order.state) ? (
            <div className="filters" style={{ marginTop: 14 }}>
              <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={L("Motif", "Reason")}>
                <option value="CUSTOMER_REQUEST">{L("Demande du client", "Customer request")}</option>
                <option value="KITCHEN_CLOSED">{L("Cuisine fermée", "Kitchen closed")}</option>
                <option value="SUSPECTED_FRAUD">{L("Fraude suspectée", "Suspected fraud")}</option>
              </select>
              <button className="btn danger" type="button" onClick={cancel}>{L("Annuler la commande", "Cancel order")}</button>
            </div>
          ) : null}
        </section>
        <section className="card">
          <div className="card-head"><div><h2>{L("Chaîne de garde", "Chain of custody")}</h2><p>{L("Preuves enregistrées à chaque remise", "Evidence recorded at each handover")}</p></div></div>
          <dl className="kv">
            <dt>{L("Emballage", "Packing")}</dt><dd>{ev.pack ? `${ev.pack.packageCount} ${L("sac(s)", "bag(s)")} · ${ev.pack.confirmedLineIds.length} ${L("lignes vérifiées", "lines checked")}${ev.pack.allergenAcknowledged ? ` · ${L("allergènes confirmés", "allergens acknowledged")}` : ""}` : "—"}</dd>
            <dt>{L("Étiquettes et scellés", "Labels and seals")}</dt><dd>{ev.ready ? `${ev.ready.labelIds.join(", ")} · ${ev.ready.sealIds.join(", ") || L("sans scellé", "no seal")}` : "—"}</dd>
            <dt>{L("Retrait", "Pickup")}</dt><dd>{ev.pickup ? `${dateTime(lang, ev.pickup.at)} · ${L("scanné", "scanned")} ${ev.pickup.scannedLabelIds.join(", ")}` : "—"}</dd>
            <dt>{L("Remise", "Handover")}</dt><dd>{ev.drop ? `${dateTime(lang, ev.drop.at)} · ${ev.drop.verificationMethod === "CODE" ? L("code du destinataire vérifié", "recipient code verified") : ev.drop.verificationMethod}${ev.drop.distanceM !== undefined ? ` · ${ev.drop.distanceM} m` : ""}` : "—"}</dd>
            <dt>{L("Exceptions", "Exceptions")}</dt><dd>{ev.exceptions.length ? ev.exceptions.map((x) => `${x.gate}: ${x.code}${x.reason ? ` (${x.reason})` : ""}`).join(" · ") : L("Aucune", "None")}</dd>
          </dl>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><div><h2>{L("Chronologie", "Timeline")}</h2></div></div>
        <ol className="timeline">
          {ev.timeline.map((s, i) => (
            <li key={i}><span className="dot" aria-hidden /><span>{stateLabel(lang, s.to)}{s.reasonCode ? <span className="muted"> · {s.reasonCode}</span> : null}<span className="muted"> · {s.actor.split(":")[0]}</span></span><span className="muted num">{dateTime(lang, s.at)}</span></li>
          ))}
        </ol>
      </section>
    </>
  );
}
