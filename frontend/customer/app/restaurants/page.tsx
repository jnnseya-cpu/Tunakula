import type { Metadata } from "next";
import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../../components/site";
import { PosScreen, Receipt } from "../../components/screens";
import fees from "@tunakula/ts-contracts/published/fee-comparison.json";

export const metadata: Metadata = { title: "For restaurants and shops" };

const TEAM = [
  ["Owner", "Everything, including payouts and closing the account. Always at least one."],
  ["Manager", "Runs a branch: staff, shifts, voids and refunds at the till — only for their branch."],
  ["Cashier", "Takes orders and payment. Can't discount, void or see payouts."],
  ["Kitchen", "Accepts, prepares and hands over. Nothing else on the screen."],
  ["Accountant", "Sales and payouts across every branch. No access to orders."],
];

export default function Restaurants() {
  return (
    <>
      <SiteNav current="/restaurants/" />
      <section className="hero">
        <div className="wrap split">
          <div className="copy">
            <p className="eyebrow"><b>Restaurants, supermarkets, pharmacies, shops</b></p>
            <h1 className="display">Keep every franc <em>you cook for.</em></h1>
            <p className="lede">
              Tunakula charges restaurants nothing on any order — online, at your counter or at a QR table. Customers pay a
              visible service charge instead, so you never have to raise your menu to pay us.
            </p>
            <div className="cta-row" style={{ marginTop: 34 }}>
              <Link className="btn accent" href="/restaurants/">Join in 48 hours</Link>
              <Link className="btn light" href="/restaurants/">See the till</Link>
            </div>
          </div>
          <div className="stage" style={{ height: 600 }}>
            <Phone className="p2"><PosScreen /></Phone>
            <div style={{ position: "absolute", left: -56, bottom: -24, zIndex: 2, transform: "scale(0.86)", transformOrigin: "bottom left" }}><Receipt /></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">01</span><span className="eyebrow">The arithmetic</span></div>
              <h2 className="display">Same dish. More of it is yours.</h2>
            </div>
            <p className="lede">On a 20.00 order, a 25–30% commission takes 5.00 to 6.00 from you, so menus go up to win some of it back — and your customer pays for that. On Tunakula you keep the full 20.00, and your customer still pays less.</p>
          </div>
          <div className="table-scroll">
            <table className="ledger">
              <thead><tr><th>Per {fees.goods} order</th><th>Your menu price</th><th>Commission</th><th>You receive</th><th>Customer pays</th></tr></thead>
              <tbody>
                <tr className="us total"><td>Tunakula</td><td>{fees.tunakula.menu}</td><td>{fees.tunakula.commission}</td><td>{fees.tunakula.restaurant_keeps}</td><td>{fees.tunakula.customer_pays}</td></tr>
                {fees.competitors.map((c) => (
                  <tr className="them" key={c.label}><td>{c.short_label}</td><td>{c.menu}</td><td>{c.commission}</td><td>{c.restaurant_keeps}</td><td>{c.customer_pays}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">Competitor rows illustrate common market practice, not any company&rsquo;s quoted terms, and assume the same delivery fee and service charge on the raised menu. In return, we ask that your Tunakula prices match your counter prices.</p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">02</span><span className="eyebrow">One business, three doors</span></div>
              <h2 className="display">Delivery, counter and table — one menu, one stock.</h2>
            </div>
            <p className="lede">Change a price once and it&rsquo;s right everywhere. Sell the last liboke at the counter and the app stops offering it. Every sale lands in the same reports and the same payout.</p>
          </div>
          <div className="menu-board">
            {[
              ["Online", "App, website and WhatsApp orders, delivered by our riders or collected by the customer."],
              ["Your counter", "A till on the phone or tablet you already own. Cash, mobile money, split bills. Works offline."],
              ["The table", "Customers scan a QR code, order and pay from their own phone. No hardware to buy."],
            ].map(([h, p]) => (
              <div className="col" key={h}>
                <div className="kitchen">{h}</div>
                <p style={{ marginTop: 14, color: "var(--ink-2)" }}>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap split even" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="kicker"><span className="n">03</span><span className="eyebrow">Your team</span></div>
            <h2 className="display">Everyone gets the right keys — no more.</h2>
            <p className="lede">Add as many people as you need. Give each a role, limit them to one branch, or build your own role. A manager can add kitchen staff to their branch but can never make themselves an owner.</p>
          </div>
          <ul className="ticks">
            {TEAM.map(([role, what]) => (
              <li key={role}><b>{role}.</b> <span style={{ color: "var(--ink-2)" }}>{what}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">04</span><span className="eyebrow">Joining</span></div>
              <h2 className="display">From download to first order, without a visit.</h2>
            </div>
            <p className="lede">Most kitchens are taking orders within two days. Nobody comes to inspect you, so we check what we can see: your documents, photos taken inside the app, and a first order we watch closely.</p>
          </div>
          <ol className="flow">
            <li><h4>Sign up with your phone</h4><p>Name, cuisine and a pin on your door.</p></li>
            <li><h4>Show who you are</h4><p>RCCM or registration, your ID and a quick selfie.</p></li>
            <li><h4>Photos from the app</h4><p>Storefront, sign and kitchen — taken live, not uploaded.</p></li>
            <li><h4>Menu from a photo</h4><p>Photograph your menu; check the draft; publish.</p></li>
          </ol>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap split even">
          <div className="stack">
            <div className="kicker"><span className="n">05</span><span className="eyebrow">Your name on every ticket</span></div>
            <h2 className="display">Your logo and ours, on everything we print.</h2>
            <p className="lede">Receipts, bag labels, kitchen tickets and statements carry both logos. Upload yours once from your profile; until you do, your name prints in its place.</p>
          </div>
          <div style={{ justifySelf: "center" }}><Receipt /></div>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
