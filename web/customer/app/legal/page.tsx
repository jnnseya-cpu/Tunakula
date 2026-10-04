import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";
import { POLICY_GROUPS } from "../../lib/legal";
import { CONTACT_EMAIL } from "../../lib/site";

export const metadata: Metadata = { title: "Policies and terms", alternates: { canonical: "/legal/" } };

export default function Legal() {
  return (
    <>
      <SiteNav current="/legal/" />
      <section className="tight">
        <div className="wrap head-row" style={{ marginBottom: 56 }}>
          <div>
            <p className="eyebrow"><b>Policies and terms</b></p>
            <h1 className="display" style={{ fontSize: "clamp(48px, 6vw, 88px)", marginTop: 22 }}>The rules, <em>written plainly.</em></h1>
          </div>
          <p className="lede">Every policy describes how Tunakula actually works — what you pay, who gets what, how ratings are counted and what happens to your data. Questions about any of them: <a className="link" href={`mailto:${CONTACT_EMAIL}`} style={{ borderBottom: 0 }}>{CONTACT_EMAIL}</a></p>
        </div>
        <div className="wrap policy-index">
          {POLICY_GROUPS.map((g) => (
            <div className="col" key={g.title}>
              <h3>{g.title}</h3>
              {g.policies.map((p) => (
                <Link key={p.slug} href={`/legal/${p.slug}/`}>
                  <b>{p.title}</b>
                  <span>{p.audience}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
