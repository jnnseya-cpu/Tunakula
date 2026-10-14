import Link from "next/link";
import { FoodImage } from "./plate";
import { EtaChip } from "./location";
import { fc } from "../lib/catalogue";
import { trending } from "../lib/trending";

/**
 * "Trending this week" — a ranked row of the dishes rising across kitchens right now.
 * Same card as Popular dishes, with a chart position and a rising marker so it reads as a chart.
 */
export function Trending({ n = 8 }: { n?: number }) {
  const picks = trending(n);
  if (picks.length === 0) return null;
  return (
    <section className="tight trend-sec">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <h2 className="sec-title">Trending this week</h2>
            <p className="muted">The dishes Kinshasa is ordering most right now.</p>
          </div>
          <Link className="link" href="/order/?sort=trending">See the chart</Link>
        </div>
        <div className="fav-grid">
          {picks.map(({ merchant: m, item, rank }) => (
            <Link key={`${m.slug}-${item.id}`} className="fav trend" href={`/r/${m.slug}/`} data-reveal>
              <div className="fav-pic" style={{ background: m.tone.bg }}>
                <FoodImage slug={item.id} recipe={item.recipe} alt={item.name} className="pic" />
                <span className="trend-rank" aria-label={`Number ${rank} trending`}>#{rank}</span>
                <span className="fav-add" aria-hidden>+</span>
              </div>
              <h3>{item.name}</h3>
              <p className="muted">{m.name} · {m.commune}</p>
              <p className="fav-foot">
                <b className="num">{fc(item.price)}</b>
                <span className="trend-flag" aria-hidden>▲ trending</span>
              </p>
              <EtaChip slug={m.slug} />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
