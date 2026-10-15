"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PlateArt } from "./plate-art";
import { EtaChip } from "./location";
import { fc } from "../lib/catalogue";
import { trending } from "../lib/trending";
import { fetchDiscovery, foodPhotoUrl, live, money, type DiscoveryItem } from "../lib/api";

/**
 * "Trending this week" — a ranked row of the dishes rising across kitchens.
 * Renders the catalogue snapshot immediately (works on the static export), then upgrades to the
 * live, order-volume ranking from GET /v1/discovery when the API is reachable and has orders.
 */
export function Trending({ n = 8 }: { n?: number }) {
  const snap = trending(n);
  const [liveItems, setLiveItems] = useState<DiscoveryItem[] | null>(null);
  useEffect(() => {
    if (!live()) return;
    fetchDiscovery().then((d) => { if (d.trending?.length) setLiveItems(d.trending.slice(0, n)); }).catch(() => undefined);
  }, [n]);

  if (snap.length === 0 && !liveItems) return null;
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
          {liveItems
            ? liveItems.map((it, i) => (
                <Link key={it.item_id} className="fav trend" href={`/store/?id=${it.branch_id}`} data-reveal>
                  <div className="fav-pic" style={{ background: "var(--card-2)" }}>
                    {it.image_id ? <img className="pic is-photo" src={foodPhotoUrl(it.image_id)} alt={it.name} /> : null}
                    <span className="trend-rank" aria-label={`Number ${i + 1} trending`}>#{i + 1}</span>
                    <span className="fav-add" aria-hidden>+</span>
                  </div>
                  <h3>{it.name}</h3>
                  <p className="muted">{it.branch_name}</p>
                  <p className="fav-foot">
                    <b className="num">{it.price ? money(it.price) : ""}</b>
                    <span className="trend-flag" aria-hidden>▲ trending</span>
                  </p>
                </Link>
              ))
            : snap.map(({ merchant: m, item, rank }) => (
                <Link key={`${m.slug}-${item.id}`} className="fav trend" href={`/r/${m.slug}/`} data-reveal>
                  <div className="fav-pic" style={{ background: m.tone.bg }}>
                    <PlateArt className="pic" recipe={item.recipe} seed={item.id} title={item.name} />
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
