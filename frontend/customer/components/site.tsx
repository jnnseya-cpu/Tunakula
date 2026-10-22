"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CONTACT_EMAIL } from "../lib/site";
import { MarketSwitcher } from "./market";
import { LangSwitcher } from "./lang-switcher";
import { SocialLinks, useSiteContent } from "./site-content";
import { useT } from "./use-t";
import { AccountLink } from "./account";
import { LocationButton } from "./location";

// Nav/footer link labels carry an i18n key alongside the href; the label is resolved per viewer with `useT`.
const LINKS: { href: string; key: string }[] = [
  { href: "/order/", key: "nav.restaurants" },
  { href: "/chefs/", key: "nav.chefs" },
  { href: "/membership/", key: "nav.plus" },
  { href: "/send-home/", key: "nav.sendHome" },
  { href: "/restaurants/", key: "nav.forRestaurants" },
  { href: "/riders/", key: "nav.ride" },
];

const FOOTER: [string, [string, string][]][] = [
  ["foot.order", [["Order food", "/order/"], ["Book a chef", "/chefs/"], ["My wallet", "/wallet/"], ["Repeat orders", "/subscriptions/"], ["Invite & earn", "/wallet/"], ["My table bookings", "/bookings/"], ["Kinshasa", "/kinshasa/"], ["How it works", "/how-it-works/"], ["Send a meal home", "/send-home/"], ["How pricing works", "/legal/pricing/"]]],
  ["foot.partners", [["Restaurants & shops", "/restaurants/"], ["Riders & fleets", "/riders/"], ["Merchant terms", "/legal/merchant-terms/"], ["Rider terms", "/legal/rider-terms/"]]],
  ["foot.trust", [["Reviews & moderation", "/legal/reviews/"], ["Ranking & fairness", "/legal/ranking/"], ["Allergens & food safety", "/legal/food-safety/"], ["Accessibility", "/legal/accessibility/"]]],
  ["foot.company", [["About", "/about/"], ["Blog", "/blog/"], ["Help & assistant", "/help/"], ["Contact", "/contact/"], ["Terms of use", "/legal/terms/"], ["Privacy", "/legal/privacy/"], ["All policies", "/legal/"]]],
];

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Tunakula home">
      {/* The logo exactly as supplied (shared/brand/tunakula-logo.jpg; tools/guard-brand.ts checks every copy). */}
      <img src="/brand/tunakula-logo.jpg" alt="Tunakula — Get to eat" width={68} height={68} />
    </Link>
  );
}

export function SiteNav({ current }: { current: string }) {
  const t = useT();
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <Wordmark />
          <LocationButton />
          <form className="nav-search" action="/order/" method="get" role="search">
            <span className="sr">{t("nav.search")}</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="currentColor" d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" /></svg>
            <input name="q" placeholder={t("nav.search")} />
          </form>
          <nav aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}>
                {t(l.key)}
              </Link>
            ))}
          </nav>
          <div className="right">
            <AccountLink />
            <LangSwitcher />
            <Link className="btn accent" href="/order/">
              {t("nav.orderNow")}
            </Link>
          </div>
        </div>
      </header>
      <MobileTabBar current={current} />
    </>
  );
}

// The app-style bottom bar: Home · Explore · raised Cart FAB · Orders · Menu. Mobile only.
const TABS: [string, string, string][] = [
  ["/", "tab.home", "M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z"],
  ["/order/", "tab.explore", "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"],
  ["/orders/", "tab.orders", "M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2Zm1 5v2h8V8H8Zm0 4v2h8v-2H8Z"],
];
const CART_D = "M7 4h-2a1 1 0 0 0 0 2h1.2l1.6 8.4A2 2 0 0 0 11.8 16h6.4a2 2 0 0 0 2-1.6L21.8 7H7.5l-.5-3Zm2 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z";
const MENU_D = "M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z";

