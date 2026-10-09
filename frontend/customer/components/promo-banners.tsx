"use client";
/** A strip of live marketing banners placed by operations, shown on the order/discovery page. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { liveBanners, type Banner } from "../lib/api";

export function PromoBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  useEffect(() => { liveBanners().then(setBanners).catch(() => undefined); }, []);
  if (banners.length === 0) return null;
  return (
    <div className="promo-strip wrap">
      {banners.map((b) => {
        const inner = (
          <>
            <div className="pb-text"><b>{b.headline}</b>{b.subtext ? <span>{b.subtext}</span> : null}</div>
            {b.cta_label ? <span className="pb-cta">{b.cta_label} →</span> : null}
          </>
        );
        const cls = `promo-banner tone-${b.tone.toLowerCase()}`;
        return b.cta_href
          ? <Link key={b.id} className={cls} href={b.cta_href}>{inner}</Link>
          : <div key={b.id} className={cls}>{inner}</div>;
      })}
    </div>
  );
}
