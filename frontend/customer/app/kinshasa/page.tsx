import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";

export const metadata: Metadata = { title: "Kinshasa" };

const DISTRICTS: [string, string[]][] = [
  ["Lukunga", ["Gombe", "Barumbu", "Kinshasa", "Lingwala", "Kintambo", "Ngaliema", "Mont-Ngafula"]],
  ["Funa", ["Kasa-Vubu", "Kalamu", "Bandalungwa", "Bumbu", "Makala", "Ngiri-Ngiri", "Selembao"]],
  ["Mont-Amba", ["Lemba", "Limete", "Matete", "Ngaba", "Kisenso"]],
  ["Tshangu", ["N'djili", "Masina", "Kimbanseke", "Nsele", "Maluku"]],
];

const DISHES: [string, string][] = [
  ["Pondu", "Cassava leaves pounded and simmered for hours, often with makayabu or fish."],
  ["Moambe", "Chicken or fish in a sauce of palm nut — the dish people send home for."],
  ["Liboke", "Fish or meat seasoned and steamed in banana leaves over coals."],
  ["Fumbwa", "Wild spinach cooked with peanut paste and smoked or salted fish."],
  ["Makayabu", "Salted fish, soaked and cooked with onion, tomato and pili-pili."],
  ["Chikwangue", "Fermented cassava, wrapped in leaves; the staple on the side."],
  ["Makemba", "Plantain — fried, boiled or grilled — with beans or fish."],
  ["Mbika", "Ground pumpkin seeds, cooked into a savoury cake."],
];

export default function Kinshasa() {
  return (
    <>
      <SiteNav current="/kinshasa/" />
      <section className="hero" style={{ paddingBottom: 88 }}>
        <div className="wrap head-row" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow"><b>République démocratique du Congo</b></p>
            <h1 className="display" style={{ marginTop: 26 }}>Kinshasa, <em>commune by commune.</em></h1>
          </div>
          <p className="lede">Four districts, twenty-four communes, one river. Delivery times and fees are set by real routes — the bridges, the boulevards and the evening traffic on the 30 Juin — not by a straight line on a map.</p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="kicker" style={{ marginBottom: 30 }}><span className="n">01</span><span className="eyebrow">Where we deliver</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 40 }}>
            {DISTRICTS.map(([district, communes]) => (
              <div key={district}>
                <div className="kitchen" style={{ fontFamily: "var(--display)", fontSize: 30, borderBottom: "1px solid var(--ink)", paddingBottom: 10 }}>{district}</div>
                <ul className="communes" style={{ columns: 1 }}>
                  {communes.map((c) => (<li key={c}>{c}<span>{district === "Tshangu" && c === "Maluku" ? "on request" : "open"}</span></li>))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="head-row">
            <div className="stack">
              <div className="kicker"><span className="n">02</span><span className="eyebrow">A short glossary</span></div>
              <h2 className="display">What Kinshasa orders tonight.</h2>
            </div>
            <p className="lede">For anyone ordering from abroad, or new in town. Each kitchen makes these its own way — the menu says how.</p>
          </div>
          <div className="menu-board" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {[DISHES.slice(0, 4), DISHES.slice(4)].map((col, i) => (
              <div className="col" key={i}>
                {col.map(([name, what]) => (
                  <div key={name} style={{ padding: "14px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ fontFamily: "var(--display)", fontSize: 26 }}>{name}</div>
                    <p style={{ color: "var(--ink-2)", marginTop: 4 }}>{what}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="tight" style={{ borderBottom: 0 }}>
        <div className="wrap split even" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="kicker"><span className="n">03</span><span className="eyebrow">Paying in Kinshasa</span></div>
            <h2 className="display">Francs or dollars. Your choice, every time.</h2>
            <p style={{ marginTop: 26 }}><Link className="link" href="/">Order in Kinshasa</Link></p>
          </div>
          <ul className="ticks">
            <li>See every price in Congolese francs or US dollars, and switch at any time.</li>
            <li>Pay with M-Pesa, Orange Money, Airtel Money or a card. The rate is shown and held while you pay.</li>
            <li>Amounts in francs are rounded to the nearest 100 FC, so the total is one you can actually pay.</li>
            <li>Keep a wallet in each currency. We never convert your balance without asking.</li>
          </ul>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
