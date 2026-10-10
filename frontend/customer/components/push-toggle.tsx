"use client";
/**
 * "Order updates on your phone" — a toggle that turns on Web Push. It registers the service worker, asks the browser
 * for permission, subscribes with the server's VAPID key and stores the subscription; the comms engine then pushes
 * order updates to the device. Shown only to signed-in customers, and only when push is configured on the server.
 */
import { useEffect, useState } from "react";
import { ApiError, disablePush, enablePush, getSession, pushStatus } from "../lib/api";

export function PushToggle() {
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean; public_key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (getSession()) pushStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  if (!status || !status.configured) return null; // hidden when not signed in or push is not set up on this market
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const toggle = async () => {
    setBusy(true); setError(null);
    try {
      if (status.enabled) { await disablePush(); setStatus({ ...status, enabled: false }); }
      else { await enablePush(status.public_key); setStatus({ ...status, enabled: true }); }
    } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="app-card push-card">
      <div className="push-text">
        <h2 className="app-title" style={{ fontSize: 17 }}>🔔 Order updates on your phone</h2>
        <p className="muted small">Get a notification when the kitchen accepts your order, when your rider sets off, and when it’s at your door.</p>
        {!supported ? <p className="muted small">This browser doesn’t support push notifications.</p> : null}
        {error ? <p className="form-error small">{error}</p> : null}
      </div>
      <button type="button" className={`push-switch ${status.enabled ? "on" : ""}`} role="switch" aria-checked={status.enabled} disabled={busy || !supported} onClick={toggle}>
        <span className="push-knob" />
        <span className="push-label">{busy ? "…" : status.enabled ? "On" : "Off"}</span>
      </button>
    </section>
  );
}
