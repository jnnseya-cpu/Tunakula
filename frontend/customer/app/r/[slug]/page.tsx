import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteNav } from "../../../components/site";
import { AddButton, BasketBar, BasketPanel, BasketProvider } from "../../../components/basket";
import { Cover, DELIVERY_FROM, Logo, SERVICE_BPS, Stars } from "../../../components/merchant";
import { FoodImage } from "../../../components/plate";
import { EtaChip, OpenBadge } from "../../../components/location";
import { fc, merchant, MERCHANTS } from "../../../lib/catalogue";

export function generateStaticParams() {
  return MERCHANTS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const m = merchant((await params).slug);
  return m ? { title: `${m.name} — order online`, description: `${m.cuisine} in ${m.commune}. ${m.about}` } : {};
}

const anchor = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
          <nav className="menu-tabs" aria-label="Menu sections">
            {m.menu.map((s) => <a key={s.section} href={`#${anchor(s.section)}`}>{s.section}</a>)}
            <a href="#about">About</a>
          </nav>

          {m.menu.map((s) => (
            <section key={s.section} id={anchor(s.section)} className="menu-sec">
              <h2>{s.section}</h2>
              <div className="items">
                {s.items.map((it) => (
                  <article key={it.id} className="item">
                    <div className="item-text">
                      <h3>{it.name}</h3>
                      <p>{it.description}</p>
                      <div className="item-foot">
                        <span className="price num">{fc(it.price)}</span>
                        {it.unit ? <span className="muted">{it.unit}</span> : null}
                        {it.tags?.map((t) => <span key={t} className={`chip ${t === "Popular" ? "hot" : ""}`}>{t}</span>)}
                        {it.allergens?.length ? <span className="muted">Contains {it.allergens.join(", ")}</span> : null}
                      </div>
                    </div>
                    <div className="item-pic">
                      <FoodImage slug={it.id} recipe={it.recipe} alt={it.name} className="pic" />
                      <AddButton item={{ id: it.id, name: it.name, price: it.price }} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}

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
