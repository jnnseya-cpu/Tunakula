"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, session } from "../../lib/api";

export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState("+243");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/v1/auth/otp/request", { method: "POST", body: { phone: phone.replace(/\s/g, ""), channel: "SMS", locale: "fr" }, country: null });
      setSent(true);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string }>("/v1/auth/otp/verify", { method: "POST", body: { phone: phone.replace(/\s/g, ""), code }, country: null });
      session.setToken(r.token);
      router.replace("/");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="login">
      <div className="box">
        <img src="/brand/tunakula-logo.jpg" alt="Tunakula — Get to eat" width={96} height={96} />
        <h1>Console d&rsquo;administration</h1>
        <p style={{ color: "#4b5675", marginTop: 6 }}>Connectez-vous avec votre numéro de téléphone. Vous ne verrez que ce que votre rôle permet.</p>
        {!sent ? (
          <form onSubmit={request}>
            <label className="sr" htmlFor="phone">Téléphone</label>
            <input id="phone" className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243 81 000 0000" />
            <button className="btn primary" type="submit" disabled={busy}>Recevoir le code</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p style={{ fontSize: 14, color: "#4b5675" }}>Code envoyé au {phone}.</p>
            <label className="sr" htmlFor="code">Code à 6 chiffres</label>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
            <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>Se connecter</button>
            <button className="btn ghost" type="button" style={{ color: "#141b33" }} onClick={() => { setSent(false); setCode(""); }}>Changer de numéro</button>
          </form>
        )}
        {error ? <p role="alert" style={{ color: "#d03b3b", marginTop: 10, fontSize: 14 }}>{error}</p> : null}
      </div>
    </main>
  );
}
