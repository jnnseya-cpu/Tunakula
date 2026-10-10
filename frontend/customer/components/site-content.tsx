"use client";
/**
 * Live storefront content (CMS): the hero copy, social links and tagline a market admin set, fetched once from
 * /v1/site-content. Returns null until it loads and when the API is offline (static preview), so every consumer
 * keeps its hand-designed defaults and only overrides when `customized` is true.
 */
import { useEffect, useState } from "react";
import { siteContent, type SiteContent } from "../lib/api";

const SOCIAL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", x: "X", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp" };
// Single-glyph marks keep the footer light and avoid shipping an icon font.
const SOCIAL_GLYPH: Record<string, string> = { facebook: "f", instagram: "◉", x: "𝕏", tiktok: "♪", youtube: "▶", whatsapp: "✆" };

export function useSiteContent(): SiteContent | null {
  const [sc, setSc] = useState<SiteContent | null>(null);
  useEffect(() => { let on = true; void siteContent().then((r) => { if (on) setSc(r); }); return () => { on = false; }; }, []);
  return sc;
}

/** The footer social row — renders only the links the market actually set. */
export function SocialLinks() {
  const sc = useSiteContent();
  const links = sc?.home.social ?? {};
  const keys = Object.keys(links).filter((k) => links[k]);
  if (keys.length === 0) return null;
  return (
    <span className="social-links" aria-label="Social media">
      {keys.map((k) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABEL[k] ?? k} title={SOCIAL_LABEL[k] ?? k}>
          <span aria-hidden>{SOCIAL_GLYPH[k] ?? "•"}</span>
        </a>
      ))}
    </span>
  );
}
