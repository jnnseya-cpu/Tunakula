import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";

export const metadata: Metadata = { title: "How it works", alternates: { canonical: "/how-it-works/" } };

const CUSTODY: [string, string][] = [
  ["Checked at placement", "Prices, stock and options are confirmed by our servers before you pay — never trusted from the app — so an order can't be placed for something the kitchen doesn't have."],
  ["Packed against a list", "The kitchen ticks every line, counts the bags, labels and seals each one and photographs the sealed order. Allergen requirements must be acknowledged before packing."],
  ["Scanned at pickup", "The rider scans each bag. A bag from another order, or a rider who wasn't assigned, is refused on the spot."],
  ["Verified at your door", "The rider scans your bag again and asks for your code. Outside the delivery area, the drop needs a reason and is reviewed."],
];

export default function HowItWorks() {
  return (
    <>
      <SiteNav current="/how-it-works/" />
      <section className="hero" style={{ paddingBottom: 88 }}>
        <div className="wrap head-row" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow"><b>How it works</b></p>
            <h1 className="display" style={{ marginTop: 26 }}>From the pot <em>to your door,</em> checked at every hand.</h1>
          </div>
          <p className="lede">Four people touch your order: you, the kitchen, the rider and whoever opens the door. At each handover the system matches the bag to the order. If something can&rsquo;t be checked, it is recorded with a reason — it is never skipped.</p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">01</span><span className="eyebrow">Ordering</span></div>
              <h2 className="display">Five minutes, start to finish.</h2>
            </div>
            <p className="lede">In the app, on the web or by WhatsApp — in Lingála, French, Swahili or English.</p>
          </div>
          <ol className="flow">
            <li><h4>Choose</h4><p>Kitchens near your pin, with real delivery times and the kitchen&rsquo;s own prices.</p></li>
            <li><h4>Check the total</h4><p>Food, 10% service, delivery and total — in francs or dollars — before you pay.</p></li>
            <li><h4>Pay</h4><p>Approve the mobile-money prompt on your phone, or pay by card or wallet.</p></li>
            <li><h4>Track and receive</h4><p>Follow the rider; give your code at the door.</p></li>
          </ol>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">02</span><span className="eyebrow">Chain of custody</span></div>
              <h2 className="display">The right food, to the right person.</h2>
            </div>
            <p className="lede">The two failures that hurt most are the wrong food leaving the kitchen and the right food reaching the wrong person. This is how we prevent both.</p>
          </div>
          <div className="menu-board four">
            {CUSTODY.map(([h, p], i) => (
              <div className="col" key={h}>
                <div className="kicker"><span className="n">{String(i + 1).padStart(2, "0")}</span></div>
                <div className="kitchen" style={{ marginTop: 10 }}>{h}</div>
                <p style={{ marginTop: 12, color: "var(--ink-2)" }}>{p}</p>
              </div>
            ))}
          </div>
          <p className="footnote">Every order keeps its evidence — checklist, bag count, seal numbers, photos, scans and the handover — so a problem can be settled from facts, not argument.</p>
        </div>
      </section>

      <section>
        <div className="wrap split even" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="kicker"><span className="n">03</span><span className="eyebrow">Money</span></div>
            <h2 className="display">Who gets what, from every order.</h2>
            <p className="lede">The restaurant keeps the full price of the food. You pay a 10% service charge and a delivery fee by distance. The rider keeps 70% of that fee and all tips.</p>
            <p><Link className="link" href="/legal/pricing/">How pricing works</Link></p>
          </div>
          <ul className="ticks">
            <li>Licensed payment partners collect and settle every payment. Tunakula never holds your money.</li>
            <li>Paying from abroad? The rate and margin are shown first and held while you pay.</li>
            <li>Refunds are automatic when delivery fails or an item is missing — to your wallet instantly, or to your card or mobile money.</li>
            <li>Restaurants and riders are paid on schedule to accounts in their own names.</li>
          </ul>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap duo">
          <Link href="/restaurants/">
            <div className="eyebrow">For kitchens and shops</div>
            <h3 className="display" style={{ marginTop: 14 }}>Join online, take orders within 48 hours.</h3>
            <p style={{ marginTop: 18 }}><span className="link">For restaurants</span></p>
          </Link>
          <Link href="/riders/">
            <div className="eyebrow">For riders</div>
            <h3 className="display" style={{ marginTop: 14 }}>Sign up from your phone, paid the same day.</h3>
            <p style={{ marginTop: 18 }}><span className="link">Ride with us</span></p>
          </Link>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
