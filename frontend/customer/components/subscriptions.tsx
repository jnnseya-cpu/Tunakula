"use client";
/**
 * Repeat orders (/subscriptions): the customer's recurring orders — "my usual, every Monday at noon". Each
 * runs automatically and is paid from the wallet; a short balance skips that run (no surprise charge) and the
 * next is still scheduled. From here the customer can pause, resume or cancel. Created from the checkout screen.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession, mySubscriptions, setSubscriptionStatus, type Subscription } from "../lib/api";

export function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => mySubscriptions().then(setSubs).catch((e) => setError((e as { message?: string }).message ?? "Could not load your repeat orders."));
  useEffect(() => { if (!getSession()) { setError("Sign in to see your repeat orders."); return; } load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, action: "PAUSE" | "RESUME" | "CANCEL") => {
    if (action === "CANCEL" && !window.confirm("Cancel this repeat order? It won’t be placed again.")) return;
    setBusy(id);
    try { await setSubscriptionStatus(id, action); await load(); } catch (e) { setError((e as { message?: string }).message ?? "That didn’t work."); } finally { setBusy(null); }
  };

  if (error) return <div className="app-card"><h1 className="app-title">Repeat orders</h1><p className="muted">{error}</p><Link className="btn accent" href="/order/">See restaurants</Link></div>;
  if (!subs) return <div className="skeleton-line" />;

  return (
    <div className="subs">
      <h1 className="app-title">Repeat orders</h1>
      <p className="muted">Your usual, delivered automatically and paid from your wallet. Pause or cancel any time.</p>
      {subs.length === 0 ? (
        <div className="app-card">
          <p className="muted">You don’t have any repeat orders yet. Build a basket, then tick <b>Make it a repeat order</b> at checkout.</p>
          <Link className="btn accent" href="/order/">See restaurants</Link>
        </div>
      ) : (
        <ul className="sub-list">
          {subs.map((s) => (
            <li key={s.id} className={`sub-card ${s.status === "PAUSED" ? "paused" : ""}`}>
              <div className="sub-head">
                <div>
                  <b className="sub-label">{s.label}</b>
                  <small className="muted">{s.items.reduce((n, i) => n + i.quantity, 0)} item(s) · wallet</small>
                </div>
                <span className={`sub-badge ${s.status.toLowerCase()}`}>{s.status === "ACTIVE" ? "Active" : "Paused"}</span>
              </div>
              <p className="sub-next muted small">{s.status === "ACTIVE" ? `Next delivery ${s.next_run_local}` : "Paused — won’t run until you resume"}</p>
              <div className="sub-actions">
                {s.status === "ACTIVE"
                  ? <button type="button" className="btn light" disabled={busy === s.id} onClick={() => act(s.id, "PAUSE")}>Pause</button>
                  : <button type="button" className="btn light" disabled={busy === s.id} onClick={() => act(s.id, "RESUME")}>Resume</button>}
                <button type="button" className="btn ghost" disabled={busy === s.id} onClick={() => act(s.id, "CANCEL")}>Cancel</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
