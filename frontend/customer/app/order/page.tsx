import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "../../components/site";
import { JoinCard } from "../../components/merchant";
import { LiveMerchantGrid } from "../../components/live";
import { StoreFilter } from "../../components/filter";
import { StoreSorter } from "../../components/location";
import { LiveStoreGrid } from "../../components/live-store";
import { PromoBanners } from "../../components/promo-banners";
import { CategoryTiles, BestReviewed } from "../../components/home-sections";
import { Trending } from "../../components/trending";
import { Recommendations } from "../../components/recommendations";
import { PlateArt, type Recipe } from "../../components/plate";
import { MERCHANTS } from "../../lib/catalogue";
import { T } from "../../components/t";

export const metadata: Metadata = { title: "Order food in Kinshasa", description: "Restaurants, grills, malewa, bakeries and groceries delivering across Kinshasa." };

// Quick "what are you craving?" shortcuts into search — a storefront discovery aid (moved here from the
// landing page so browsing lives in one place).
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

export default function Order() {
  return (
    <>
      <SiteNav current="/order/" />
      <div className="preview-note"><div className="wrap">Preview · sample kitchens and shops showing how ordering works. Ordering opens at launch.</div></div>
      <section className="tight order-top">
        <div className="wrap">
          <p className="eyebrow"><b>Kinshasa</b> · <T k="disc.eyebrow" /></p>
          <h1 className="display" style={{ margin: "14px 0 26px" }}><T k="disc.hungry" /></h1>
          <StoreFilter />
        </div>
      </section>

      <CategoryTiles />

      <section className="tight crave-sec">
        <div className="wrap">
          <h2 className="sec-title">What are you craving?</h2>
          <nav className="crave" aria-label="Cravings">
            {CRAVINGS.map(([label, recipe, q]) => (
              <Link key={label} href={`/order/?q=${encodeURIComponent(q)}`} data-reveal>
                <PlateArt className="crave-pic" recipe={recipe} seed={`crave-${q}`} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <PromoBanners />

      <section className="tight">
        <div className="wrap">
          <StoreSorter scope="order" />
          <div className="mgrid" data-scope="order">
            <LiveMerchantGrid fallback={MERCHANTS} />
            <JoinCard />
          </div>
          <LiveStoreGrid exclude={MERCHANTS.map((m) => m.name)} />
          <p id="no-stores" className="lede" hidden>Nothing matches yet. Try a dish, like &ldquo;pondu&rdquo;, or a commune.</p>
        </div>
      </section>

      <Trending />

      <BestReviewed />

      <Recommendations />

      <SiteFooter />
    </>
  );
}
