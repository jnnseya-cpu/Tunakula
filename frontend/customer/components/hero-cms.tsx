"use client";
/**
 * The first hero slide's copy. By default it shows the hand-written launch copy; once a market admin sets landing
 * content in the console (CMS), the headline, lede and the secondary call-to-action switch to theirs. The
 * "Find food near me" action stays fixed either way.
 */
import { NearMeButton } from "./hero";
import { useSiteContent } from "./site-content";

export function HeroFoodCopy() {
  const sc = useSiteContent();
  const custom = sc?.customized ? sc.home.hero : null;
  return (
    <div className="hs-copy">
      <p className="eyebrow light"><b>Kinshasa</b> · 24 communes · francs or dollars</p>
      {custom ? <h1 className="display">{custom.title}</h1>
        : <h1 className="display">Hungry, <em>Kinshasa?</em></h1>}
      <p className="hs-lede">{custom?.subtitle || "Moambe, pondu, brochettes off the grill and bread still warm, from the kitchens you already love. See how far each one is and when it reaches you."}</p>
      <div className="hs-actions">
        <NearMeButton className="btn navy">Find food near me</NearMeButton>
        <a className="btn ghost-light" href={custom?.cta_href || "/order/"}>{custom?.cta_label || "Browse all"}</a>
      </div>
    </div>
  );
}
