import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../components/site";
import { HeroCarousel, NearMeButton, PlaceLine } from "../components/hero";
import { EtaChip, StoreSorter } from "../components/location";
import { PayScreen, TrackingScreen } from "../components/screens";
import { JoinCard, MerchantCard } from "../components/merchant";
import { FoodImage, PlateArt, type Recipe } from "../components/plate";
import { fc, favourites, MERCHANTS } from "../lib/catalogue";
import fees from "@tunakula/ts-contracts/published/fee-comparison.json";

const CRAVINGS: [string, Recipe, string][] = [
  ["Moambe", "moambe", "moambe"],
  ["Pondu & greens", "pondu", "pondu"],
  ["Brochettes", "brochettes", "brochettes"],
  ["Fish", "liboke", "poisson"],
  ["Plantain", "makemba", "makemba"],
  ["Bread & beignets", "beignets", "mikate"],
  ["Fresh juice", "jus", "gingembre"],
  ["Groceries", "fruits", "fruit"],
];


export default function Home() {
  const picks = favourites(8);
  return (
    <>
      <SiteNav current="/" />

      <section className="m-hero">
        <div className="wrap">
          <HeroCarousel
            labels={["Food near you", "Send a meal home", "For restaurants", "For riders"]}
            slides={[
              <div key="food" className="hs hs-food">
                <div className="hs-copy">
                  <p className="eyebrow light"><b>Kinshasa</b> · 24 communes · francs or dollars</p>
                  <h1 className="display">Hungry, <em>Kinshasa?</em></h1>
                  <p className="hs-lede">Moambe, pondu, brochettes off the grill and bread still warm, from the kitchens you already love. See how far each one is and when it reaches you.</p>
                  <div className="hs-actions">
                    <NearMeButton className="btn navy">Find food near me</NearMeButton>
                    <a className="btn ghost-light" href="/order/">Browse all</a>
                  </div>
                </div>
                <div className="hs-art" aria-hidden>
                  <PlateArt className="hp hp-main" recipe="moambe" seed="hero" />
                  <PlateArt className="hp hp-a" recipe="brochettes" seed="hero" />
                  <PlateArt className="hp hp-b" recipe="pondu" seed="hero" />
                  <PlateArt className="hp hp-c" recipe="jus" seed="hero" />
                  <PlateArt className="hp hp-d" recipe="makemba" seed="hero" />
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
            <span><b>M-Pesa, Orange Money, Airtel Money</b> or card.</span>
            <span><b>A code at your door.</b> Your food reaches you, not a neighbour.</span>
          </div>
        </div>
      </section>

      <section className="tight crave-sec">
        <div className="wrap">
          <h2 className="sec-title">What are you craving?</h2>
          <nav className="crave" aria-label="Cravings">
            {CRAVINGS.map(([label, recipe, q]) => (
              <Link key={label} href={`/order/?q=${encodeURIComponent(q)}`} data-reveal>
                <PlateArt className="crave-pic" recipe={recipe} seed={`crave-${q}`} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="tight" id="near">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2 className="sec-title">Near you</h2>
              <PlaceLine />
            </div>
            <Link className="link" href="/order/">See everything</Link>
          </div>
          <StoreSorter scope="home" />
          <div className="mgrid" data-scope="home">
            {MERCHANTS.map((m) => <MerchantCard key={m.slug} m={m} />)}
            <JoinCard />
          </div>
        </div>
      </section>

      <section className="tight">
        <div className="wrap">
          <div className="sec-head">
            <h2 className="sec-title">Popular dishes</h2>
            <Link className="link" href="/order/">Browse menus</Link>
          </div>
          <div className="fav-grid">
            {picks.map(({ merchant: m, item }) => (
              <Link key={`${m.slug}-${item.id}`} className="fav" href={`/r/${m.slug}/`} data-reveal>
                <div className="fav-pic" style={{ background: m.tone.bg }}>
                  <FoodImage slug={item.id} recipe={item.recipe} alt={item.name} className="pic" />
                  <span className="fav-add" aria-hidden>+</span>
                </div>
                <h3>{item.name}</h3>
                <p className="muted">{m.name} · {m.commune}</p>
                <p className="fav-foot"><b className="num">{fc(item.price)}</b></p>
                <EtaChip slug={m.slug} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap split">
          <div className="stack">
            <h2 className="display">Order in three taps. <em>Follow it to your gate.</em></h2>
            <ol className="steps3">
              <li><b>Choose your food.</b> Every dish at the kitchen&rsquo;s counter price, with the service charge as its own line.</li>
              <li><b>Pay on your phone.</b> M-Pesa, Orange Money, Airtel Money or card, in francs or dollars, with the total in front of you before you approve.</li>
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
