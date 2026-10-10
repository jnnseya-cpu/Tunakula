"use client";
/**
 * Integrations / API keys (ops). Enter the payment-rail keys, the messaging provider, Web Push and the maps key
 * here instead of only as environment variables; the API reads them at start-up. For security the panel shows
 * only whether each field is set (and where it came from) — a stored value is never sent back to the browser.
 * Leaving a field blank and saving clears the stored value (falling back to the environment variable).
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Field { env_key: string; label: string; required: boolean; secret: boolean; set: boolean; source: "panel" | "env" | null }
interface Integration { id: string; name: string; description: string; configured: boolean; fields: Field[] }

export default function IntegrationsPage() {
  return <Shell title="integrations"><Gate cap="markets"><Integrations /></Gate></Shell>;
}

function Integrations() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ integrations: Integration[] }>("/v1/admin/integrations", { country }).then((r) => { setRows(r.integrations); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L(
        "Clés des moyens de paiement, du fournisseur SMS/WhatsApp, des notifications push et des cartes. Par sécurité, le panneau indique seulement si une valeur est enregistrée — jamais la valeur elle-même. Une variable d'environnement réelle a toujours la priorité.",
        "Payment-rail keys, the SMS/WhatsApp provider, push notifications and maps. For security this panel shows only whether a value is set — never the value itself. A real environment variable always takes precedence.",
      )}</div>
      {rows?.map((i) => <IntegrationCard key={i.id} integration={i} country={country} L={L} onSaved={load} />)}
      {rows ? null : <div className="card"><p className="muted">…</p></div>}
    </>
  );
}

function IntegrationCard({ integration, country, L, onSaved }: { integration: Integration; country: string; L: (fr: string, en: string) => string; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      await api(`/v1/admin/integrations/${integration.id}`, { method: "POST", country, body: values });
      setValues({});
      setNotice(L("Enregistré.", "Saved."));
      onSaved();
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{integration.name} {integration.configured ? <span className="pill good">{L("configuré", "configured")}</span> : <span className="pill">{L("incomplet", "not set up")}</span>}</h2>
          <p>{integration.description}</p>
        </div>
      </div>
      <div className="form-grid">
        {integration.fields.map((f) => (
          <label key={f.env_key} className="field">
            <span className="field-label">
              {f.label}{f.required ? " *" : ""}
              {f.set ? <span className="pill good">{f.source === "env" ? L("via variable d'env.", "from env var") : L("enregistré", "set")}</span> : <span className="pill">{L("non défini", "not set")}</span>}
            </span>
            <input
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={values[f.env_key] ?? ""}
              placeholder={f.set ? "••••••••  " + L("(laisser vide pour conserver)", "(leave blank to keep)") : f.env_key}
              onChange={(e) => setValues((v) => ({ ...v, [f.env_key]: e.target.value }))}
            />
            <small className="muted"><code>{f.env_key}</code></small>
          </label>
        ))}
      </div>
      <div className="card-foot" style={{ justifyContent: "space-between", alignItems: "center" }}>
        {notice ? <span className="muted">{notice}</span> : <span className="muted">{L("Laissez un champ vide pour conserver la valeur actuelle ; effacez puis enregistrez pour la supprimer.", "Leave a field blank to keep its current value; clear it and save to remove it.")}</span>}
        <button className="btn primary" type="button" disabled={busy || Object.keys(values).length === 0} onClick={save}>{busy ? L("Enregistrement…", "Saving…") : L("Enregistrer", "Save")}</button>
      </div>
    </section>
  );
}
