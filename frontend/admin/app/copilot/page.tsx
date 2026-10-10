"use client";
/**
 * Copilot (merchant): grounded, ranked insights for one of your branches — menu gaps to fill, demand to staff
 * for, performance to watch, reviews to answer. Read-only advice; it changes nothing. Pick a branch and act.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Branch { id: string; name: string }
interface Insight { id: string; category: string; severity: "INFO" | "SUGGESTION" | "WARNING"; title: string; detail: string; metric?: string }
interface Facts { menu: { total: number; available: number }; demand: { orders30d: number } }

const CAT: Record<string, { fr: string; en: string }> = {
  MENU: { fr: "Menu", en: "Menu" }, DEMAND: { fr: "Demande", en: "Demand" }, PERFORMANCE: { fr: "Performance", en: "Performance" }, REVIEWS: { fr: "Avis", en: "Reviews" },
};

export default function CopilotPage() {
  return <Shell title="copilot"><Gate cap="copilot"><Copilot /></Gate></Shell>;
}

function Copilot() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState("");
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ data: Branch[] }>("/v1/admin/branches", { country })
      .then((r) => { setBranches(r.data); if (r.data[0]) setBranchId((b) => b || r.data[0]!.id); })
      .catch((e: Error) => setError(e.message));
  }, [country]);

  useEffect(() => {
    if (!branchId) return;
    setInsights(null);
    api<{ facts: Facts; insights: Insight[] }>(`/v1/admin/branches/${branchId}/copilot?lang=${lang}`, { country })
      .then((r) => { setInsights(r.insights); setFacts(r.facts); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [branchId, country, lang]);

  if (error) return <div className="banner error">{error}</div>;
  if (branches && branches.length === 0) return <div className="banner">{L("Aucun établissement à gérer.", "No branch to manage.")}</div>;

  return (
    <>
      <div className="scope-note">{L(
        "Votre copilote lit les données réelles de l’établissement — le menu, les commandes, la performance et les avis — et propose des actions concrètes. Il ne modifie rien ; à vous de décider.",
        "Your copilot reads the branch's real data — menu, orders, performance and reviews — and suggests concrete actions. It changes nothing; you decide.",
      )}</div>

      <div className="copilot-head">
        {branches && branches.length > 1
          ? <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          : <h2>{branches?.[0]?.name ?? "…"}</h2>}
        {facts ? <span className="copilot-meta">{L(`${facts.menu.total} plats · ${facts.demand.orders30d} commandes (30 j)`, `${facts.menu.total} dishes · ${facts.demand.orders30d} orders (30d)`)}</span> : null}
      </div>

      {insights === null ? <div className="card"><p className="muted">…</p></div> : insights.length === 0 ? (
        <div className="card"><p>{L("Tout est en ordre — aucune action recommandée pour l’instant. Beau travail !", "Everything looks good — nothing to act on right now. Nice work!")}</p></div>
      ) : (
        <div className="copilot-list">
          {insights.map((i) => (
            <div key={i.id} className={`copilot-card sev-${i.severity.toLowerCase()}`}>
              <div className="copilot-card-top">
                <span className="copilot-cat">{L(CAT[i.category]?.fr ?? i.category, CAT[i.category]?.en ?? i.category)}</span>
                {i.metric ? <span className="copilot-metric">{i.metric}</span> : null}
              </div>
              <h3>{i.title}</h3>
              <p>{i.detail}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
