import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pricing from "@tunakula/ts-contracts/published/rider-ladder.json";
import type { Merchant } from "../lib/catalogue";
import { PlateArt } from "./plate";

/** "from $1.00": the first kilometre at the published per-km rate. */
export const DELIVERY_FROM = `$${pricing.pricing.delivery_fee.per_km}`;
export const SERVICE_BPS = pricing.pricing.service_charge_bps;

const exists = (p: string) => existsSync(join(process.cwd(), "public", p));
const firstPhoto = (base: string) => ["webp", "jpg", "jpeg", "png"].map((e) => `${base}.${e}`).find(exists);

/** Cover picture: the merchant's photo (public/photos/cover-<slug>.*) or three of their dishes on their colour. */
export function Cover({ m, className }: { m: Merchant; className?: string }) {
  const photo = firstPhoto(`photos/cover-${m.slug}`);
  return (
    <div className={`cover ${className ?? ""}`} style={{ background: m.tone.bg, color: m.tone.fg }}>
      {photo ? (
        <img src={`/${photo}`} alt={`${m.name}`} />
      ) : (
        <div className="cover-plates" aria-hidden>
          {m.cover.map((r, i) => <PlateArt key={i} className={`cp cp${i}`} recipe={r} seed={`${m.slug}-${i}`} />)}
        </div>
      )}
    </div>
  );
}

/** Profile picture: the merchant's logo (public/photos/logo-<slug>.*) or a monogram in their colours. */
export function Logo({ m, size = 56 }: { m: Merchant; size?: number }) {
  const photo = firstPhoto(`photos/logo-${m.slug}`);
  return (
    <span className="mlogo" style={{ width: size, height: size, background: m.tone.bg, color: m.tone.accent, fontSize: size * 0.34 }}>
      {photo ? <img src={`/${photo}`} alt={`${m.name} logo`} /> : m.monogram}
    </span>
  );
}

export function Stars({ m }: { m: Merchant }) {
  return (
    <span className="stars">
      <span aria-hidden>★</span> <b className="num">{m.rating.toFixed(1)}</b> <span className="muted num">({m.ratings.toLocaleString("fr-FR").replace(/\s/g, " ")})</span>
    </span>
  );
}

export function MerchantCard({ m }: { m: Merchant }) {
  return (
    <Link className="mcard" href={`/r/${m.slug}/`}>
      <Cover m={m} className="sm" />
      <div className="mcard-body">
        <Logo m={m} size={46} />
        <div>
          <h3>{m.name}</h3>
          <p className="muted">{m.cuisine} · {m.commune}</p>
          <p className="meta"><Stars m={m} /> <span>· {m.eta}</span> <span>· Delivery from {DELIVERY_FROM}</span></p>
        </div>
      </div>
    </Link>
  );
}

/** Fills the grid: an invitation for kitchens and shops to open their own storefront. */
export function JoinCard() {
  return (
    <Link className="mcard join" href="/restaurants/">
      <div className="join-body">
        <span className="big num">0%</span>
        <h3>Your kitchen or shop here</h3>
        <p>Your own storefront, your counter prices, and no commission on any order.</p>
        <span className="link">Open a storefront</span>
      </div>
    </Link>
  );
}
