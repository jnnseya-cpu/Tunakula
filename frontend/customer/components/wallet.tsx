"use client";
/**
 * The in-app wallet (/wallet): the balance, a top-up form (mobile money / card), and the movement history.
 * Paying for an order from the wallet is offered at checkout.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession, money, walletBalance, walletHistory, walletTopup, type MoneyWire, type WalletTxn } from "../lib/api";
import { ReferralInvite, ReferralClaimCard } from "./referral";

const KIND_LABEL: Record<WalletTxn["kind"], string> = { TOPUP: "Top-up", ORDER_PAYMENT: "Order", REFUND: "Refund", ADJUSTMENT: "Adjustment" };
const TOPUP_AMOUNTS = ["5.00", "10.00", "20.00", "50.00"];

export function Wallet() {
  const [balances, setBalances] = useState<MoneyWire[] | null>(null);
  const [txns, setTxns] = useState<WalletTxn[]>([]);
  const [amount, setAmount] = useState("10.00");
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([walletBalance(), walletHistory()])
    .then(([b, t]) => { setBalances(b); setTxns(t); })
    .catch((e) => setError((e as { message?: string }).message ?? "Could not load your wallet."));
  useEffect(() => { if (!getSession()) { setError("Sign in to use your wallet."); return; } load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const topup = async () => {
    const minor = String(Math.round(Number(amount) * 100));
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError("Enter an amount."); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await walletTopup(minor, "USD", "MOBILE_MONEY_PUSH", msisdn.replace(/\s/g, "") || undefined);
      if (r.status === "SUCCEEDED") { setNotice("Wallet topped up ✓"); await load(); }
      else if (r.status === "PENDING") setNotice("Approve the payment on your phone — your balance updates once it clears.");
      else setError(`The top-up did not go through${r.reason_code ? ` (${r.reason_code.replace(/_/g, " ").toLowerCase()})` : ""}.`);
    } catch (e) { setError((e as { message?: string }).message ?? "The top-up failed."); } finally { setBusy(false); }
  };

  if (error && !balances) return <div className="app-wrap"><h1>Your wallet</h1><p className="book-error">{error}</p><Link className="btn accent" href="/signin/">Sign in</Link></div>;

  const usd = balances?.find((b) => b.currency === "USD") ?? { amount_minor: "0", currency: "USD" };
  return (
    <div className="app-wrap wallet">
      <h1>Your wallet</h1>
      <div className="wallet-balance">
        <span className="muted">Balance</span>
        <b className="wallet-amount">{money(usd)}</b>
        {(balances ?? []).filter((b) => b.currency !== "USD").map((b) => <span key={b.currency} className="wallet-other">{money(b)}</span>)}
      </div>

      <section className="app-card">
        <h2>Top up</h2>
        <div className="topup-amounts" role="radiogroup" aria-label="Top-up amount">
          {TOPUP_AMOUNTS.map((a) => <button type="button" key={a} role="radio" aria-checked={amount === a} className={amount === a ? "on" : ""} onClick={() => setAmount(a)}>${a}</button>)}
        </div>
        <label className="field"><span>Or enter an amount (USD)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Mobile money number</span><input inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+243…" /></label>
        {notice ? <p className="book-ok">{notice}</p> : null}
        {error ? <p className="book-error">{error}</p> : null}
        <button type="button" className="btn accent wide" disabled={busy} onClick={topup}>{busy ? "Topping up…" : `Top up $${amount}`}</button>
      </section>

      <ReferralClaimCard />
      <ReferralInvite />

      <section className="app-card">
        <h2>Recent activity</h2>
        {txns.length === 0 ? <p className="muted">No activity yet.</p> : (
          <ul className="wallet-txns">
            {txns.map((t) => {
              const credit = !t.amount.amount_minor.startsWith("-");
              return (
                <li key={t.id}>
                  <span className="wt-main"><b>{KIND_LABEL[t.kind]}</b><small>{new Date(t.created_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
                  <b className={`num ${credit ? "credit" : "debit"}`}>{credit ? "+" : ""}{money(t.amount)}</b>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
