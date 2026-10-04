"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { dateTime } from "../../lib/format";

interface Version { version: number; status: string; created_by: string; created_at: string; published_by: string | null; published_at: string | null }
interface Change { path: string; before: unknown; after: unknown }
const AREAS = ["PRODUCT", "ENGINEERING", "PAYMENTS", "SECURITY", "COMPLIANCE", "OPERATIONS", "AI", "FINANCE"];

export default function MarketsPage() {
  return <Shell title="markets"><Gate cap="markets"><Markets /></Gate></Shell>;
}

function Markets() {
  const { country, lang } = useConsole();
  const [versions, setVersions] = useState<Version[]>([]);
  const [diff, setDiff] = useState<{ from: number; to: number; changes: Change[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [signers, setSigners] = useState<Record<string, string>>({});
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<{ data: Version[] }>(`/v1/admin/countries/${country}/versions`, { country }).then((r) => { setVersions(r.data); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = versions.find((v) => v.status === "PUBLISHED");

  const showDiff = async (to: number) => {
    const from = live?.version ?? 1;
    try { setDiff({ from, to, changes: (await api<{ data: Change[] }>(`/v1/admin/countries/${country}/diff?from=${from}&to=${to}`, { country })).data }); } catch (e) { setNotice((e as Error).message); }
  };
  const publish = async (v: number) => {
    const review = Object.fromEntries(Object.entries(signers).filter(([, s]) => s.trim()).map(([a, s]) => [a, { signed_by: s.trim() }]));
    try { await api(`/v1/admin/countries/${country}/versions/${v}/publish`, { method: "POST", country, body: { review } }); setNotice(L(`Version ${v} publiée.`, `Version ${v} published.`)); void load(); } catch (e) { setNotice((e as Error).message); }
  };
  const rollback = async () => {
    if (!window.confirm(L("Revenir à la version publiée précédente ?", "Roll back to the previously published version?"))) return;
    try { await api(`/v1/admin/countries/${country}/rollback`, { method: "POST", country }); setNotice(L("Retour effectué.", "Rolled back.")); void load(); } catch (e) { setNotice((e as Error).message); }
  };
  const saveDraft = async () => {
    try {
      const profile = JSON.parse(draft);
      const r = await api<{ version: number }>("/v1/admin/countries/drafts", { method: "POST", country, body: { profile } });
      setNotice(L(`Brouillon v${r.version} enregistré.`, `Draft v${r.version} saved.`)); setDraft(""); void load();
    } catch (e) { setNotice((e as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Les changements d'argent, de prix, de paiements ou de travail doivent être publiés par un Super Admin qui ne les a pas rédigés.", "Money, pricing, payments or labour changes must be published by a Super Admin who did not draft them.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}
      <section className="card">
        <div className="card-head"><div><h2>{L("Versions du profil pays", "Country Profile versions")} · {country}</h2><p>{live ? L(`Version ${live.version} en ligne`, `Version ${live.version} live`) : L("Aucune version publiée", "Nothing published")}</p></div>{live ? <button className="btn ghost" type="button" onClick={rollback}>{L("Revenir en arrière", "Roll back")}</button> : null}</div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Version</th><th>{L("Statut", "Status")}</th><th>{L("Rédigée", "Drafted")}</th><th>{L("Publiée", "Published")}</th><th></th></tr></thead>
            <tbody>
              {[...versions].reverse().map((v) => (
                <tr key={v.version}>
                  <td className="num">v{v.version}</td>
                  <td><span className={`pill ${v.status === "PUBLISHED" ? "good" : v.status === "DRAFT" ? "warning" : ""}`}>{v.status}</span></td>
                  <td className="muted">{dateTime(lang, v.created_at)}</td>
                  <td className="muted">{v.published_at ? dateTime(lang, v.published_at) : "—"}</td>
                  <td>{v.status === "DRAFT" ? <><button className="link-btn" type="button" onClick={() => showDiff(v.version)}>{L("Comparer", "Compare")}</button>{" "}<button className="btn primary" type="button" onClick={() => publish(v.version)}>{L("Publier", "Publish")}</button></> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {diff ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Différences", "Differences")} v{diff.from} → v{diff.to}</h2><p>{diff.changes.length} {L("changement(s)", "change(s)")}</p></div></div>
          <table className="data"><thead><tr><th>{L("Champ", "Field")}</th><th>{L("Avant", "Before")}</th><th>{L("Après", "After")}</th></tr></thead>
            <tbody>{diff.changes.map((c) => <tr key={c.path}><td><code>{c.path}</code></td><td className="muted">{JSON.stringify(c.before)}</td><td><b>{JSON.stringify(c.after)}</b></td></tr>)}</tbody></table>
        </section>
      ) : null}
      <div className="grid g2">
        <section className="card">
          <div className="card-head"><div><h2>{L("Revue de préparation", "Readiness review")}</h2><p>{L("Obligatoire pour la première mise en ligne d'un marché (§28.10).", "Required for a market's first move live (§28.10).")}</p></div></div>
          <div className="grid g2" style={{ gap: 8 }}>
            {AREAS.map((a) => <input key={a} className="input" placeholder={`${a} — ${L("signé par", "signed by")}`} value={signers[a] ?? ""} onChange={(e) => setSigners({ ...signers, [a]: e.target.value })} />)}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><h2>{L("Nouveau brouillon", "New draft")}</h2><p>{L("Collez le profil pays complet (JSON). Il est validé avant d'être enregistré.", "Paste the full Country Profile (JSON). It is validated before it is saved.")}</p></div></div>
          <textarea className="input" style={{ width: "100%", height: 160, padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='{ "schema_version": … }' />
          <div style={{ marginTop: 8 }}><button className="btn" type="button" disabled={!draft.trim()} onClick={saveDraft}>{L("Enregistrer le brouillon", "Save draft")}</button></div>
        </section>
      </div>
    </>
  );
}
