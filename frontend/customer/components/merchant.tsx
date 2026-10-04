import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pricing from "@tunakula/ts-contracts/published/rider-ladder.json";
import type { Merchant } from "../lib/catalogue";
import { EtaChip, OpenBadge, StoreLink } from "./location";
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

/** Storefront card: cover, logo, rating, road distance and delivery time from the customer's location. */
export function MerchantCard({ m }: { m: Merchant }) {
  const search = [m.name, m.cuisine, m.commune, m.kind, ...m.menu.flatMap((s) => s.items.map((i) => i.name))].join(" ").toLowerCase();
  return (
    <StoreLink slug={m.slug} className="mcard" data-store data-slug={m.slug} data-kind={m.kind} data-search={search} data-reveal>
      <div className="mcard-media">
        <Cover m={m} className="sm" />
        <span className="mcard-badges"><OpenBadge slug={m.slug} /></span>
        <span className="mcard-rating"><span aria-hidden>★</span> <b className="num">{m.rating.toFixed(1)}</b></span>
      </div>
      <div className="mcard-body">
        <Logo m={m} size={52} />
        <div className="mcard-text">
          <h3>{m.name}</h3>
          <p className="muted">{m.cuisine} · {m.commune}</p>
        </div>
      </div>
      <div className="mcard-foot">
        <EtaChip slug={m.slug} />
        <span className="fee"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M5 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14-6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM15 5h-3v2h2.3l1.6 3H10l-2-3H5v2h2l1.7 2.6L7.3 12h2.3l1-1.5h5.9l.7 1.4 1.8-.9L15 5Z" /></svg> from {DELIVERY_FROM}</span>
      </div>
    </StoreLink>
  );
}

/** Fills the grid: an invitation for kitchens and shops to open their own storefront. */
export function JoinCard() {
  return (
    <Link className="mcard join" href="/restaurants/" data-reveal>
      <div className="join-body">
        <span className="big num">0%</span>
        <h3>Your kitchen or shop here</h3>
        <p>Your own storefront, your counter prices, and no commission on any order.</p>
        <span className="link">Open a storefront</span>
      </div>
    </Link>
  );
}
