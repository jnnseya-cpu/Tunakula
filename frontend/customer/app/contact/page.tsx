import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";
import { CONTACT_EMAIL } from "../../lib/site";

export const metadata: Metadata = { title: "Contact Tunakula", description: "How to reach Tunakula — one inbox for every enquiry, in-app help for live orders, and the right route for customers, kitchens, riders and chefs.", alternates: { canonical: "/contact/" } };

/** Each route points to the fastest way to get that kind of help; everything also reaches the single inbox. */
const ROUTES: { title: string; body: string; cta?: { label: string; href: string } }[] = [
  { title: "A live order", body: "Open the order and tap Help — chat reaches support with the order already attached, so nothing needs explaining twice. Refunds for a failed delivery or a missing item are automatic.", cta: { label: "My orders", href: "/orders/" } },
  { title: "Restaurants & shops", body: "Want to sell on Tunakula with 0% commission? Start your storefront online and you can take orders within 48 hours.", cta: { label: "For restaurants", href: "/restaurants/" } },
  { title: "Riders & fleets", body: "Ride with Tunakula and get paid the same day. Sign up from your phone — you always see what a job pays before you accept.", cta: { label: "Ride with us", href: "/riders/" } },
  { title: "Chefs", body: "Cook privately through Book a chef: set your own fee, keep every franc of it, and let customers book you for dinners, meal prep, events, classes or advice.", cta: { label: "Offer your cooking", href: "/chefs/#offer" } },
];

export default function Contact() {
  return (
    <>
      <SiteNav current="/contact/" />
      <section className="hero" style={{ paddingBottom: 72 }}>
        <div className="wrap head-row" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow"><b>Contact</b></p>
            <h1 className="display" style={{ marginTop: 26 }}>Talk to <em>a person.</em></h1>
          </div>
          <p className="lede">One inbox for every enquiry, request and report. For anything about a live order, in-app chat is fastest — it already knows which order you mean.</p>
        </div>
      </section>

      <section className="tight">
        <div className="wrap">
          <div className="sec-head">
            <h2 className="sec-title">Email us</h2>
          </div>
          <p className="lede" style={{ maxWidth: "34em" }}>
            Write to <a className="link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and a person answers — complaints, data requests, press, partnerships, safety reports, anything. We reply within one business day. If your message is about an order, include the order number.
          </p>
          <p className="muted" style={{ marginTop: 18, maxWidth: "40em" }}>
            Prefer the phone? Open your order and tap Help to start a chat; our team can call you back on the number on your account. The company that provides Tunakula in your country, its registration number and its registered address are listed in the <Link className="link" href="/legal/legal-notice/">Legal notice</Link>.
          </p>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2 className="sec-title">The quickest route</h2>
              <p className="muted">Everything below also reaches the inbox — these are just faster for that kind of help.</p>
            </div>
          </div>
          <div className="contact-grid">
            {ROUTES.map((r) => (
              <div className="contact-card" key={r.title}>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                {r.cta ? <p style={{ marginTop: 14 }}><Link className="link" href={r.cta.href}>{r.cta.label}</Link></p> : null}
              </div>
            ))}
          </div>
          <p className="footnote" style={{ marginTop: 28 }}>Questions about the rules — pricing, refunds, reviews, your data? Every policy is written plainly in <Link className="link" href="/legal/">Policies and terms</Link>.</p>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
