"use client";
/**
 * Loyalty points (shown on /wallet): the points balance, what they are worth, and a one-tap redeem
 * that turns points into wallet credit. Points are earned automatically once an order is delivered.
 */
import { useEffect, useState } from "react";
import { getSession, money, myLoyalty, redeemLoyalty, type LoyaltySummary } from "../lib/api";

export function LoyaltyCard({ onRedeemed }: { onRedeemed?: () => void }) {
  const [s, setS] = useState<LoyaltySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => myLoyalty().then(setS).catch(() => undefined);
  useEffect(() => { if (getSession()) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !s.enabled) return null;

  const canRedeem = s.points >= s.min_redeem_points;
  const redeem = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await redeemLoyalty(s.points);
      setNotice(r.credited ? `${money(r.credited)} added to your wallet ✓` : "Redeemed ✓");
      await load();
      onRedeemed?.();
    } catch (e) { setError((e as { message?: string }).message ?? "Could not redeem your points."); } finally { setBusy(false); }
  };

  return (
    <section className="app-card loyalty-card">
      <h2>Loyalty points</h2>
      <div className="loyalty-balance">
        <b className="loyalty-points">{s.points.toLocaleString("fr-FR")}</b>
        <span className="muted">points · worth {money(s.worth)}</span>
      </div>
      <p className="muted small">You earn points on every delivered order — {(s.earn_bps / 100).toFixed(s.earn_bps % 100 ? 2 : 0)} point{s.earn_bps === 100 ? "" : "s"} per {money(s.point_value)} spent. Redeem from {s.min_redeem_points.toLocaleString("fr-FR")} points for wallet credit.</p>
      {notice ? <p className="book-ok">{notice}</p> : null}
      {error ? <p className="book-error">{error}</p> : null}
      <button type="button" className="btn accent wide" disabled={busy || !canRedeem} onClick={redeem}>
        {busy ? "Redeeming…" : canRedeem ? `Redeem ${s.points.toLocaleString("fr-FR")} points → ${money(s.worth)}` : `${(s.min_redeem_points - s.points).toLocaleString("fr-FR")} more points to redeem`}
      </button>
    </section>
  );
}