function MobileTabBar({ current }: { current: string }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const [cart, setCart] = useState<{ count: number; href: string }>({ count: 0, href: "/order/" });

  // The basket is kept per store in this browser (tk-basket:<branch>). Sum the lines for the
  // badge and point the cart at the store that has items, so the FAB behaves like the app's.
  useEffect(() => {
    try {
      let count = 0;
      let href = "/order/";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("tk-basket:")) continue;
        const lines = JSON.parse(localStorage.getItem(k) ?? "[]");
        if (!Array.isArray(lines)) continue;
        const c = lines.reduce((n: number, l: { qty?: number }) => n + (Number(l?.qty) || 0), 0);
        if (c > 0) { count += c; href = `/checkout/?branch=${k.slice("tk-basket:".length)}`; }
      }
      setCart({ count, href });
    } catch { /* storage blocked: leave the FAB pointing at browse */ }
  }, []);

  return (
    <>
      <nav className="tabbar" aria-label="App">
        {TABS.slice(0, 2).map(([href, key, d]) => (
          <Link key={href} className="tab" href={href} aria-current={href === current ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path fill="currentColor" d={d} /></svg>
            <span>{t(key)}</span>
          </Link>
        ))}
        <Link className="tab tab-fab" href={cart.href} aria-label={t("tab.cart")}>
          <span className="fab">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden><path fill="currentColor" d={CART_D} /></svg>
            {cart.count > 0 ? <b className="fab-badge">{cart.count}</b> : null}
          </span>
        </Link>
        <Link className="tab" href="/orders/" aria-current={current === "/orders/" ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path fill="currentColor" d={TABS[2][2]} /></svg>
          <span>{t("tab.orders")}</span>
        </Link>
        <button type="button" className="tab" onClick={() => setMenu(true)} aria-haspopup="true" aria-expanded={menu}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path fill="currentColor" d={MENU_D} /></svg>
          <span>{t("tab.menu")}</span>
        </button>
      </nav>

      {menu ? (
        <div className="msheet-backdrop" onClick={() => setMenu(false)}>
          <div className="msheet" role="dialog" aria-label={t("tab.menu")} onClick={(e) => e.stopPropagation()}>
            <div className="msheet-head"><b>{t("tab.menu")}</b><button type="button" onClick={() => setMenu(false)} aria-label="Close">✕</button></div>
            <div className="msheet-links">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined} onClick={() => setMenu(false)}>{t(l.key)}</Link>
              ))}
              <Link href="/wallet/" onClick={() => setMenu(false)}>{t("tab.wallet")}</Link>
              <Link href="/help/" onClick={() => setMenu(false)}>{t("tab.help")}</Link>
            </div>
            <div className="msheet-foot"><AccountLink /><LangSwitcher /></div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SiteFooter() {
  const t = useT();
  const sc = useSiteContent();
  // A market admin's tagline (set in the console) overrides the translated default when present.
  const tagline = sc?.customized && sc.home.tagline ? sc.home.tagline : t("foot.tagline");
  return (
    <footer>
      <div className="wrap">
        <div className="cols">
          <div>
            <Wordmark />
            <p className="small" style={{ marginTop: 14, maxWidth: "26em" }}>{tagline}</p>
            <SocialLinks />
          </div>
          {FOOTER.map(([title, links]) => (
            <div key={title}>
              <h5>{t(title)}</h5>
              <ul>
                {links.map(([label, href]) => (
                  <li key={`${label}:${href}`}><Link href={href}>{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="legal">
          <span>© 2026 Groupe Nseya · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> · <Link href="/legal/legal-notice/">Legal notice</Link></span>
          <span className="legal-right"><MarketSwitcher /><LangSwitcher /></span>
        </div>
      </div>
    </footer>
  );
}

export function Phone({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`phone ${className ?? ""}`}>
      <div className="screen">
        <div className="island" />
        <div className="status">
          <span>19:42</span>
          <span>4G ▮▮▮</span>
        </div>
        {children}
      </div>
    </div>
  );
}
