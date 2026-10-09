"use client";
/**
 * Referrals: share your code and earn, or apply a friend's code as a new customer.
 * The reward unlocks once the referred person has spent the threshold on the platform.
 */
import { useEffect, useState } from "react";
import { claimReferral, getSession, money, myReferral, myReferralClaim, type MoneyWire, type ReferralClaim, type ReferralSummary } from "../lib/api";

const minor = (m: MoneyWire) => BigInt(m.amount_minor);

/** The signed-in customer's own code, share action, and how many invites have paid off. */
export function ReferralInvite() {
  const [r, setR] = useState<ReferralSummary | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (getSession()) myReferral().then(setR).catch(() => undefined); }, []);
  if (!r) return null;

  const link = typeof window !== "undefined" ? `${window.location.origin}/order/?ref=${r.code}` : "";
  const share = async () => {
    const text = `Join me on Tunakula — use my code ${r.code} and get ${money(r.reward)} after your first ${money(r.spend_threshold)} of orders.`;
    try {
      if (navigator.share) { await navigator.share({ title: "Tunakula", text, url: link }); return; }
    } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(`${text} ${link}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  };

  return (
    <section className="app-card referral-invite">
      <h2>Invite friends, earn {money(r.reward)}</h2>
      <p className="muted">Share your code. When a friend joins and spends {money(r.spend_threshold)}, you both get {money(r.reward)} in your wallet.</p>
      <div className="referral-code">
        <code>{r.code}</code>
        <button type="button" className="btn accent" onClick={share}>{copied ? "Copied ✓" : "Share"}</button>
      </div>
      <p className="muted small">{r.invited} invited · {r.rewarded} rewarded · {money(r.earned)} earned</p>
    </section>
  );
}

/** For a new customer: apply a code, then track progress toward the reward. */
export function ReferralClaimCard() {
  const [claim, setClaim] = useState<ReferralClaim | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => myReferralClaim().then((c) => { setClaim(c); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { if (getSession()) { setCode(new URLSearchParams(window.location.search).get("ref")?.toUpperCase() ?? ""); load(); } else setLoaded(true); }, []);

  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { await claimReferral(code.trim().toUpperCase()); await load(); }
    catch (e) { setError((e as { message?: string }).message ?? "Could not apply the code."); } finally { setBusy(false); }
  };

  if (!loaded) return null;
  if (claim) {
    const pct = Math.min(100, Math.round(Number(minor(claim.spent) * 100n / (minor(claim.spend_threshold) || 1n))));
    const unlocked = claim.status === "UNLOCKED";
    return (
      <section className="app-card referral-claim">
        <h2>{unlocked ? `You earned ${money(claim.reward)} 🎉` : `Spend ${money(claim.spend_threshold)} to unlock ${money(claim.reward)}`}</h2>
        {unlocked ? <p className="muted">Your reward is in your wallet, ready to spend.</p> : (
          <>
            <div className="referral-bar"><span style={{ width: `${pct}%` }} /></div>
            <p className="muted small">{money(claim.spent)} of {money(claim.spend_threshold)} spent</p>
          </>
        )}
      </section>
    );
  }
  // No claim yet: offer to apply a code.
  return (
    <section className="app-card referral-claim">
      <h2>Have a referral code?</h2>
      <p className="muted">New here? Enter a friend's code to earn a reward after your first orders.</p>
      <div className="referral-apply">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={12} />
        <button type="button" className="btn" disabled={busy || !code.trim()} onClick={apply}>{busy ? "Applying…" : "Apply"}</button>
      </div>
      {error ? <p className="book-error">{error}</p> : null}
    </section>
  );
}
