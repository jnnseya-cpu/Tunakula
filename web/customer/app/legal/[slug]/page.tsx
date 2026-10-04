import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteNav } from "../../../components/site";
import { ALL_POLICIES, DRAFT_NOTICE, policy } from "../../../lib/legal";
import { CONTACT_EMAIL } from "../../../lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_POLICIES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = policy((await params).slug);
  return p ? { title: p.title, description: p.summary, alternates: { canonical: `/legal/${p.slug}/` } } : {};
}

const anchor = (h: string) => h.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = policy((await params).slug);
  if (!p) notFound();
  return (
    <>
      <SiteNav current="/legal/" />
      <section className="tight" style={{ paddingBottom: 56 }}>
        <div className="wrap">
          <p className="eyebrow"><Link href="/legal/">Policies</Link> &nbsp;·&nbsp; <b>{p.audience}</b></p>
          <h1 className="display" style={{ fontSize: "clamp(44px, 5.6vw, 80px)", margin: "22px 0 18px" }}>{p.title}</h1>
          <p className="lede">{p.summary}</p>
        </div>
      </section>
      <div className="wrap doc">
        <aside aria-label="Contents">
          <p className="eyebrow" style={{ marginBottom: 12 }}>Contents</p>
          <ol>
            {p.sections.map((s) => (
              <li key={s.h}><a href={`#${anchor(s.h)}`}>{s.h}</a></li>
            ))}
          </ol>
          <p className="small" style={{ marginTop: 22 }}>Questions? <a className="link" href={`mailto:${CONTACT_EMAIL}`} style={{ border: 0 }}>{CONTACT_EMAIL}</a></p>
        </aside>
        <article>
          <div className="draft" role="note">{DRAFT_NOTICE}</div>
          {p.sections.map((s) => (
            <div key={s.h}>
              <h2 id={anchor(s.h)}>{s.h}</h2>
              {s.p.map((para, i) => (<p key={i}>{para}</p>))}
            </div>
          ))}
        </article>
      </div>
      <SiteFooter />
    </>
  );
}
