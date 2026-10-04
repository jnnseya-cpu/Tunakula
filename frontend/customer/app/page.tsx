import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../components/site";
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

const AREAS = ["Gombe", "Limete", "Bandalungwa", "Ngaliema", "Kintambo", "Lingwala", "Kalamu", "Lemba"];

export default function Home() {
  const picks = favourites(8);
  return (
    <>
      <SiteNav current="/" />

      <section className="hero-food">
        <div className="wrap hf-grid">
          <div className="hf-copy">
            <p className="eyebrow light"><b>Kinshasa</b> · 24 communes · francs or dollars</p>
            <h1 className="display">Hungry, <em>Kinshasa?</em></h1>
            <p className="hf-lede">Moambe, pondu, brochettes off the grill and bread still warm, from the kitchens you already love, at your gate in about 30 minutes.</p>
            <form className="where" action="/order/" method="get" role="search">
              <label>
                <span className="sr">Where should we deliver?</span>
                <span className="pin" aria-hidden />
                <input name="q" placeholder="Your commune, avenue or a landmark" autoComplete="street-address" />
              </label>
              <button className="btn accent" type="submit">Find food</button>
            </form>
            <p className="areas">
              <span>Popular:</span>
              {AREAS.map((a) => <Link key={a} href={`/order/?q=${encodeURIComponent(a)}`}>{a}</Link>)}
            </p>
          </div>
          <div className="hf-table" aria-hidden>
            <PlateArt className="hp hp-main" recipe="moambe" seed="hero" />
            <PlateArt className="hp hp-a" recipe="brochettes" seed="hero" />
            <PlateArt className="hp hp-b" recipe="pondu" seed="hero" />
            <PlateArt className="hp hp-c" recipe="jus" seed="hero" />
            <PlateArt className="hp hp-d" recipe="makemba" seed="hero" />
          </div>
        </div>
        <div className="wrap hf-trust">
          <span><b>Counter prices.</b> Restaurants pay 0% commission.</span>
          <span><b>M-Pesa, Orange Money, Airtel Money</b> or card.</span>
          <span><b>A code at your door.</b> Your food reaches you, not a neighbour.</span>
        </div>
      </section>

      <section className="tight crave-sec">
        <div className="wrap">
          <h2 className="sec-title">What are you craving?</h2>
          <nav className="crave" aria-label="Cravings">
            {CRAVINGS.map(([label, recipe, q]) => (
              <Link key={label} href={`/order/?q=${encodeURIComponent(q)}`}>
                <PlateArt className="crave-pic" recipe={recipe} seed={`crave-${q}`} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="tight">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2 className="sec-title">Popular in Kinshasa tonight</h2>
              <p className="muted">Sample kitchens and shops: this is how storefronts will look at launch.</p>
            </div>
            <Link className="link" href="/order/">See everything</Link>
          </div>
          <div className="mgrid">
            {MERCHANTS.map((m) => <MerchantCard key={m.slug} m={m} />)}
            <JoinCard />
          </div>
        </div>
      </section>

      <section className="tight">
        <div className="wrap">
          <div className="sec-head">
            <h2 className="sec-title">Dishes people order again and again</h2>
            <Link className="link" href="/order/">Browse menus</Link>
          </div>
          <div className="fav-grid">
            {picks.map(({ merchant: m, item }) => (
              <Link key={`${m.slug}-${item.id}`} className="fav" href={`/r/${m.slug}/`}>
                <div className="fav-pic" style={{ background: m.tone.bg }}>
                  <FoodImage slug={`${m.slug}-${item.id}`} recipe={item.recipe} alt={item.name} className="pic" />
                  <span className="fav-add" aria-hidden>+</span>
                </div>
                <h3>{item.name}</h3>
                <p className="muted">{m.name} · {m.commune}</p>
                <p className="fav-foot"><b className="num">{fc(item.price)}</b><span>{m.eta}</span></p>
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

      <section className="send-band">
        <div className="wrap split">
          <div className="stack">
            <p className="eyebrow light"><b>From London, Paris or Brussels</b></p>
            <h2 className="display">Send dinner home to <em>Maman.</em></h2>
            <p className="lede">Pay in pounds, euros or dollars. The kitchen in Kinshasa cooks it, a rider brings it, she confirms with a code, and you get the photo.</p>
            <div className="cta-row"><Link className="btn accent" href="/send-home/">Send a meal home</Link></div>
          </div>
          <div className="send-plates" aria-hidden>
            <PlateArt className="sp sp1" recipe="moambe" seed="send" />
            <PlateArt className="sp sp2" recipe="liboke" seed="send" />
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
