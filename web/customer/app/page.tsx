import Link from "next/link";
import { Phone, SiteFooter, SiteNav } from "../components/site";
import { PayScreen, TrackingScreen } from "../components/screens";

const KITCHENS = [
  {
    name: "Chez Mama Pauline",
    where: "Gombe · open until 23:00 · 25–35 min",
    dishes: [
      ["Poulet à la moambe", "16 000 FC", "with rice or chikwangue"],
      ["Pondu na makayabu", "9 000 FC", "cassava leaves, salted fish"],
      ["Liboke ya mbisi", "18 000 FC", "river fish steamed in leaves"],
    ],
  },
  {
    name: "Malewa ya Limete",
    where: "Limete · 7e rue · 20–30 min",
    dishes: [
      ["Fumbwa ya ngolo", "8 000 FC", "wild spinach, peanut, catfish"],
      ["Makemba na ndunda", "6 000 FC", "plantain and beans"],
      ["Sombe na loso", "7 000 FC", "", "vegan"],
    ],
  },
  {
    name: "Brochettes Kintambo",
    where: "Kintambo Magasin · 30–40 min",
    dishes: [
      ["Brochettes de chèvre ×4", "12 000 FC", "pili-pili on the side"],
      ["Mbika ya ngulu", "10 000 FC", "pumpkin-seed cake"],
      ["Jus de gingembre", "2 000 FC", "made this morning", "halal"],
    ],
  },
];

