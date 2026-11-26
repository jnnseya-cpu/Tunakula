"use client";
/**
 * App versions (ops) — the cutover kill-switch. Set, per app and platform, the minimum supported client version
 * and (optionally) the latest version, a store link and an update message. When "require update" is on, any client
 * below the minimum is blocked with a 426 and shown an "Update required" screen; the web storefront shows a reload
 * gate. Advisory by default, so nothing blocks until an admin turns it on at cutover. Managed like Integrations
 * (a market admin), though the floor applies platform-wide.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Release {
  app: string; platform: string; min_supported: string; latest: string; store_url: string;
  mandatory: boolean; message: string; updated_by: string; updated_at: string;
}

const APPS: { id: string; label: [string, string]; platforms: string[] }[] = [
  { id: "customer", label: ["Appli client", "Customer app"], platforms: ["android", "ios"] },
  { id: "restaurant", label: ["Appli restaurant", "Restaurant app"], platforms: ["android", "ios"] },
  { id: "rider", label: ["Appli livreur", "Rider app"], platforms: ["android", "ios"] },
  { id: "storefront", label: ["Vitrine web", "Web storefront"], platforms: ["web"] },
];
const PLATFORM_LABEL: Record<string, string> = { android: "Android", ios: "iOS", web: "Web" };

export default function AppReleasesPage() {
  return <Shell title="appReleases"><Gate cap="markets"><AppReleases /></Gate></Shell>;
}

function AppReleases() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ releases: Release[] }>("/v1/admin/app-releases", { country }).then((r) => { setRows(r.releases); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner error">{error}</div>;
  const byKey = new Map((rows ?? []).map((r) => [`${r.app}:${r.platform}`, r]));

  return (
    <>
      <div className="scope-note">{L(
        "Définissez la version minimale de chaque application. Quand « forcer la mise à jour » est activé, les clients en dessous du minimum sont bloqués et invités à mettre à jour — c'est l'interrupteur de bascule. Par défaut, c'est seulement indicatif : rien n'est bloqué tant que vous ne l'activez pas.",
        "Set the minimum version for each app. When “require update” is on, clients below the minimum are blocked and told to update — this is the cutover switch. It is advisory by default: nothing is blocked until you turn it on.",
      )}</div>
      {rows == null ? <div className="card"><p className="muted">…</p></div> : APPS.map((app) => (
        <section className="card" key={app.id}>
          <div className="card-head"><div><h2>{L(app.label[0], app.label[1])}</h2><p className="muted"><code>{app.id}</code></p></div></div>
          {app.platforms.map((platform) => (
            <ReleaseForm key={platform} app={app.id} platform={platform} current={byKey.get(`${app.id}:${platform}`) ?? null} country={country} L={L} onSaved={load} />
          ))}
        </section>
      ))}
    </>
  );
}

function ReleaseForm({ app, platform, current, country, L, onSaved }: { app: string; platform: string; current: Release | null; country: string; L: (fr: string, en: string) => string; onSaved: () => void }) {
  const [min, setMin] = useState("");
  const [latest, setLatest] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMin(current?.min_supported ?? "");
    setLatest(current?.latest ?? "");
    setStoreUrl(current?.store_url ?? "");
    setMandatory(current?.mandatory ?? false);
    setMessage(current?.message ?? "");
    setNotice(null);
  }, [current]);

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      await api("/v1/admin/app-releases", { method: "POST", country, body: { app, platform, min_supported: min.trim(), latest: latest.trim(), store_url: storeUrl.trim(), mandatory, message: message.trim() } });
      setNotice(L("Enregistré.", "Saved."));
      onSaved();
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(false); }
  };

  const state = !current ? <span className="pill">{L("non défini", "not set")}</span>
    : current.mandatory ? <span className="pill" style={{ background: "var(--tomato, #e4572e)", color: "#fff" }}>{L("mise à jour forcée", "update enforced")}</span>
    : <span className="pill good">{L("indicatif", "advisory")}</span>;

  return (
    <div style={{ borderTop: "1px solid var(--line, #eee)", paddingTop: 14, marginTop: 14 }}>
      <div className="field-label" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <strong>{PLATFORM_LABEL[platform] ?? platform}</strong> {state}
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{L("Version minimale *", "Minimum version *")}</span>
          <input type="text" inputMode="decimal" placeholder="2.0.0" value={min} onChange={(e) => setMin(e.target.value)} />
          <small className="muted">{L("En dessous → bloqué si forcé", "Below this → blocked when enforced")}</small>
        </label>
        <label className="field">
          <span className="field-label">{L("Dernière version", "Latest version")}</span>
          <input type="text" inputMode="decimal" placeholder="2.3.0" value={latest} onChange={(e) => setLatest(e.target.value)} />
          <small className="muted">{L("Au-dessus du min, en dessous → invite (facultatif)", "Above min, below this → gentle nudge (optional)")}</small>
        </label>
        <label className="field">
          <span className="field-label">{L("Lien du store", "Store link")}</span>
          <input type="url" placeholder="https://play.google.com/store/apps/details?id=…" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{L("Message de mise à jour", "Update message")}</span>
          <input type="text" placeholder={L("Une nouvelle version de Tunakula est disponible.", "A new version of Tunakula is available.")} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
        </label>
      </div>
      <div className="card-foot" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
          <span>{L("Forcer la mise à jour (bloque les clients en dessous du minimum)", "Require update (blocks clients below the minimum)")}</span>
        </label>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {notice ? <span className="muted">{notice}</span> : null}
          <button className="btn primary" type="button" disabled={busy || !min.trim()} onClick={save}>{busy ? L("Enregistrement…", "Saving…") : L("Enregistrer", "Save")}</button>
        </span>
      </div>
    </div>
  );
}
