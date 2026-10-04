"use client";
/** Phone sign-in (one-time code by SMS or WhatsApp) and the header account link. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, getSession, live, setSession, type Session } from "../lib/api";

export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setS(getSession());
    read();
    window.addEventListener("tk-session", read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener("tk-session", read); window.removeEventListener("storage", read); };
  }, []);
  return s;
}

export function AccountLink() {
  const s = useSession();
  if (s === undefined) return <span className="acct-link" aria-hidden />;
  return s ? <Link className="acct-link" href="/orders/">My orders</Link> : <Link className="acct-link" href="/signin/">Sign in</Link>;
}

const nextUrl = () => {
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/orders/";
};

export function SignIn() {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+243 ");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP">("SMS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = phone.replace(/[\s.-]/g, "");

  if (!live()) return <div className="app-card"><h1 className="app-title">Sign in</h1><p className="muted">Ordering opens at launch. You will sign in with your phone number — no password.</p></div>;

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/v1/auth/otp/request", { method: "POST", body: { phone: clean, channel, locale: "fr" }, auth: false });
      setStep("code");
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; user_id: string }>("/v1/auth/otp/verify", { method: "POST", body: { phone: clean, code: code.trim(), ...(name.trim() ? { display_name: name.trim() } : {}) }, auth: false });
      setSession({ token: r.token, userId: r.user_id, phone: clean });
      window.location.href = nextUrl();
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <div className="app-card signin">
      <h1 className="app-title">{step === "phone" ? "Sign in with your phone" : "Enter your code"}</h1>
      <p className="muted">{step === "phone" ? "We send a 6-digit code. No password, and the same account works in every country." : `Sent to ${clean} by ${channel === "SMS" ? "SMS" : "WhatsApp"}.`}</p>
      {step === "phone" ? (
        <form onSubmit={request} className="form">
          <label className="field"><span>Phone number</span><input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
          <div className="seg2" role="radiogroup" aria-label="Send the code by">
            {(["SMS", "WHATSAPP"] as const).map((c) => <button type="button" key={c} role="radio" aria-checked={channel === c} className={channel === c ? "on" : ""} onClick={() => setChannel(c)}>{c === "SMS" ? "SMS" : "WhatsApp"}</button>)}
          </div>
          <button className="btn accent wide" disabled={busy || clean.length < 10}>{busy ? "Sending…" : "Send my code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="form">
          <label className="field"><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus className="code-input" /></label>
          <label className="field"><span>Your name <small>(new accounts)</small></span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="So the rider knows who to ask for" /></label>
          <button className="btn accent wide" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="link-btn" onClick={() => { setStep("phone"); setCode(""); }}>Use another number</button>
        </form>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
