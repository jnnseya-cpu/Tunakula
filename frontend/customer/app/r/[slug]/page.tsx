import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteNav } from "../../../components/site";
import { AddButton, BasketBar, BasketPanel, BasketProvider } from "../../../components/basket";
import { Cover, DELIVERY_FROM, Logo, SERVICE_BPS, Stars } from "../../../components/merchant";
import { LiveMenu } from "../../../components/live";
import { EtaChip, OpenBadge } from "../../../components/location";
import { merchant, MERCHANTS } from "../../../lib/catalogue";

export function generateStaticParams() {
  return MERCHANTS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const m = merchant((await params).slug);
  return m ? { title: `${m.name} — order online`, description: `${m.cuisine} in ${m.commune}. ${m.about}` } : {};
}


export default async function Storefront({ params }: { params: Promise<{ slug: string }> }) {
  const m = merchant((await params).slug);
  if (!m) notFound();
  return (
    <BasketProvider merchant={m.slug} merchantName={m.name} serviceBps={SERVICE_BPS}>
      <SiteNav current="/order/" />
      <div className="preview-note"><div className="wrap">Preview · a sample {m.kind === "Grocery" || m.kind === "Bakery" ? "shop" : "restaurant"} showing how storefronts work. Ordering opens at launch.</div></div>

      <div className="store-cover">
        <Cover m={m} className="lg" />
      </div>

      <div className="wrap store-head">
        <Logo m={m} size={112} />
        <div className="store-id">
          <p className="eyebrow"><Link href="/order/">Kinshasa</Link> · {m.commune} · {m.kind}</p>
          <h1 className="display">{m.name}</h1>
          <p className="store-meta">
            <Stars m={m} />
            <EtaChip slug={m.slug} size="lg" />
            <OpenBadge slug={m.slug} />
            <span>Delivery from {DELIVERY_FROM}</span>
            <span>Open {m.hours}</span>
          </p>
        </div>
        <div className="store-badges">
          <span className="badge">Counter prices · 0% commission</span>
          <span className="badge">FC or $ · mobile money</span>
        </div>
      </div>

      <div className="wrap store-body">
        <div className="store-menu">
          <LiveMenu merchant={m} />

          <section id="about" className="menu-sec about">
            <h2>About {m.name}</h2>
            <p className="lede">{m.about}</p>
            <div className="landmark" style={{ marginTop: 26 }}>
              <div className="field"><span className="k">Find us</span><span>{m.landmark}, {m.commune}</span></div>
              <div className="field"><span className="k">Open</span><span className="num">Every day, {m.hours}</span></div>
              <div className="field"><span className="k">Allergies</span><span>Tell the kitchen at checkout. Allergen tags are set by {m.name} and confirmed when your order is packed.</span></div>
            </div>
          </section>
        </div>
        <BasketPanel />
      </div>
      <BasketBar />
      <SiteFooter />
    </BasketProvider>
  );
}
