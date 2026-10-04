"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { dateTime } from "../../lib/format";

interface Entry { id: string; at: string; actor: string; action: string; target: string; country_iso2: string | null; detail: unknown; hash: string }

export default function AuditPage() {
  return <Shell title="audit"><Gate cap="audit"><Audit /></Gate></Shell>;
}

function Audit() {
  const { country, lang } = useConsole();
  const [data, setData] = useState<{ chain: { ok: boolean; brokenAt?: number }; data: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  useEffect(() => { api<{ chain: { ok: boolean; brokenAt?: number }; data: Entry[] }>("/v1/admin/audit?limit=200", { country }).then(setData).catch((e: Error) => setError(e.message)); }, [country]);
  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">…</div>;
  return (
    <>
      <div className={`banner ${data.chain.ok ? "ok" : "error"}`}>{data.chain.ok ? L("✓ Chaîne d'audit vérifiée : aucune entrée modifiée, insérée ou supprimée.", "✓ Audit chain verified: no entry edited, inserted or removed.") : L(`✕ Chaîne rompue à l'entrée ${data.chain.brokenAt}.`, `✕ Chain broken at entry ${data.chain.brokenAt}.`)}</div>
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>#</th><th>{L("Date", "Date")}</th><th>{L("Action", "Action")}</th><th>{L("Cible", "Target")}</th><th>{L("Auteur", "Actor")}</th><th>{L("Détail", "Detail")}</th><th>{L("Empreinte", "Hash")}</th></tr></thead>
            <tbody>{data.data.map((e) => (
              <tr key={e.id}><td className="num">{e.id}</td><td className="muted">{dateTime(lang, e.at)}</td><td><code>{e.action}</code></td><td className="muted">{e.target.length > 28 ? `${e.target.slice(0, 27)}…` : e.target}</td>
                <td className="muted">{e.actor.length > 12 ? `…${e.actor.slice(-8)}` : e.actor}</td><td className="muted" style={{ fontSize: 12 }}>{e.detail ? JSON.stringify(e.detail).slice(0, 80) : ""}</td><td className="num muted">{e.hash.slice(0, 10)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
