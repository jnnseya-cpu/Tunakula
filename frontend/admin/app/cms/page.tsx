"use client";
/**
 * Storefront content (CMS). A market admin edits the customer app's landing hero, social links and footer tagline
 * per country — no code change, no deploy. Reads and writes GET/POST /v1/admin/site-content; the storefront reads
 * the same document from /v1/site-content and falls back to its built-in defaults.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

const SOCIAL: { key: string; label: string; placeholder: string }[] = [
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/tunakula" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/tunakula" },
  { key: "x", label: "X", placeholder: "https://x.com/tunakula" },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@tunakula" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@tunakula" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "https://wa.me/243…" },
];
interface Home { hero: { title: string; subtitle: string; cta_label: string; cta_href: string }; social: Record<string, string>; tagline: string }

export default function CmsPage() {
  return <Shell title="cms"><Gate cap="markets"><Cms /></Gate></Shell>;
}

function Cms() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [home, setHome] = useState<Home | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api<{ home: Home }>("/v1/admin/site-content", { country }).then((r) => { setHome({ ...r.home, social: r.home.social ?? {} }); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const setHero = (k: keyof Home["hero"], v: string) => home && setHome({ ...home, hero: { ...home.hero, [k]: v } });
  const setSocial = (k: string, v: string) => home && setHome({ ...home, social: { ...home.social, [k]: v } });

  const save = async () => {
    if (!home) return;
    setSaving(true);
    try {
      const social: Record<string, string> = {};
      for (const { key } of SOCIAL) { const v = (home.social[key] ?? "").trim(); if (v) social[key] = v; }
      const r = await api<{ home: Home }>("/v1/admin/site-content", { method: "POST", country, body: { hero: home.hero, social, tagline: home.tagline } });
      setHome({ ...r.home, social: r.home.social ?? {} });
      setNotice(L("Contenu enregistré. La vitrine le reprend au prochain chargement.", "Content saved. The storefront picks it up on its next load."));
    } catch (e) { setNotice((e as Error).message); }
    finally { setSaving(false); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!home) return <div className="muted">…</div>;

  return (
    <>
      <div className="scope-note">{L("Contenu de la vitrine client (page d'accueil) pour ce marché. Les champs vides reprennent les valeurs par défaut.", "Customer storefront content (landing page) for this market. Empty fields fall back to the built-in defaults.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      {/* A live preview of the hero as the customer app renders it. */}
      <section className="card">
        <div className="card-head"><div><h2>{L("Bannière d'accueil", "Landing hero")}</h2></div></div>
        <div className="cms-hero">
          <h1>{home.hero.title || L("Votre titre", "Your title")}</h1>
          {home.hero.subtitle ? <p>{home.hero.subtitle}</p> : null}
          <span className="cms-cta">{home.hero.cta_label || L("Commander", "Order now")} →</span>
        </div>
        <div className="form-grid">
          <label>{L("Titre", "Title")}<input className="input" value={home.hero.title} onChange={(e) => setHero("title", e.target.value)} /></label>
          <label>{L("Sous-titre", "Subtitle")}<input className="input" value={home.hero.subtitle} onChange={(e) => setHero("subtitle", e.target.value)} /></label>
          <label>{L("Libellé du bouton", "Button label")}<input className="input" value={home.hero.cta_label} onChange={(e) => setHero("cta_label", e.target.value)} placeholder={L("Commander", "Order now")} /></label>
          <label>{L("Lien du bouton (/order/ ou https://…)", "Button link (/order/ or https://…)")}<input className="input" value={home.hero.cta_href} onChange={(e) => setHero("cta_href", e.target.value)} placeholder="/order/" /></label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Réseaux sociaux", "Social links")}</h2><p>{L("Affichés dans le pied de page ; laissez vide pour masquer.", "Shown in the footer; leave empty to hide.")}</p></div></div>
        <div className="form-grid">
          {SOCIAL.map((s) => (
            <label key={s.key}>{s.label}<input className="input" value={home.social[s.key] ?? ""} onChange={(e) => setSocial(s.key, e.target.value)} placeholder={s.placeholder} /></label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Signature (pied de page)", "Tagline (footer)")}</h2></div></div>
        <div className="form-grid">
          <label className="wide">{L("Texte", "Text")}<input className="input" value={home.tagline} onChange={(e) => setHome({ ...home, tagline: e.target.value })} /></label>
        </div>
        <div className="card-foot"><button className="btn primary" type="button" disabled={saving || !home.hero.title.trim()} onClick={save}>{saving ? "…" : L("Enregistrer le contenu", "Save content")}</button></div>
      </section>
    </>
  );
}
