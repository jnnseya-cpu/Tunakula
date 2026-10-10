"use client";
/**
 * Payouts & earnings statements. A restaurant owner sees their own group's earnings (the sum of what they are owed
 * on delivered orders — at 0% commission, the full counter price less any merchant-funded promotion) and how much
 * is still outstanding. Finance sees every group plus the rider payout ledger, and can pay a group out — which books
 * a balanced journal (restaurant_payable → psp_clearing) and records the draw-down.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { money } from "../../lib/format";

interface MoneyWire { amount_minor: string; currency: string }
interface MerchantRow { group_id: string; name: string; orders_period: number; earned_period: MoneyWire; earned_lifetime: MoneyWire; paid_lifetime: MoneyWire; outstanding: MoneyWire }
interface RiderPayout { id: string; rider: string; amount: MoneyWire; method: string; at: string }
interface Riders { paid_lifetime: MoneyWire; outstanding: MoneyWire; recent: RiderPayout[] }
interface Payouts { currency: string; from: string; to: string; merchants: MerchantRow[]; riders: Riders | null }

const PERIODS: [number, string, string][] = [[7, "7 j", "7 d"], [30, "30 j", "30 d"], [90, "90 j", "90 d"]];

export default function PayoutsPage() {
  return <Shell title="payouts"><Gate cap="payouts"><Payouts /></Gate></Shell>;
}

function Payouts() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (w: MoneyWire | undefined) => (w ? money(lang, w.amount_minor, w.currency) : "—");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Payouts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    return api<Payouts>(`/v1/admin/payouts?from=${from.toISOString()}&to=${to.toISOString()}`, { country })
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => { setData(null); void load(); }, [country, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const payOut = async (row: MerchantRow) => {
    if (!window.confirm(L(`Décaisser ${m(row.outstanding)} à ${row.name} ?`, `Pay ${m(row.outstanding)} to ${row.name}?`))) return;
    setBusy(row.group_id); setNotice(null);
    try {
      const r = await api<{ paid: MoneyWire }>("/v1/admin/payouts/merchants", { method: "POST", country, body: { restaurant_group_id: row.group_id, method: "MOBILE_MONEY" } });
      setNotice(L(`Payé ${m(r.paid)} à ${row.name}.`, `Paid ${m(r.paid)} to ${row.name}.`));
      await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  };

  if (error) return <div className="card"><p className="muted">{error}</p></div>;
  if (!data) return <div className="card"><p className="muted">{L("Chargement…", "Loading…")}</p></div>;

  const canPay = !!data.riders; // only finance (market-wide ledger access) gets the rider view and the pay action
  const totOutstanding = data.merchants.reduce((s, r) => s + BigInt(r.outstanding.amount_minor), 0n);
  const totEarnedPeriod = data.merchants.reduce((s, r) => s + BigInt(r.earned_period.amount_minor), 0n);

  return (
    <div className="payouts">
      <div className="toolbar">
        <div className="seg" role="group" aria-label={L("Période", "Period")}>
          {PERIODS.map(([d, fr, en]) => <button key={d} type="button" className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{L(fr, en)}</button>)}
        </div>
        <div className="kpis">
          <div className="kpi"><span className="kpi-n num">{m({ amount_minor: totEarnedPeriod.toString(), currency: data.currency })}</span><span className="kpi-l">{L("Gains sur la période", "Earned this period")}</span></div>
          <div className="kpi"><span className="kpi-n num">{m({ amount_minor: totOutstanding.toString(), currency: data.currency })}</span><span className="kpi-l">{L("À décaisser (commerçants)", "Outstanding to merchants")}</span></div>
        </div>
      </div>
      {notice ? <div className="banner" style={{ marginBottom: 12 }}>{notice}</div> : null}

      <section className="card">
        <div className="card-head"><div><h2>{L("Gains des commerçants", "Merchant earnings")}</h2><p>{L("Commission 0 % — le commerçant reçoit le prix affiché, moins ses propres promotions.", "0% commission — the merchant receives the counter price, less their own promotions.")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Groupe", "Group")}</th><th className="num">{L("Commandes", "Orders")}</th><th className="num">{L("Gains (période)", "Earned (period)")}</th><th className="num">{L("Gains (total)", "Earned (lifetime)")}</th><th className="num">{L("Déjà payé", "Paid")}</th><th className="num">{L("À payer", "Outstanding")}</th>{canPay ? <th></th> : null}</tr></thead>
            <tbody>
              {data.merchants.length === 0 ? <tr><td colSpan={canPay ? 7 : 6} className="muted">{L("Aucun gain pour l'instant.", "No earnings yet.")}</td></tr> : data.merchants.map((r) => (
                <tr key={r.group_id}>
                  <td><b>{r.name}</b></td>
                  <td className="num">{r.orders_period}</td>
                  <td className="num">{m(r.earned_period)}</td>
                  <td className="num">{m(r.earned_lifetime)}</td>
                  <td className="num muted">{m(r.paid_lifetime)}</td>
                  <td className="num"><b>{m(r.outstanding)}</b></td>
                  {canPay ? <td className="num">{BigInt(r.outstanding.amount_minor) > 0n ? <button type="button" className="btn primary sm" disabled={busy === r.group_id} onClick={() => payOut(r)}>{busy === r.group_id ? "…" : L("Décaisser", "Pay out")}</button> : <span className="pill good">{L("À jour", "Settled")}</span>}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.riders ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Décaissements livreurs", "Rider payouts")}</h2><p>{L("Les livreurs encaissent eux-mêmes (Fast Pay) ; voici le journal et le solde encore dû.", "Riders cash out themselves (Fast Pay); here is the ledger and what is still owed.")}</p></div>
            <div className="kpis">
              <div className="kpi"><span className="kpi-n num">{m(data.riders.paid_lifetime)}</span><span className="kpi-l">{L("Payé (total)", "Paid (lifetime)")}</span></div>
              <div className="kpi"><span className="kpi-n num">{m(data.riders.outstanding)}</span><span className="kpi-l">{L("Solde dû", "Outstanding")}</span></div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{L("Livreur", "Rider")}</th><th>{L("Méthode", "Method")}</th><th className="num">{L("Montant", "Amount")}</th><th>{L("Date", "When")}</th></tr></thead>
              <tbody>
                {data.riders.recent.length === 0 ? <tr><td colSpan={4} className="muted">{L("Aucun décaissement sur la période.", "No payouts this period.")}</td></tr> : data.riders.recent.map((p) => (
                  <tr key={p.id}><td>{p.rider}</td><td className="muted">{p.method === "MOBILE_MONEY" ? L("Mobile money", "Mobile money") : L("Banque", "Bank")}</td><td className="num">{m(p.amount)}</td><td className="muted">{new Date(p.at).toLocaleDateString(lang === "fr" ? "fr-CD" : "en-GB")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
