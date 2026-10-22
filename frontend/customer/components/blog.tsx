"use client";
/**
 * Renders the feature playbook (/blog) and each article, picking Français or English at runtime — the static
 * HTML is one file per route, so language is resolved client-side (French on first paint to match the server,
 * then the viewer's choice after mount), exactly like the rest of the storefront. Lingála/Kiswahili fall back
 * to French.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveLang, type Lang } from "../lib/i18n";
import { ARTICLES, AUDIENCES, CTA, articlesFor, type Article, type Loc } from "../lib/blog";

/** The active language, resolved after mount (French until then, so SSR and first client render agree). */
function useLang(): Lang {
  const [l, setL] = useState<Lang>("fr");
  useEffect(() => { setL(resolveLang()); }, []);
  return l;
}
/** Content is written in FR and EN; everyone but an English viewer reads the French. */
const pick = (a: Article, l: Lang): Loc => (l === "en" ? a.en : a.fr);
const isEn = (l: Lang) => l === "en";

export function BlogIndex() {
  const l = useLang();
  const en = isEn(l);
  return (
    <>
      <section className="tight blog-hero">
        <div className="wrap">
          <p className="eyebrow"><b>{en ? "Feature playbook" : "Le playbook des fonctionnalités"}</b></p>
          <h1 className="display" style={{ margin: "12px 0 0" }}>
            {en ? "Every feature. " : "Chaque fonctionnalité. "}<em>{en ? "And why it wins." : "Et pourquoi elle gagne."}</em>
          </h1>
          <p className="lede" style={{ maxWidth: "52ch", marginTop: 16 }}>
            {en
              ? "The honest sell: each Tunakula capability in plain words, with the one reason it beats what Kinshasa uses today. 0% commission for the people who cook, same-day pay for the people who ride, counter prices for the people who eat."
              : "La vente honnête : chaque capacité de Tunakula en mots simples, avec la seule raison qui la fait gagner sur ce que Kinshasa utilise aujourd'hui. 0 % de commission pour ceux qui cuisinent, paie le jour même pour ceux qui livrent, prix du comptoir pour ceux qui mangent."}
          </p>
        </div>
      </section>

      {AUDIENCES.map((aud) => {
        const rows = articlesFor(aud.key);
        if (!rows.length) return null;
        return (
          <section className="tight blog-sec" key={aud.key}>
            <div className="wrap">
              <h2 className="sec-title blog-aud">{en ? aud.en : aud.fr}</h2>
              <div className="blog-grid">
                {rows.map((a) => {
                  const c = pick(a, l);
                  return (
                    <Link className="blog-card" key={a.slug} href={`/blog/${a.slug}/`}>
                      <span className="blog-cat">{a.category}</span>
                      <h3>{c.title}</h3>
                      <p className="blog-dek">{c.dek}</p>
                      <span className="blog-more">{en ? "Read →" : "Lire →"}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

export function ArticleView({ slug }: { slug: string }) {
  const l = useLang();
  const en = isEn(l);
  const a = ARTICLES.find((x) => x.slug === slug);
  if (!a) return null;
  const c = pick(a, l);
  const cta = CTA[a.audience];
  const audience = AUDIENCES.find((x) => x.key === a.audience);
  return (
    <article className="tight blog-article">
      <div className="wrap narrow">
        <p className="blog-crumb">
          <Link href="/blog/">{en ? "Playbook" : "Le playbook"}</Link>
          <span aria-hidden="true"> · </span>
          <span>{audience ? (en ? audience.en : audience.fr) : ""}</span>
        </p>
        <p className="eyebrow"><b>{a.category}</b></p>
        <h1 className="display blog-title">{c.title}</h1>
        <p className="blog-lede">{c.dek}</p>
        <div className="blog-body">
          {c.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <aside className="blog-usp">
          <span className="blog-usp-k">{en ? "Why it wins" : "Pourquoi ça gagne"}</span>
          <p>{c.usp}</p>
        </aside>
        <div className="cta-row" style={{ marginTop: 28 }}>
          <Link className="btn accent" href={cta.href}>{en ? cta.en : cta.fr}</Link>
          <Link className="link" href="/blog/">{en ? "All features" : "Toutes les fonctionnalités"}</Link>
        </div>
      </div>
    </article>
  );
}
