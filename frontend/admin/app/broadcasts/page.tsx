"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

type Audience = "all" | "customer" | "rider" | "restaurant";
const CHANNELS = [
  { id: "inapp", fr: "In-app", en: "In-app" },
  { id: "push", fr: "Push", en: "Push" },
  { id: "sms", fr: "SMS", en: "SMS" },
  { id: "whatsapp", fr: "WhatsApp", en: "WhatsApp" },
  { id: "email", fr: "E-mail", en: "Email" },
] as const;
const SEGMENTS = ["ACTIVE", "AT_RISK", "LAPSED", "DORMANT", "NEW"] as const;

export default function BroadcastsPage() {
  return <Shell title="broadcasts"><Gate cap="markets"><Broadcasts /></Gate></Shell>;
}

function Broadcasts() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [audience, setAudience] = useState<Audience>("customer");
  const [segment, setSegment] = useState("");
  const [channels, setChannels] = useState<string[]>(["inapp", "push"]);
  const [message, setMessage] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ recipients: number; sent: number; logged: number; suppressed: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setChannels((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));

  // Live recipient count as the audience/segment changes.
  useEffect(() => {
    setCount(null);
    const q = `audience=${audience}${audience === "customer" && segment ? `&segment=${segment}` : ""}`;
    api<{ count: number }>(`/v1/admin/broadcasts/preview?${q}`, { country }).then((r) => setCount(r.count)).catch(() => setCount(null));
  }, [audience, segment, country]);

  const send = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const body = { audience, ...(audience === "customer" && segment ? { segment } : {}), channels, message: message.trim() };
      setResult(await api("/v1/admin/broadcasts", { method: "POST", country, body }));
      setMessage("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const audienceLabel = (a: Audience) => ({ all: L("Tout le monde", "Everyone"), customer: L("Clients", "Customers"), rider: L("Livreurs", "Riders"), restaurant: L("Marchands", "Merchants") }[a]);
  const canSend = message.trim().length > 0 && channels.length > 0 && !busy;

  return (
    <>
      <div className="scope-note">{L("Envoyez une offre ou un message à toute une audience en un clic, sur les canaux de votre choix. Les désinscriptions sont respectées.", "Send an offer or message to a whole audience in one click, over the channels you choose. Opt-outs are honoured.")}</div>

      <section className="card">
        <div className="card-head"><div><h2>{L("Nouvelle diffusion", "New broadcast")} · {country}</h2><p>{count !== null ? L(`≈ ${count} destinataires`, `≈ ${count} recipients`) : "…"}</p></div></div>

        <div className="form-grid">
          <label>{L("Audience", "Audience")}
            <select className="select" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="all">{audienceLabel("all")}</option>
              <option value="customer">{audienceLabel("customer")}</option>
              <option value="rider">{audienceLabel("rider")}</option>
              <option value="restaurant">{audienceLabel("restaurant")}</option>
            </select>
          </label>
          {audience === "customer" ? (
            <label>{L("Segment (optionnel)", "Segment (optional)")}
              <select className="select" value={segment} onChange={(e) => setSegment(e.target.value)}>
                <option value="">{L("Tous les clients", "All customers")}</option>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
          <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{L("Canaux", "Channels")}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {CHANNELS.map((c) => (
              <label key={c.id} className={`chip-toggle ${channels.includes(c.id) ? "on" : ""}`} style={{ cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={channels.includes(c.id)} onChange={() => toggle(c.id)} style={{ marginRight: 6 }} />{L(c.fr, c.en)}
              </label>
            ))}
          </div>
        </fieldset>

        <label style={{ display: "block", marginTop: 12 }}>{L("Message", "Message")}
          <textarea className="input" rows={3} maxLength={480} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={L("🎉 -20% ce week-end avec le code WEEKEND20", "🎉 20% off this weekend with code WEEKEND20")} />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>{message.length}/480</p>

        {error ? <div className="banner error">{error}</div> : null}
        {result ? <div className="banner">{L(`Envoyé à ${result.recipients} destinataires — ${result.sent + result.logged} livrés, ${result.suppressed} désinscrits.`, `Sent to ${result.recipients} recipients — ${result.sent + result.logged} delivered, ${result.suppressed} opted out.`)}</div> : null}

        <div className="card-foot">
          <button className="btn primary" type="button" disabled={!canSend} onClick={send}>
            {busy ? L("Envoi…", "Sending…") : L(`Envoyer à ${count ?? "…"} ${audienceLabel(audience).toLowerCase()}`, `Send to ${count ?? "…"} ${audienceLabel(audience).toLowerCase()}`)}
          </button>
        </div>
      </section>
    </>
  );
}
