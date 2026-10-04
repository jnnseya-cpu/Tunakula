"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { dateTime, money } from "../../lib/format";

interface Ledger {
  balances: { account: string; currency: string; balance_minor: string }[];
  journals: { id: string; description: string; posted_at: string; entries: { account: string; currency: string; amount_minor: string }[] }[];
}

export default function FinancePage() {
  return <Shell title="finance"><Gate cap="finance"><Finance /></Gate></Shell>;
}

function Finance() {
  const { country, lang } = useConsole();
  const [data, setData] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  useEffect(() => { api<Ledger>("/v1/admin/ledger", { country }).then(setData).catch((e: Error) => setError(e.message)); }, [country]);
  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">…</div>;

  // Per currency, debits and credits must cancel: shown as the books' own proof.
  const byCcy = new Map<string, bigint>();
  for (const b of data.balances) byCcy.set(b.currency, (byCcy.get(b.currency) ?? 0n) + BigInt(b.balance_minor));
  const balanced = [...byCcy.values()].every((v) => v === 0n);
  return (
    <>
      <div className={`banner ${balanced ? "ok" : "error"}`}>{balanced ? L("✓ Les comptes sont équilibrés dans chaque devise.", "✓ The books balance in every currency.") : L("✕ Déséquilibre détecté — contactez la finance groupe.", "✕ Imbalance detected — escalate to group finance.")}</div>
      <section className="card">
        <div className="card-head"><div><h2>{L("Soldes par compte", "Balances by account")}</h2><p>{L("Débit positif, crédit négatif", "Debit positive, credit negative")}</p></div></div>
        <table className="data"><thead><tr><th>{L("Compte", "Account")}</th><th>{L("Devise", "Currency")}</th><th className="num">{L("Solde", "Balance")}</th></tr></thead>
          <tbody>{data.balances.map((b) => <tr key={`${b.account}-${b.currency}`}><td><code>{b.account}</code></td><td>{b.currency}</td><td className="num">{money(lang, b.balance_minor, b.currency)}</td></tr>)}</tbody></table>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>{L("Écritures récentes", "Recent journals")}</h2><p>{L("Chaque écriture est équilibrée ; une correction est une nouvelle écriture, jamais une modification.", "Every journal balances; a correction is a new journal, never an edit.")}</p></div></div>
        <div className="table-wrap">
          <table className="data"><thead><tr><th>{L("Date", "Date")}</th><th>{L("Libellé", "Description")}</th><th>{L("Lignes", "Lines")}</th></tr></thead>
            <tbody>{data.journals.map((j) => <tr key={j.id}><td className="muted">{dateTime(lang, j.posted_at)}</td><td>{j.description.replace(/^Order ([0-9a-f-]{36}) settlement$/, (_, id: string) => L(`Règlement de la commande ${id.slice(-8).toUpperCase()}`, `Settlement of order ${id.slice(-8).toUpperCase()}`))}</td>
              <td>{j.entries.map((e) => <div key={e.account} className="num" style={{ fontSize: 12.5 }}><code>{e.account}</code> {money(lang, e.amount_minor, e.currency)}</div>)}</td></tr>)}</tbody></table>
        </div>
      </section>
    </>
  );
}
