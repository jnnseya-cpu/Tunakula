import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";

export const metadata: Metadata = { title: "Send a meal home" };

export default function SendHome() {
  return (
    <>
      <SiteNav current="/send-home/" />
      <section className="hero" style={{ paddingBottom: 96 }}>
        <div className="wrap split">
          <div className="copy" style={{ paddingBottom: 0 }}>
            <p className="eyebrow"><b>London · Paris · Brussels</b> &nbsp;→&nbsp; Kinshasa</p>
            <h1 className="display">Feed the people you miss, <em>from wherever you are.</em></h1>
            <p className="lede">
              Choose a kitchen in Kinshasa, pay in pounds, euros or dollars, and know it arrived: the recipient
              confirms with a code, and you get the photo, the time and the place.
            </p>
            <div className="cta-row" style={{ marginTop: 34 }}>
              <Link className="btn accent" href="/send-home/">Send a meal</Link>
              <span className="small">No app needed at the other end.</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 18, justifyItems: "end" }}>
            <div className="landmark" style={{ width: "100%" }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Your quote · held until 20:07</div>
              <div className="field"><span className="k">Order</span><span>Poulet à la moambe for two, Chez Mama Pauline</span></div>
              <div className="field"><span className="k">In Kinshasa</span><span className="num">$20.50 incl. delivery</span></div>
              <div className="field"><span className="k">Rate</span><span className="num">1 USD = 0.7500 GBP · our margin 1.00%</span></div>
              <div className="field" style={{ fontWeight: 650 }}><span className="k">You pay</span><span className="num">£15.53</span></div>
              <div className="field"><span className="k">Recipient</span><span>Maman Thérèse · Bandalungwa, near the Église Saint-Raphaël</span></div>
            </div>
            <div className="landmark" style={{ width: "100%", display: "grid", gridTemplateColumns: "150px 1fr", gap: 18, alignItems: "stretch" }}>
              <div className="photo" style={{ minHeight: 150 }}><span>Delivery photo</span></div>
              <div>
                <div className="eyebrow">Delivered · 19:58</div>
                <ul className="ticks" style={{ marginTop: 8 }}>
                  <li style={{ fontSize: 14, padding: "8px 0 8px 26px" }}>Code 4821 confirmed by recipient</li>
                  <li style={{ fontSize: 14, padding: "8px 0 8px 26px" }}>At the pin, 9 m away</li>
                  <li style={{ fontSize: 14, padding: "8px 0 8px 26px", borderBottom: 0 }}>Seal intact at the door</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">01</span><span className="eyebrow">How it works</span></div>
              <h2 className="display">Four steps, two countries, one meal.</h2>
            </div>
            <p className="lede">The restaurant is paid in Kinshasa in its own currency. You pay in yours, at a rate shown before you commit and held while you pay. Nothing about it is hidden in the exchange.</p>
          </div>
          <ol className="flow">
            <li><h4>Choose who and where</h4><p>A name, a phone number and the landmark they would give a moto driver.</p></li>
            <li><h4>Pay in your currency</h4><p>Card, Apple Pay or Google Pay. Rate, margin and total are shown before you pay.</p></li>
            <li><h4>They get a message</h4><p>On WhatsApp or SMS, in French or Lingála, with the code to give the rider.</p></li>
            <li><h4>You get the proof</h4><p>Photo, delivery time, distance from the pin and the confirmed code.</p></li>
          </ol>
        </div>
      </section>

      <section>
        <div className="wrap split even">
          <div className="stack">
            <div className="kicker"><span className="n">02</span><span className="eyebrow">At the other end</span></div>
            <h2 className="display">They don&rsquo;t need an account. They need a code.</h2>
            <p className="lede">The recipient receives one message they can read, in the language they speak. The rider can&rsquo;t hand the food to anyone else, and can&rsquo;t mark it delivered without the code.</p>
          </div>
          <div className="landmark" style={{ background: "#e7efe9", borderColor: "rgba(14,92,82,0.2)", maxWidth: 440, justifySelf: "end", fontSize: 15.5, lineHeight: 1.5 }}>
            <div className="small" style={{ marginBottom: 10 }}>WhatsApp · Tunakula</div>
            <p>Mbote Maman Thérèse 👋🏾</p>
            <p style={{ marginTop: 10 }}>Joseph vous envoie un repas depuis Londres : <b>poulet à la moambe pour deux</b>, de chez Mama Pauline.</p>
            <p style={{ marginTop: 10 }}>Patrick arrive vers <b>19 h 55</b>. Donnez-lui ce code à la porte : <b style={{ letterSpacing: "0.15em" }}>4821</b></p>
            <p className="small" style={{ marginTop: 12 }}>Répondez « 1 » pour appeler Patrick · « LN » pour le lingála</p>
          </div>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap split even" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="kicker"><span className="n">03</span><span className="eyebrow">What we promise</span></div>
            <h2 className="display">If it doesn&rsquo;t arrive, you don&rsquo;t pay for it.</h2>
          </div>
          <ul className="ticks">
            <li>The rate you see is the rate you pay — held for the length of the quote, then re-quoted, never changed silently.</li>
            <li>The recipient&rsquo;s code can&rsquo;t be skipped on a gifted order. Not by the rider, not by support.</li>
            <li>Your money is collected and converted by licensed payment partners. Tunakula never holds it.</li>
            <li>Failed delivery is refunded automatically, with the reason and the evidence shown to you.</li>
            <li>Set up a weekly meal for someone, and pause or skip it any week.</li>
          </ul>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