export default function Home() {
  return (
    <>
      <SiteNav current="/" />

      <section className="hero">
        <div className="wrap split">
          <div className="copy">
            <p className="eyebrow">
              <b>Kinshasa</b> &nbsp;·&nbsp; 24 communes &nbsp;·&nbsp; FC or USD
            </p>
            <h1 className="display">
              The food of Kinshasa, at your door — <em>or your mother&rsquo;s.</em>
            </h1>
            <p className="lede">
              Order from the kitchens you already know, pay with M-Pesa, Orange Money or Airtel Money, and describe
              your address the way Kinshasa does: <i>the blue gate after the Total station.</i>
            </p>
            <div className="cta-row" style={{ marginTop: 34 }}>
              <Link className="btn accent" href="/">Order now</Link>
              <Link className="btn light" href="/send-home/">Send a meal home</Link>
            </div>
            <p className="small" style={{ marginTop: 22 }}>Also on WhatsApp — write in Lingála, French, Swahili or English.</p>
          </div>
          <div className="stage">
            <Phone className="p1"><TrackingScreen /></Phone>
            <Phone className="p2"><PayScreen /></Phone>
            <p className="note">Every price before you pay — in the currency you hold.</p>
          </div>
        </div>
      </section>

      <div className="wrap facts">
        <div>
          <div className="big num"><em>0</em>%</div>
          <p>Commission charged to restaurants. They keep every franc of the menu price — so the menu price stays honest.</p>
        </div>
        <div>
          <div className="big">FC · $</div>
          <p>Prices, wallet and payment in Congolese francs or US dollars, with the rate shown and held while you pay.</p>
        </div>
        <div>
          <div className="big num">70%</div>
          <p>Of every delivery fee goes to the rider, paid to their mobile wallet the same day.</p>
        </div>
        <div>
          <div className="big num">4 821</div>
          <p>Your handover code. Nothing is marked delivered until the right person has the right bag.</p>
        </div>
      </div>

      <section>
        <div className="wrap split even">
          <div className="stack">
            <div className="kicker"><span className="n">01</span><span className="eyebrow">Addresses that work here</span></div>
            <h2 className="display">A landmark, a pin and your own voice.</h2>
            <p className="lede">
              Most of Kinshasa doesn&rsquo;t live on a numbered street, and nobody should have to pretend it does. Drop a pin,
              name the landmark, record twelve seconds of directions. Riders hear you, not a guess.
            </p>
            <p className="small">The platform learns from every delivery, so &ldquo;near Stade des Martyrs&rdquo; gets more precise each week.</p>
          </div>
          <div className="landmark">
            <div className="field"><span className="k">Landmark</span><span>Blue gate after the Total station</span></div>
            <div className="field"><span className="k">Near</span><span>Rond-point Victoire, Kalamu</span></div>
            <div className="field"><span className="k">Pin</span><span className="num">−4.3329, 15.3083 · ±8 m</span></div>
            <div className="field">
              <span className="k">Voice note</span>
              <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="wave" aria-hidden>
                  {[8, 14, 22, 12, 18, 26, 10, 16, 24, 14, 8, 20, 12, 6, 16, 22, 10, 14].map((h, i) => (
                    <i key={i} style={{ height: h }} />
                  ))}
                </span>
                <span className="num small">0:12</span>
              </span>
            </div>
            <div className="field"><span className="k">For the rider</span><span>Call when you reach the gate — the bell doesn&rsquo;t work.</span></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">02</span><span className="eyebrow">What you pay, line by line</span></div>
              <h2 className="display">A visible 10%, and a lower bill.</h2>
            </div>
            <p className="lede">
              Platforms that charge restaurants 25–30% get it back through the menu. We charge restaurants nothing, ask
              them to keep their in-store prices, and show our service charge as its own line. Same meal, 3 km away:
            </p>
          </div>
          <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr><th>The same 20.00 of food</th><th>Food</th><th>Delivery</th><th>Service</th><th>You pay</th><th>Restaurant keeps</th></tr>
            </thead>
            <tbody>
              <tr className="us total"><td>Tunakula — 0% commission</td><td>20.00</td><td>3.00</td><td>2.00</td><td>25.00</td><td>20.00</td></tr>
              <tr className="them"><td>Typical app at 25% commission, menu +15%</td><td>23.00</td><td>—</td><td>—</td><td>28.29</td><td>17.25</td></tr>
              <tr className="them"><td>Typical app at 30% commission, menu +20%</td><td>24.00</td><td>—</td><td>—</td><td>29.39</td><td>16.80</td></tr>
            </tbody>
          </table>
          </div>
          <p className="footnote">Amounts in US dollars for comparison. Competitor rows illustrate common market practice, not any company&rsquo;s quoted terms. Delivery is 1.00 per kilometre up to 5.00, and the fee never changes the price of the food.</p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">03</span><span className="eyebrow">On the menu this week</span></div>
              <h2 className="display">Cooked this evening, in your commune.</h2>
            </div>
            <p className="lede">Prices are the kitchen&rsquo;s own, in francs, the same as at their counter. Dietary tags are set by the kitchen and checked before your food is packed.</p>
          </div>
          <div className="menu-board">
            {KITCHENS.map((k) => (
              <div className="col" key={k.name}>
                <div className="kitchen">{k.name}</div>
                <div className="where">{k.where}</div>
                {k.dishes.map(([name, price, note, tag]) => (
                  <div key={name}>
                    <div className="dish">
                      <span className="name">{name}{tag ? <span className="tag">{tag}</span> : null}</span>
                      <span className="fill" />
                      <span className="price">{price}</span>
                    </div>
                    {note ? <small className="small" style={{ display: "block", marginTop: -6, paddingBottom: 6 }}>{note}</small> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap split">
          <div className="stack">
            <div className="kicker"><span className="n">04</span><span className="eyebrow">From London, Paris or Brussels</span></div>
            <p className="quote">
              &ldquo;I paid in pounds from Croydon. Maman got her <em>poulet moambe</em> in Bandal forty minutes later — and I got the photo.&rdquo;
            </p>
            <p className="small">How Send a Meal Home works: you pay in your currency at a rate you see before paying; the restaurant is paid in Kinshasa; the recipient confirms with a code; you receive photo, time and place of delivery.</p>
            <p style={{ paddingTop: 6 }}><Link className="link" href="/send-home/">Send a meal home</Link></p>
          </div>
          <ol className="flow two">
            <li><h4>Choose who and where</h4><p>Name, phone and the landmark. They don&rsquo;t need the app.</p></li>
            <li><h4>Pay in £, € or $</h4><p>Rate and fee shown first, then held while you pay.</p></li>
            <li><h4>They confirm the code</h4><p>Sent by WhatsApp in French or Lingála.</p></li>
            <li><h4>You get the proof</h4><p>Photo, GPS time and the confirmed code, in your app.</p></li>
          </ol>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap duo">
          <Link href="/restaurants/">
            <div className="big num">0%</div>
            <h3 className="display">Run your kitchen on Tunakula.</h3>
            <p className="lede">No commission on any order, a till on the phone you already own, and money in your account on schedule.</p>
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
