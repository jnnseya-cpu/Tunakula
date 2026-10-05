import type { Metadata } from "next";
import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../../components/site";
import { JobOfferScreen } from "../../components/screens";
import ladder from "@tunakula/ts-contracts/published/rider-ladder.json";

export const metadata: Metadata = { title: "Ride with Tunakula" };

// The same file the backend test checks against the pricing engine, so these figures cannot drift from what riders are paid.
const LADDER: [string, string, string, string][] = ladder.rows.map((r) => [r.label, r.fee, r.rider, r.rider_rural]);

export default function Riders() {
  return (
    <>
      <SiteNav current="/riders/" />
      <section className="hero">
        <div className="wrap split">
          <div className="copy">
            <p className="eyebrow"><b>Moto, bicycle, car or on foot</b></p>
            <h1 className="display">Paid today. <em>Into your own wallet.</em></h1>
            <p className="lede">
              You keep 70% of every delivery fee and all of your tips, sent to M-Pesa, Orange Money or Airtel Money the same
              day. You see what a job pays before you take it — and turning one down never costs you the next.
            </p>
            <div className="cta-row" style={{ marginTop: 34 }}>
              <Link className="btn accent" href="/riders/apply/">Apply to ride</Link>
              <Link className="btn light" href="/riders/">For fleet owners</Link>
            </div>
          </div>
          <div className="stage" style={{ height: 600 }}>
            <Phone className="p2"><JobOfferScreen /></Phone>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">01</span><span className="eyebrow">What you earn</span></div>
              <h2 className="display">The longer the trip, the more you keep.</h2>
            </div>
            <p className="lede">The fee rises with distance and steps up 30% for every 8 km beyond 7 km. When it rains or demand spikes, the fee rises and your 70% rises with it. Rural deliveries are priced at 75% of the city fee.</p>
          </div>
          <div className="table-scroll">
            <table className="ledger">
              <thead><tr><th>Distance</th><th>Customer pays (city)</th><th>You receive (city)</th><th>You receive (rural)</th></tr></thead>
              <tbody>
                {LADDER.map(([d, fee, you, rural]) => (
                  <tr key={d} className="us"><td>{d}</td><td>{fee}</td><td style={{ fontWeight: 650 }}>{you}</td><td>{rural}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">Amounts in US dollars; each market publishes its own values. Tips are 100% yours and never count toward a bonus or a minimum.</p>
        </div>
      </section>

      <section>
        <div className="wrap split even" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="kicker"><span className="n">02</span><span className="eyebrow">How we treat you</span></div>
            <h2 className="display">Rules written down, and the same for everyone.</h2>
          </div>
          <ul className="ticks">
            <li>Decline any job. Your decline rate is never used for pay, ranking or the jobs you&rsquo;re offered.</li>
            <li>A 10% weekly bonus on your own earnings, for published criteria any rider working normal hours can meet.</li>
            <li>Late because the kitchen was slow, or the address was wrong? It doesn&rsquo;t count against you.</li>
            <li>Customers never see a star rating of you. Your scores are yours, with the reasons and how to improve.</li>
            <li>An emergency button, trip sharing and masked phone numbers on every job.</li>
            <li>Ride on your own or with a fleet partner. Either way, you&rsquo;re paid on the same rules.</li>
          </ul>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">03</span><span className="eyebrow">Getting started</span></div>
              <h2 className="display">All from your phone. No office, no queue.</h2>
            </div>
            <p className="lede">Bring your ID, your licence where you need one, and your vehicle. Training is short, in your language, and you can stop and resume any time.</p>
          </div>
          <ol className="flow">
            <li><h4>Your ID and a selfie</h4><p>Checked in minutes, matched to your face.</p></li>
            <li><h4>Your vehicle</h4><p>Photos of the vehicle, plate and papers, taken in the app.</p></li>
            <li><h4>Your wallet</h4><p>The account must be in your name. We send a small test payment.</p></li>
            <li><h4>Train, then ride</h4><p>Food handling, safety and handovers — then your first deliveries.</p></li>
          </ol>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
