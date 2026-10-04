import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";
import { CONTACT_EMAIL } from "../../lib/site";

export const metadata: Metadata = { title: "About Tunakula", alternates: { canonical: "/about/" } };

const BELIEFS: [string, string][] = [
  ["Money is sacred.", "Every franc is counted in whole units, recorded twice in a ledger that can't be edited, and never held by us. If a number is wrong, we can prove where it went."],
  ["Kitchens keep what they cook.", "No commission, on any channel. A platform funded by the restaurant's margin ends up in the menu price; ours is a visible line on your bill instead."],
  ["Built for how people live here.", "Mobile money before cards. Landmarks before postcodes. Cheap phones, costly data and patchy networks are the starting point, not an afterthought."],
  ["Fair to the people who carry the food.", "Riders see what a job pays before accepting, keep 70% of the fee, are paid the same day, and are never punished for saying no."],
];

export default function About() {
  return (
    <>
      <SiteNav current="/about/" />
      <section className="hero" style={{ paddingBottom: 96 }}>
        <div className="wrap head-row" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow"><b>About</b></p>
            <h1 className="display" style={{ marginTop: 26 }}><em>Tunakula</em> — we are eating.</h1>
          </div>
          <p className="lede">The name is Swahili for &ldquo;we are eating&rdquo;: a meal shared, in the present tense. Tunakula is a food ordering and delivery platform from Groupe Nseya, built first for Kinshasa and for the families abroad who still eat with it in mind.</p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">01</span><span className="eyebrow">What we believe</span></div>
              <h2 className="display">Four rules we don&rsquo;t bend.</h2>
            </div>
            <p className="lede">They are written into how the platform works — the ledger, the prices, the ratings — not into a slogan.</p>
          </div>
          <div className="menu-board" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {[BELIEFS.slice(0, 2), BELIEFS.slice(2)].map((col, i) => (
              <div className="col" key={i}>
                {col.map(([h, p]) => (
                  <div key={h} style={{ padding: "18px 0 26px", borderBottom: "1px solid var(--rule)" }}>
                    <div className="kitchen" style={{ fontSize: 32 }}>{h}</div>
                    <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: 17 }}>{p}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap split even">
          <div className="stack">
            <div className="kicker"><span className="n">02</span><span className="eyebrow">The road</span></div>
            <h2 className="display">Built on NZELA-OS.</h2>
            <p className="lede"><i>Nzela</i> is Lingála for road. NZELA-OS is the platform underneath Tunakula: one system for every country, currency and brand, where a new market is a matter of configuration — its currencies, payment methods, addresses, languages and laws — rather than a new build.</p>
          </div>
          <ul className="ticks">
            <li>Kinshasa first, commune by commune.</li>
            <li>Then the corridors: London, Paris and Brussels, where families send meals home.</li>
            <li>Any market after that, in its own currency and language.</li>
          </ul>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap split even">
          <div className="stack">
            <div className="kicker"><span className="n">03</span><span className="eyebrow">Talk to us</span></div>
            <h2 className="display">One inbox, read by people.</h2>
            <p className="lede">Customers, restaurants, riders, press, partners and privacy requests all reach us at the same address.</p>
          </div>
          <div style={{ justifySelf: "start" }}>
            <a className="display" href={`mailto:${CONTACT_EMAIL}`} style={{ fontSize: "clamp(36px, 4.4vw, 60px)", borderBottom: "1px solid var(--ink)" }}>{CONTACT_EMAIL}</a>
            <p className="small" style={{ marginTop: 18 }}>Policies and company details: <Link className="link" href="/legal/" style={{ borderBottom: 0 }}>Legal</Link></p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
