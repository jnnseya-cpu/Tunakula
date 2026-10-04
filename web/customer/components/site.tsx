import Link from "next/link";

const LINKS = [
  { href: "/", label: "Order" },
  { href: "/send-home/", label: "Send a meal home" },
  { href: "/restaurants/", label: "For restaurants" },
  { href: "/riders/", label: "Ride with us" },
  { href: "/kinshasa/", label: "Kinshasa" },
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
          <div>
            <h5>Order</h5>
            <ul>
              <li>Kinshasa</li>
              <li>Send a meal home</li>
              <li>Order on WhatsApp</li>
              <li>Order for a group</li>
            </ul>
          </div>
          <div>
            <h5>Partners</h5>
            <ul>
              <li>Restaurants & shops</li>
              <li>Riders</li>
              <li>Fleet partners</li>
              <li>Employers</li>
            </ul>
          </div>
          <div>
            <h5>Help</h5>
            <ul>
              <li>Support, 24/7</li>
              <li>How pricing works</li>
              <li>Ranking & fairness</li>
              <li>Accessibility</li>
            </ul>
          </div>
          <div>
            <h5>Company</h5>
            <ul>
              <li>About</li>
              <li>Careers</li>
              <li>Press</li>
              <li>Privacy & terms</li>
            </ul>
          </div>
        </div>
        <div className="legal">
          <span>© 2026 Groupe Nseya.</span>
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
