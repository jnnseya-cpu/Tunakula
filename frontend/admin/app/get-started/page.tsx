"use client";
import { useState } from "react";
import { Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

/** Self-serve onboarding wizard: register a business, add a branch + menu, publish — no field team needed. */
export default function GetStartedPage() {
  return <Shell title="get_started"><Wizard /></Shell>;
}

interface Item { id: string; name: string; price: string }
const KINSHASA = { lat: -4.3217, lng: 15.3125 };

function Wizard() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [business, setBusiness] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [commune, setCommune] = useState("");
  const [loc, setLoc] = useState(KINSHASA);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ fr: "", en: "", usd: "" });

  const call = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  };

  const register = async () => {
    const r = await call(() => api<{ group_id: string }>("/v1/merchant/register", { method: "POST", country, body: { business_name: business } }));
    if (r) { setGroupId(r.group_id); setStep(2); }
  };
  const useMyLocation = () => {
    setLocMsg(L("Localisation…", "Locating…"));
    navigator.geolocation?.getCurrentPosition(
      (p) => { setLoc({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); setLocMsg(L("Position enregistrée ✓", "Location set ✓")); },
      () => setLocMsg(L("Impossible de localiser — saisissez les coordonnées.", "Could not locate — enter coordinates.")),
    );
  };
  const addBranch = async () => {
    const r = await call(() => api<{ branch_id: string }>("/v1/merchant/branches", { method: "POST", country, body: { group_id: groupId, name: branchName, lat: loc.lat, lng: loc.lng, ...(commune.trim() ? { commune: commune.trim().toLowerCase() } : {}) } }));
    if (r) { setBranchId(r.branch_id); setStep(3); }
  };
  const addItem = async () => {
    if (!form.fr.trim() || !form.usd.trim()) return;
    const r = await call(() => api<{ id: string }>(`/v1/branches/${branchId}/items`, { method: "POST", country, body: { names: { fr: form.fr, ...(form.en ? { en: form.en } : {}) }, prices: { USD: form.usd } } }));
    if (r) { setItems([...items, { id: r.id, name: form.fr, price: form.usd }]); setForm({ fr: "", en: "", usd: "" }); }
  };
  const publish = async () => {
    const r = await call(() => api<{ published: boolean }>(`/v1/merchant/branches/${branchId}/publish`, { method: "POST", country }));
    if (r?.published) setStep(5);
  };

  const steps = [L("Votre entreprise", "Your business"), L("Votre établissement", "Your branch"), L("Votre menu", "Your menu"), L("Publier", "Publish")];

  return (
    <div className="wizard">
      <ol className="wiz-steps">
        {steps.map((s, i) => <li key={s} className={step > i + 1 || step === 5 ? "done" : step === i + 1 ? "now" : ""}><span>{i + 1}</span>{s}</li>)}
      </ol>
      {error ? <div className="banner" style={{ marginBottom: 12 }}>{error}</div> : null}

      {step === 1 ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Bienvenue sur Tunakula 👋", "Welcome to Tunakula 👋")}</h2><p>{L("Mettez votre restaurant en ligne en quelques minutes. Commençons par le nom de votre entreprise.", "Get your restaurant online in a few minutes. Let's start with your business name.")}</p></div></div>
          <label className="field"><span>{L("Nom de l'entreprise", "Business name")}</span><input className="input" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={L("ex. Mama Nkoyi Kitchen", "e.g. Mama Nkoyi Kitchen")} /></label>
          <button className="btn primary" type="button" disabled={busy || business.trim().length < 2} onClick={register}>{L("Continuer", "Continue")}</button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Où se trouve votre établissement ?", "Where is your branch?")}</h2><p>{L("Ajoutez le lieu d'où vous préparez les commandes.", "Add the place you cook and hand over orders from.")}</p></div></div>
          <label className="field"><span>{L("Nom de l'établissement", "Branch name")}</span><input className="input" value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder={L("ex. Mama Nkoyi — Lemba", "e.g. Mama Nkoyi — Lemba")} /></label>
          <label className="field"><span>{L("Commune", "Commune")}</span><input className="input" value={commune} onChange={(e) => setCommune(e.target.value)} placeholder="ex. gombe" /></label>
          <div className="wiz-loc">
            <button className="btn" type="button" onClick={useMyLocation}>📍 {L("Utiliser ma position", "Use my location")}</button>
            <input className="input" inputMode="decimal" value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: Number(e.target.value) })} style={{ width: 130 }} aria-label="lat" />
            <input className="input" inputMode="decimal" value={loc.lng} onChange={(e) => setLoc({ ...loc, lng: Number(e.target.value) })} style={{ width: 130 }} aria-label="lng" />
          </div>
          {locMsg ? <p className="muted">{locMsg}</p> : null}
          <button className="btn primary" type="button" disabled={busy || branchName.trim().length < 2} onClick={addBranch}>{L("Continuer", "Continue")}</button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Ajoutez vos plats", "Add your dishes")}</h2><p>{L("Au moins un plat est requis pour publier. Vous pourrez en ajouter d'autres plus tard.", "At least one dish is needed to publish. You can add more later.")}</p></div></div>
          {items.length ? (
            <ul className="wiz-items">{items.map((it) => <li key={it.id}><b>{it.name}</b><span className="num">${it.price}</span></li>)}</ul>
          ) : <p className="muted">{L("Aucun plat pour l'instant.", "No dishes yet.")}</p>}
          <div className="filters" style={{ marginTop: 10 }}>
            <input className="input" placeholder={L("Nom (français)", "Name (French)")} value={form.fr} onChange={(e) => setForm({ ...form, fr: e.target.value })} />
            <input className="input" placeholder={L("Nom (anglais)", "Name (English)")} value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="USD" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} style={{ width: 100 }} />
            <button className="btn" type="button" disabled={busy || !form.fr.trim() || !form.usd.trim()} onClick={addItem}>{L("Ajouter", "Add")}</button>
          </div>
          <button className="btn primary" type="button" disabled={items.length === 0} onClick={() => setStep(4)} style={{ marginTop: 12 }}>{L("Continuer", "Continue")}</button>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Prêt à être publié", "Ready to go live")}</h2><p>{L("Vérifiez, puis publiez. Votre établissement apparaîtra sur Tunakula et sur Tunakula Nzela (WhatsApp).", "Review, then publish. Your branch will appear on Tunakula and on Tunakula Nzela (WhatsApp).")}</p></div></div>
          <dl className="wiz-review">
            <div><dt>{L("Entreprise", "Business")}</dt><dd>{business}</dd></div>
            <div><dt>{L("Établissement", "Branch")}</dt><dd>{branchName}{commune ? ` · ${commune}` : ""}</dd></div>
            <div><dt>{L("Plats", "Dishes")}</dt><dd>{items.length}</dd></div>
          </dl>
          <button className="btn primary" type="button" disabled={busy} onClick={publish}>{L("Publier et mettre en ligne", "Publish and go live")}</button>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="card wiz-done">
          <h2>{L("Vous êtes en ligne ! 🎉", "You're live! 🎉")}</h2>
          <p>{L("Les clients peuvent désormais vous trouver et commander — sur le web et sur Tunakula Nzela (WhatsApp).", "Customers can now find and order from you — on the web and on Tunakula Nzela (WhatsApp).")}</p>
          <div className="wiz-cta">
            <a className="btn primary" href={`/merchants/view/?id=${branchId}`}>{L("Gérer mon menu", "Manage my menu")}</a>
            <a className="btn" href="/kitchen/">{L("Voir les commandes", "See orders")}</a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
