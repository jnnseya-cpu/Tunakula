import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../components/site";
import { HeroCarousel } from "../components/hero";
import { HeroFoodCopy } from "../components/hero-cms";
import { PayScreen, TrackingScreen } from "../components/screens";
import { PlateArt } from "../components/plate";
import { LiveMerchantGrid } from "../components/live";
import { MERCHANTS } from "../lib/catalogue";
import fees from "@tunakula/ts-contracts/published/fee-comparison.json";

// The LANDING page: what Tunakula is and why, with a clear way into the storefront. The actual
// browsing/ordering (restaurants, categories, trending, recommendations) lives in the storefront at
// /order — this page is marketing + the one "Start an order" door, not a shopping surface.
export default function Home() {
  return (
    <>
      <SiteNav current="/" />

      <section className="m-hero">
        <div className="wrap">
          <HeroCarousel
            labels={["Food near you", "Book a chef", "Send a meal home", "For restaurants", "For riders"]}
            slides={[
              <div key="food" className="hs hs-food">
                <HeroFoodCopy />
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="moambe" seed="hero" />
                  <PlateArt className="hp hp-a" recipe="brochettes" seed="hero" />
                  <PlateArt className="hp hp-b" recipe="pondu" seed="hero" />
                  <PlateArt className="hp hp-c" recipe="jus" seed="hero" />
                  <PlateArt className="hp hp-d" recipe="makemba" seed="hero" />
                </div>
              </div>,
              <div key="chef" className="hs hs-chef">
                <div className="hs-copy">
                  <p className="eyebrow light"><b>Private chefs in Kinshasa</b></p>
                  <h2 className="display">Book a chef to <em>your table.</em></h2>
                  <p className="hs-lede">A chef for a dinner at home, meal prep for the week, an event or a class — or a quick cooking consultation. The chef keeps every franc of their fee; you add our 10% service charge, nothing more.</p>
                  <div className="hs-actions"><a className="btn accent" href="/chefs/">Book a chef</a></div>
                </div>
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="moambe" seed="chef" />
                  <PlateArt className="hp hp-a" recipe="brochettes" seed="chef" />
                  <PlateArt className="hp hp-c" recipe="pondu" seed="chef2" />
                </div>
              </div>,
              <div key="send" className="hs hs-send">
                <div className="hs-copy">
                  <p className="eyebrow light"><b>From London, Paris or Brussels</b></p>
                  <h2 className="display">Send dinner home to <em>Maman.</em></h2>
                  <p className="hs-lede">Pay in pounds, euros or dollars. A Kinshasa kitchen cooks it, a rider brings it, she confirms with a code, and you get the photo.</p>
                  <div className="hs-actions"><a className="btn accent" href="/send-home/">Send a meal home</a></div>
                </div>
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="liboke" seed="send" />
                  <PlateArt className="hp hp-a" recipe="moambe" seed="send" />
                  <PlateArt className="hp hp-c" recipe="jus" seed="send2" />
                </div>
              </div>,
              <div key="merchants" className="hs hs-merchant">
                <div className="hs-copy">
                  <p className="eyebrow light"><b>Restaurants, malewa, bakeries, shops</b></p>
                  <h2 className="display"><em>0%</em> commission. Your prices.</h2>
                  <p className="hs-lede">Your own storefront, a till on the phone you already own, and every franc of your menu price.</p>
                  <div className="hs-actions"><a className="btn accent" href="/restaurants/">Open a storefront</a></div>
                </div>
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="brochettes" seed="m" />
                  <PlateArt className="hp hp-b" recipe="beignets" seed="m" />
                  <PlateArt className="hp hp-d" recipe="fruits" seed="m" />
                </div>
              </div>,
              <div key="riders" className="hs hs-rider">
                <div className="hs-copy">
                  <p className="eyebrow light"><b>Riders and fleets</b></p>
                  <h2 className="display">Ride today. <em>Get paid today.</em></h2>
                  <p className="hs-lede">See the distance and what you&rsquo;ll earn before you accept. Saying no never costs you jobs.</p>
                  <div className="hs-actions"><a className="btn accent" href="/riders/">Ride with Tunakula</a></div>
                </div>
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="pondu" seed="r" />
                  <PlateArt className="hp hp-a" recipe="poisson" seed="r" />
                </div>
              </div>,
            ]}
          />
          <div className="trust-row">
            <span><b>Counter prices.</b> Restaurants pay 0% commission.</span>
            <span><b>M-Pesa, Orange Money, Airtel Money, Afrimoney</b> or card.</span>
            <span><b>A code at your door.</b> Your food reaches you, not a neighbour.</span>
          </div>
          <div className="cta-row" style={{ marginTop: 22 }}>
            <Link className="btn accent wide" href="/order/">Start an order</Link>
            <Link className="link" href="/how-it-works/">How it works</Link>
          </div>
        </div>
      </section>

      <section className="tight" id="near">
        <div className="wrap">
          <div className="sec-head">
            <h2 className="sec-title">Popular near you</h2>
            <Link className="link" href="/order/">See everything</Link>
          </div>
          <div className="mgrid" data-scope="home">
            <LiveMerchantGrid fallback={MERCHANTS.slice(0, 6)} />
          </div>
        </div>
      </section>

      <section>
        <div className="wrap split">
          <div className="stack">
            <h2 className="display">Order in three taps. <em>Follow it to your gate.</em></h2>
            <ol className="steps3">
              <li><b>Choose your food.</b> Every dish at the kitchen&rsquo;s counter price, with the service charge as its own line.</li>
              <li><b>Pay on your phone.</b> M-Pesa, Orange Money, Airtel Money, Afrimoney or card, in francs or dollars, with the total in front of you before you approve.</li>
              <li><b>Meet your rider.</b> Watch them on the map. Give your four-digit code at the door, and only then is it delivered.</li>
            </ol>
            <div className="cta-row"><Link className="btn accent" href="/order/">Start an order</Link><Link className="link" href="/how-it-works/">How it works</Link></div>
          </div>
          <div className="stage" style={{ position: "relative", height: 640, overflow: "hidden" }}>
            <Phone className="p1"><TrackingScreen /></Phone>
            <Phone className="p2"><PayScreen /></Phone>
          </div>
        </div>
      </section>

      <section className="tight chef-promo">
        <div className="wrap split even" style={{ alignItems: "center" }}>
          <div className="stack">
            <p className="eyebrow"><b>New</b> · Book a chef</p>
            <h2 className="display">Not just delivery. <em>A chef at your table.</em></h2>
            <p className="lede">Book an approved private chef for a dinner at home, meal prep, an event or a class — or get a quick cooking consultation. You see the full quote first: the chef&rsquo;s fee plus our 10% service charge. The chef keeps every franc of their fee.</p>
            <ol className="steps3">
              <li><b>Choose a chef and what you want.</b> Browse approved chefs by cuisine and commune, and pick advice, a private dinner, meal prep, an event or a class.</li>
              <li><b>See the quote, request a date.</b> Guests and hours set the price; the chef&rsquo;s fee and the 10% service charge are shown as separate lines before you request.</li>
              <li><b>The chef confirms.</b> They accept your date, cook, and the booking settles the same way every order does — 0% commission, the chef paid in full.</li>
            </ol>
            <div className="cta-row"><Link className="btn accent" href="/chefs/">Book a chef</Link><Link className="link" href="/chefs/#offer">Offer your cooking</Link></div>
          </div>
          <div className="chef-cards" aria-hidden>
            <div className="chef-card">
              <PlateArt className="chef-card-pic" recipe="moambe" seed="promo-a" />
              <div className="chef-card-body">
                <b>Private dining</b>
                <span className="muted">Congolese fine dining, cooked in your home</span>
                <span className="chef-card-price">from <b className="num">$30</b> / guest</span>
              </div>
            </div>
            <div className="chef-card">
              <PlateArt className="chef-card-pic" recipe="jus" seed="promo-b" />
              <div className="chef-card-body">
                <b>Menu planning call</b>
                <span className="muted">A remote consultation with a chef</span>
                <span className="chef-card-price"><b className="num">$15</b> fixed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="tight">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2 className="sec-title">Why the same meal costs you less</h2>
              <p className="muted">Restaurants pay us nothing, so they keep their counter prices. You see our 10% service charge as its own line.</p>
            </div>
            <Link className="link" href="/legal/pricing/">How pricing works</Link>
          </div>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr><th>The same {fees.goods} of food, 3 km away</th><th>Food</th><th>Delivery</th><th>Service</th><th>You pay</th><th>Restaurant keeps</th></tr>
              </thead>
              <tbody>
                <tr className="us total"><td>Tunakula — 0% commission</td><td>{fees.tunakula.menu}</td><td>{fees.tunakula.delivery}</td><td>{fees.tunakula.service}</td><td>{fees.tunakula.customer_pays}</td><td>{fees.tunakula.restaurant_keeps}</td></tr>
                {fees.competitors.map((c) => (
                  <tr className="them" key={c.label}><td>{c.label}</td><td>{c.menu}</td><td>—</td><td>—</td><td>{c.customer_pays}</td><td>{c.restaurant_keeps}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">Amounts in US dollars. Competitor rows illustrate common market practice, not any company&rsquo;s quoted terms, and assume the same delivery fee and service charge on the raised menu.</p>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap duo">
          <Link href="/restaurants/">
            <div className="big num">0%</div>
            <h3 className="display">Sell your food on Tunakula.</h3>
            <p className="lede">Restaurants, malewa, bakeries and shops: no commission on any order, a till on the phone you already own, your own storefront.</p>
            <p style={{ marginTop: 22 }}><span className="link">For restaurants and shops</span></p>
          </Link>
          <Link href="/riders/">
            <div className="big num">Today.</div>
            <h3 className="display">Ride, and get paid the same day.</h3>
            <p className="lede">You see what you&rsquo;ll earn before you accept. Saying no never costs you jobs.</p>
            <p style={{ marginTop: 22 }}><span className="link">Ride with Tunakula</span></p>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
