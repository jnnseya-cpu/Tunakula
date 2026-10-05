import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../components/site";
import { JoinCard } from "../../components/merchant";
import { LiveMerchantGrid } from "../../components/live";
import { StoreFilter } from "../../components/filter";
import { StoreSorter } from "../../components/location";
import { LiveStoreGrid } from "../../components/live-store";
import { MERCHANTS } from "../../lib/catalogue";

export const metadata: Metadata = { title: "Order food in Kinshasa", description: "Restaurants, grills, malewa, bakeries and groceries delivering across Kinshasa." };

export default function Order() {
  return (
    <>
      <SiteNav current="/order/" />
      <div className="preview-note"><div className="wrap">Preview · sample kitchens and shops showing how ordering works. Ordering opens at launch.</div></div>
      <section className="tight order-top">
        <div className="wrap">
          <p className="eyebrow"><b>Kinshasa</b> · delivering now · distances by road from your location</p>
          <h1 className="display" style={{ margin: "14px 0 26px" }}>What are you hungry for?</h1>
          <StoreFilter />
        </div>
      </section>
      <section className="tight" style={{ borderBottom: 0 }}>
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
      <SiteFooter />
    </>
  );
}
