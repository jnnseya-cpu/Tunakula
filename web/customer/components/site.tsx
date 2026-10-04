import Link from "next/link";

import { CONTACT_EMAIL } from "../lib/site";

const LINKS = [
  { href: "/", label: "Order" },
  { href: "/how-it-works/", label: "How it works" },
  { href: "/send-home/", label: "Send a meal home" },
  { href: "/restaurants/", label: "For restaurants" },
  { href: "/riders/", label: "Ride with us" },
];

const FOOTER: [string, [string, string][]][] = [
  ["Order", [["Kinshasa", "/kinshasa/"], ["How it works", "/how-it-works/"], ["Send a meal home", "/send-home/"], ["How pricing works", "/legal/pricing/"]]],
  ["Partners", [["Restaurants & shops", "/restaurants/"], ["Riders & fleets", "/riders/"], ["Merchant terms", "/legal/merchant-terms/"], ["Rider terms", "/legal/rider-terms/"]]],
  ["Trust", [["Reviews & moderation", "/legal/reviews/"], ["Ranking & fairness", "/legal/ranking/"], ["Allergens & food safety", "/legal/food-safety/"], ["Accessibility", "/legal/accessibility/"]]],
  ["Company", [["About", "/about/"], ["Terms of use", "/legal/terms/"], ["Privacy", "/legal/privacy/"], ["All policies", "/legal/"]]],
];

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Tunakula home">
      <span className="w">Tunakula</span>
      <span className="dot" aria-hidden />
    </Link>
  );
}

export function SiteNav({ current }: { current: string }) {
  return (
    <header className="nav">
      <div className="wrap">
        <Wordmark />
        <nav aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="right">
          <span className="city">Kinshasa</span>
          <span className="langs" aria-label="Languages">
            <b>EN</b> FR LN SW
          </span>
          <Link className="btn" href="/">
            Open the app
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="cols">
          <div>
            <Wordmark />
            <p className="small" style={{ marginTop: 14, maxWidth: "26em" }}>
              Tunakula — <i>on mange ensemble.</i> A Groupe Nseya company. Payments are collected and settled by licensed partners; Tunakula never holds your money.
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
