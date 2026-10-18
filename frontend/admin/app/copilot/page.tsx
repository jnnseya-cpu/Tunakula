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

      {branchId ? <MenuWriter branchId={branchId} country={country} lang={lang} /> : null}
    </>
  );
}

interface Dish { id: string; names: Record<string, string> }
function MenuWriter({ branchId, country, lang }: { branchId: string; country: string; lang: string }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ suggestion: string; source: string; task: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setDishes(null); setItemId(""); setResult(null); setNote(null);
    api<{ items: Dish[] }>(`/v1/branches/${branchId}/menu`, { country }).then((r) => { setDishes(r.items); if (r.items[0]) setItemId(r.items[0].id); }).catch(() => setDishes([]));
  }, [branchId, country]);

  const run = async (task: "DESCRIBE" | "TRANSLATE", toLang: "fr" | "en") => {
    if (!itemId) return;
    setBusy(`${task}:${toLang}`); setResult(null); setNote(null);
    try {
      const r = await api<{ suggestion: string; source: string; task: string }>(`/v1/admin/branches/${branchId}/items/${itemId}/draft`, { method: "POST", country, body: { task, to_lang: toLang } });
      setResult(r);
    } catch (e) { setNote((e as Error).message); } finally { setBusy(""); }
  };

  if (!dishes || dishes.length === 0) return null;
  const dishName = (d: Dish) => d.names[lang] ?? d.names["fr"] ?? d.names["en"] ?? "—";

  return (
    <section className="card writer-card">
      <div className="card-head"><div><h2>{L("Rédacteur IA du menu", "AI menu writer")}</h2><p>{L("Rédige une description ou traduit un plat. Relisez, puis enregistrez dans le menu — rien n’est modifié automatiquement.", "Draft a description or translate a dish. Review it, then save it in the menu — nothing changes automatically.")}</p></div></div>
      <div className="writer-controls">
        <select className="select" value={itemId} onChange={(e) => { setItemId(e.target.value); setResult(null); setNote(null); }}>
          {dishes.map((d) => <option key={d.id} value={d.id}>{dishName(d)}</option>)}
        </select>
        <div className="writer-actions">
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => run("DESCRIBE", "en")}>{busy === "DESCRIBE:en" ? "…" : L("Décrire (EN)", "Describe (EN)")}</button>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => run("DESCRIBE", "fr")}>{busy === "DESCRIBE:fr" ? "…" : L("Décrire (FR)", "Describe (FR)")}</button>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => run("TRANSLATE", "en")}>{busy === "TRANSLATE:en" ? "…" : L("Traduire → EN", "Translate → EN")}</button>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => run("TRANSLATE", "fr")}>{busy === "TRANSLATE:fr" ? "…" : L("Traduire → FR", "Translate → FR")}</button>
        </div>
      </div>
      {note ? <div className="banner" style={{ marginTop: 12 }}>{note}</div> : null}
      {result ? (
        <div className="writer-result">
          <div className="writer-result-head">
            <span className="pill">{result.task === "TRANSLATE" ? L("Traduction", "Translation") : L("Description", "Description")}</span>
            <span className={`pill ${result.source === "ai" ? "good" : ""}`}>{result.source === "ai" ? L("IA", "AI") : L("Brouillon de base", "Basic draft")}</span>
            <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(result.suggestion).catch(() => undefined)}>{L("Copier", "Copy")}</button>
          </div>
          <p className="writer-text">{result.suggestion}</p>
          <p className="muted small">{L("Copiez ce texte dans l’éditeur de menu pour l’enregistrer.", "Copy this text into the menu editor to save it.")}</p>
        </div>
      ) : null}
    </section>
  );
}
