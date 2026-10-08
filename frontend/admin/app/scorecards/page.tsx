"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface Scorecard {
  branch_id: string; name: string; orders: number; delivered: number; cancelled: number; rejected: number; failed: number;
  acceptance_rate: number | null; fulfilment_rate: number | null; cancellation_rate: number | null;
  avg_prep_minutes: number | null; gmv: Money; score: number | null;
}

export default function ScorecardsPage() {
  return <Shell title="scorecards"><Gate cap="overview"><Scorecards /></Gate></Shell>;
}

const scoreClass = (s: number | null) => (s === null ? "" : s >= 85 ? "good" : s >= 65 ? "ok" : "bad");
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function Scorecards() {
  const { country, lang } = useConsole();
  const [days, setDays] = useState(30);
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  useEffect(() => {
    api<{ scorecards: Scorecard[] }>(`/v1/admin/scorecards?days=${days}`, { country })
      .then((r) => { setCards(r.scorecards); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [country, days]);

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Note de performance par restaurant : acceptation, satisfaction, vitesse de préparation — comme Uber Top Eats / Just Eat Performance Score. Plus la note est haute, mieux c'est.", "A per-restaurant performance score: acceptance, fulfilment and prep speed — like Uber Top Eats / Just Eat Performance Score. Higher is better.")}</div>
      <section className="card">
        <div className="card-head">
          <div><h2>{L("Performance des restaurants", "Restaurant performance")} · {country}</h2><p>{L("Derniers", "Last")} {days} {L("jours", "days")}</p></div>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>{d} {L("jours", "days")}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>{L("Restaurant", "Restaurant")}</th><th className="num">{L("Note", "Score")}</th>
              <th className="num">{L("Commandes", "Orders")}</th><th className="num">{L("Livrées", "Delivered")}</th>
              <th className="num">{L("Acceptation", "Acceptance")}</th><th className="num">{L("Satisfaction", "Fulfilment")}</th>
              <th className="num">{L("Annulation", "Cancellation")}</th><th className="num">{L("Préparation", "Prep")}</th><th className="num">GMV</th>
            </tr></thead>
            <tbody>
              {cards === null ? <tr><td colSpan={9} className="muted">…</td></tr> : cards.map((c) => (
                <tr key={c.branch_id}>
                  <td><b>{c.name}</b></td>
                  <td className="num"><span className={`score ${scoreClass(c.score)}`}>{c.score ?? "—"}</span></td>
                  <td className="num">{c.orders}</td>
                  <td className="num">{c.delivered}</td>
                  <td className="num">{pct(c.acceptance_rate)}</td>
                  <td className="num">{pct(c.fulfilment_rate)}</td>
                  <td className="num">{pct(c.cancellation_rate)}</td>
                  <td className="num">{c.avg_prep_minutes === null ? "—" : `${c.avg_prep_minutes} min`}</td>
                  <td className="num">{money(lang, c.gmv.amount_minor, c.gmv.currency)}</td>
                </tr>
              ))}
              {cards && cards.length === 0 ? <tr><td colSpan={9} className="muted">{L("Aucune donnée", "No data")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
