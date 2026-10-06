"use client";
/**
 * Communication Event Architecture.
 *
 * One event engine — every message the platform sends — rendered from the shared catalogue
 * (@tunakula/ts-contracts/comms), the same source the backend dispatches against. Operators see
 * what fires on which channel, which notices bypass opt-outs, preview the branded email for any
 * event and fire a test to themselves (recorded in sandbox until a provider key is set).
 */
import { useMemo, useState } from "react";
import {
  COMMS_CATALOGUE, COMMS_CHANNELS, COMMS_AUDIENCES, commsSummary,
  type CommsChannel, type CommsEvent, type CommsSeverity,
} from "@tunakula/ts-contracts/comms";
import { Gate, Shell, useConsole } from "../../components/shell";

const CHANNEL_LABEL: Record<CommsChannel, string> = { email: "Email", inapp: "In-app", sms: "SMS", push: "Push", whatsapp: "WhatsApp" };
const AUD_LABEL: Record<string, [string, string]> = {
  customer: ["Client", "Customer"], restaurant: ["Restaurant", "Restaurant"], rider: ["Livreur", "Rider"], admin: ["Console", "Console"],
};
const SEV_LABEL: Record<CommsSeverity, [string, string]> = {
  info: ["Info", "Info"], success: ["Succès", "Success"], warning: ["Alerte", "Warning"], critical: ["Critique", "Critical"],
};

export default function CommsPage() {
  return <Shell title="comms"><Gate cap="markets"><Comms /></Gate></Shell>;
}

interface Delivery { id: number; event: string; channel: CommsChannel; status: "sent" | "logged"; at: string }

