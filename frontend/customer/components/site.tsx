import Link from "next/link";

import { CONTACT_EMAIL } from "../lib/site";
import { AccountLink } from "./account";
import { LocationButton } from "./location";

const LINKS = [
  { href: "/order/", label: "Restaurants" },
  { href: "/membership/", label: "Tunakula Plus" },
  { href: "/send-home/", label: "Send a meal home" },
  { href: "/restaurants/", label: "For restaurants" },
  { href: "/riders/", label: "Ride with us" },
];

const FOOTER: [string, [string, string][]][] = [
  ["Order", [["Order food", "/order/"], ["My wallet", "/wallet/"], ["Repeat orders", "/subscriptions/"], ["Invite & earn", "/wallet/"], ["My table bookings", "/bookings/"], ["Kinshasa", "/kinshasa/"], ["How it works", "/how-it-works/"], ["Send a meal home", "/send-home/"], ["How pricing works", "/legal/pricing/"]]],
  ["Partners", [["Restaurants & shops", "/restaurants/"], ["Riders & fleets", "/riders/"], ["Merchant terms", "/legal/merchant-terms/"], ["Rider terms", "/legal/rider-terms/"]]],
  ["Trust", [["Reviews & moderation", "/legal/reviews/"], ["Ranking & fairness", "/legal/ranking/"], ["Allergens & food safety", "/legal/food-safety/"], ["Accessibility", "/legal/accessibility/"]]],
  ["Company", [["About", "/about/"], ["Terms of use", "/legal/terms/"], ["Privacy", "/legal/privacy/"], ["All policies", "/legal/"]]],
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
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <Wordmark />
          <LocationButton />
          <form className="nav-search" action="/order/" method="get" role="search">
            <span className="sr">Search dishes, kitchens or communes</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="currentColor" d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" /></svg>
            <input name="q" placeholder="Search food or restaurants" />
          </form>
          <nav aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="right">
            <AccountLink />
            <span className="langs" aria-label="Languages">
              <b>EN</b> FR LN SW
            </span>
            <Link className="btn accent" href="/order/">
              Order now
            </Link>
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-label="App">
        {TABS.map(([href, label, d]) => (
          <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path fill="currentColor" d={d} /></svg>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

const TABS: [string, string, string][] = [
  ["/", "Home", "M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z"],
  ["/order/", "Explore", "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"],
  ["/send-home/", "Send home", "M20 6h-2.2A3 3 0 0 0 12 4.2 3 3 0 0 0 6.2 6H4a1 1 0 0 0-1 1v4h1v9h16v-9h1V7a1 1 0 0 0-1-1Zm-5-1a1 1 0 1 1 0 2h-2a1 1 0 0 1 1-2h1Zm-6 0h1a1 1 0 0 1 1 1v1H9a1 1 0 1 1 0-2Zm2 13H6v-7h5v7Zm0-9H5V8h6v1Zm7 9h-5v-7h5v7Zm1-9h-6V8h6v1Z"],
  ["/orders/", "Orders", "M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2Zm1 5v2h8V8H8Zm0 4v2h8v-2H8Z"],
];

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="cols">
          <div>
            <Wordmark />
            <p className="small" style={{ marginTop: 14, maxWidth: "26em" }}>
              Tunakula — <i>get to eat.</i> A Groupe Nseya company. Payments are collected and settled by licensed partners; Tunakula never holds your money.
            </p>
          </div>
          {FOOTER.map(([title, links]) => (
            <div key={title}>
              <h5>{title}</h5>
              <ul>
                {links.map(([label, href]) => (
                  <li key={href}><Link href={href}>{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="legal">
          <span>© 2026 Groupe Nseya · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> · <Link href="/legal/legal-notice/">Legal notice</Link></span>
          <span>Français · Lingála · Kiswahili · English</span>
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