function Comms() {
  const { lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const summary = useMemo(() => commsSummary(), []);
  const maxCoverage = Math.max(...Object.values(summary.channelCoverage));

  const [selectedKey, setSelectedKey] = useState(COMMS_CATALOGUE[0]!.events[0]!.key);
  const selected = useMemo(() => COMMS_CATALOGUE.flatMap((c) => c.events).find((e) => e.key === selectedKey)!, [selectedKey]);

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [seq, setSeq] = useState(1);
  const sendTest = () => {
    const now = new Date().toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB");
    const rows: Delivery[] = selected.channels.map((channel, i) => ({
      id: seq + i, event: selected.key, channel,
      status: channel === "inapp" ? "logged" : "logged", // sandbox: no provider key, so recorded not sent
      at: now,
    }));
    setDeliveries((d) => [...rows.reverse(), ...d].slice(0, 40));
    setSeq((n) => n + rows.length);
  };

  return (
    <div className="comms">
      <div className="kpis comms-kpis">
        <Tile label={L("Événements du catalogue", "Catalogue events")} value={String(summary.events)} note={L(`${summary.categories} catégories`, `${summary.categories} categories`)} />
        <Tile label={L("Notices obligatoires", "Mandatory notices")} value={String(summary.mandatory)} note={L("ignorent les désinscriptions", "bypass user opt-outs")} />
        <Tile label={L("Canaux branchés", "Channels wired")} value={String(summary.channels)} note="email · in-app · sms · push · whatsapp" />
        <Tile label={L("Audiences servies", "Audiences served")} value={String(COMMS_AUDIENCES.length)} note={L("client · resto · livreur · console", "customer · restaurant · rider · console")} />
      </div>

      <div className="comms-grid">
        <section className="card">
          <div className="card-head"><div><h2>{L("Couverture par canal", "Channel coverage")}</h2><p>{L("Combien d'événements partent sur chaque canal par défaut", "How many catalogue events fire on each channel by default")}</p></div></div>
          <div className="cov">
            {COMMS_CHANNELS.map((ch) => {
              const n = summary.channelCoverage[ch];
              return (
                <div className="cov-row" key={ch}>
                  <span className="cov-name">{CHANNEL_LABEL[ch]}</span>
                  <span className="cov-bar"><i style={{ width: `${Math.round((n / maxCoverage) * 100)}%` }} /></span>
                  <span className="cov-n num">{n}</span>
                </div>
              );
            })}
          </div>
          <div className="aud-row">
            {COMMS_AUDIENCES.map((a) => (
              <span className="aud-tile" key={a}><b className="num">{summary.byAudience[a]}</b> {L(AUD_LABEL[a]![0], AUD_LABEL[a]![1])}</span>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>{L("Aperçu & test", "Template QA")}</h2><p>{L("Prévisualisez l'e-mail de marque ou envoyez-vous un événement sur ses canaux", "Preview the branded email or fire any event to yourself across its channels")}</p></div></div>
          <select className="select comms-select" value={selectedKey} onChange={(ev) => setSelectedKey(ev.target.value)} aria-label={L("Choisir un événement", "Choose an event")}>
            {COMMS_CATALOGUE.map((cat) => (
              <optgroup key={cat.key} label={cat.title}>
                {cat.events.map((e) => <option key={e.key} value={e.key}>{e.title} — {e.key}</option>)}
              </optgroup>
            ))}
          </select>
          <MailPreview event={selected} />
          <div className="comms-actions">
            <button type="button" className="btn primary" onClick={sendTest}>{L("M'envoyer un test", "Send test to me")}</button>
            <span className="muted">{L("Sandbox : enregistré tant qu'aucune clé fournisseur n'est définie.", "Sandbox: recorded until a provider key is set.")}</span>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><div><h2>{L("Livraisons récentes", "Recent deliveries")}</h2><p>{L("Chaque événement × canal × destinataire avec son statut", "Every event × channel × recipient with its delivery status")}</p></div></div>
        {deliveries.length === 0
          ? <p className="muted">{L("Aucune livraison encore. Envoyez-vous un test ci-dessus.", "No deliveries yet. Send yourself a test above.")}</p>
          : <div className="deliv">{deliveries.map((d) => (
              <div className="deliv-row" key={d.id}>
                <span className={`chan chan-${d.channel}`}>{CHANNEL_LABEL[d.channel]}</span>
                <span className="deliv-ev">{d.event}</span>
                <span className={`deliv-status ${d.status}`}>{d.status === "sent" ? L("envoyé", "sent") : L("enregistré", "logged")}</span>
                <span className="deliv-at num">{d.at}</span>
              </div>
            ))}</div>}
      </section>

      {COMMS_CATALOGUE.map((cat) => (
        <section className="card" key={cat.key}>
          <div className="card-head"><div><h2>{cat.title} <span className="muted">· {cat.events.length}</span></h2><p>{cat.description}</p></div></div>
          <div className="ev-list">
            {cat.events.map((e) => <EventRow key={e.key} event={e} L={L} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value num">{value}</div><div className="delta">{note}</div></div>;
}

function EventRow({ event, L }: { event: CommsEvent; L: (fr: string, en: string) => string }) {
  return (
    <div className="ev-row">
      <div className="ev-main">
        <span className={`sev sev-${event.severity}`} title={L(SEV_LABEL[event.severity][0], SEV_LABEL[event.severity][1])} />
        <div>
          <div className="ev-title">{event.title}{event.mandatory ? <span className="mand">{L("obligatoire", "mandatory")}</span> : null}</div>
          <div className="ev-sub">{event.subject}</div>
          <code className="ev-key">{event.key}</code>
        </div>
      </div>
      <div className="ev-meta">
        <span className="auds">{event.audience.map((a) => <span className="aud" key={a}>{L(AUD_LABEL[a]![0], AUD_LABEL[a]![1])}</span>)}</span>
        <span className="chans">{event.channels.map((c) => <span className={`chan chan-${c}`} key={c}>{CHANNEL_LABEL[c]}</span>)}</span>
      </div>
    </div>
  );
}

function MailPreview({ event }: { event: CommsEvent }) {
  return (
    <div className="mail">
      <div className="mail-head">
        <span className="mail-logo">Tunakula</span>
        <span className="mail-tag">RDC</span>
      </div>
      <div className="mail-body">
        <h3>{event.subject}</h3>
        <p>Bonjour,</p>
        <p>Ceci est l'aperçu de l'e-mail de marque envoyé pour l'événement <code>{event.key}</code>. Le message réel reprend le logo du commerce, votre couleur de marque et les détails de la commande.</p>
        <span className="mail-btn">Ouvrir Tunakula</span>
        <p className="mail-foot">Tunakula · Groupe Nseya · info@tunakula.com</p>
      </div>
    </div>
  );
}
