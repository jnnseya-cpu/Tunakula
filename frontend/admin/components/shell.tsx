"use client";
/**
 * Console shell: sign-in guard, sidebar (sections shown by the person's capabilities in the active market),
 * market switcher, language, light/dark theme and sign-out. Everything below reads the same context.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, session, type Me } from "../lib/api";
import { translate, type Key, type Lang } from "../lib/i18n";

interface Ctx {
  me: Me;
  country: string;
  lang: Lang;
  t: (k: Key, vars?: Record<string, string | number>) => string;
  setCountry: (c: string) => void;
}
const ConsoleCtx = createContext<Ctx | null>(null);
export const useConsole = () => {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error("useConsole outside the shell");
  return c;
};

const LANG_KEY = "tk-admin-lang";
const THEME_KEY = "tk-admin-theme";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

type NavItem = { href: string; key: Key; cap?: keyof Me["capabilities"]; soon?: boolean };
/** 24×24 outline icons (single path each) for the side menu. */
const ICON: Record<string, string> = {
  overview: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  kitchen: "M8 2v5a2 2 0 0 1-1 1.7V22H5V8.7A2 2 0 0 1 4 7V2h1v4h1V2h1v4h1V2Zm9 0c2 0 3 2.5 3 6s-1 4-2 4.5V22h-2V2h1ZM11 13h2v9h-2v-9Zm-1-3h4v2h-4v-2Z",
  dispatch: "M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 3 1.5 3.2 3.5.4-2.6 2.4.7 3.5L12 13l-3.1 1.5.7-3.5L7 8.6l3.5-.4L12 5Z",
  orders: "M7 4h10l1 3h3v2h-1l-1.5 10h-13L4 9H3V7h3l1-3Zm1.4 3h7.2l-.3-1H8.7l-.3 1ZM6 9l1.3 8h9.4L18 9H6Z",
  pos: "M4 4h16v10H4V4Zm2 2v6h12V6H6Zm-1 10h14v4H5v-4Zm3 1v2h2v-2H8Zm4 0v2h2v-2h-2Z",
  support: "M12 3a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h2v-7H6v-1a6 6 0 1 1 12 0v1h-3v7h2.2a2 2 0 0 1-2 1H13v2h2.2a4 4 0 0 0 3.9-3.2A3 3 0 0 0 20 16v-5a8 8 0 0 0-8-8Z",
  merchants: "M4 4h16l1 5a3 3 0 0 1-2 2.8V20H5v-8.2A3 3 0 0 1 3 9l1-5Zm3 9v5h4v-5H7Zm6 0v5h4v-5h-4Z",
  zones: "M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z",
  promotions: "M3 11v2l2 .5V18h2v-4l9 3V7L5 10.5 3 11Zm15-4h2v10h-2V7Z",
  customers: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-7 1.7-7 4v3h14v-3c0-2.3-3.7-4-7-4Zm8-2a3 3 0 1 0 0-6v6Zm1 2.2c1.8.6 4 1.7 4 3.8v3h-4v-3c0-1.4-.5-2.7-1.3-3.6l1.3-.2Z",
  riders: "M5 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14-6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM15 5h-3v2h2.3l1.6 3H10l-2-3H5v2h2l1.7 2.6L7.3 12h2.3l1-1.5h5.9l.7 1.4 1.8-.9L15 5Z",
  finance: "M4 20V10h3v10H4Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z",
  payments: "M3 6h18v12H3V6Zm2 2v2h14V8H5Zm0 5v3h14v-3H5Zm2 1h4v1H7v-1Z",
  payouts: "M12 2 3 7v2h18V7l-9-5ZM5 11v6h2v-6H5Zm4 0v6h2v-6H9Zm4 0v6h2v-6h-2Zm4 0v6h2v-6h-2ZM3 19v2h18v-2H3Z",
  team: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1c0-2.8 3.1-5 7-5s7 2.2 7 5v1H5Z",
  markets: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15 15 0 0 0-1.3-6 8 8 0 0 1 4.3 6ZM12 4c.9 1.2 1.8 3.7 1.9 7h-3.8c.1-3.3 1-5.8 1.9-7ZM9.4 5a15 15 0 0 0-1.3 6h-3a8 8 0 0 1 4.3-6Zm-4.3 8h3a15 15 0 0 0 1.3 6 8 8 0 0 1-4.3-6ZM12 20c-.9-1.2-1.8-3.7-1.9-7h3.8c-.1 3.3-1 5.8-1.9 7Zm2.6-1a15 15 0 0 0 1.3-6h3a8 8 0 0 1-4.3 6Z",
  audit: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.6-4.6 1.4 1.4-6 6Z",
  comms: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5v2h10V9H7Zm0 4v2h7v-2H7Z",
  menu: "M4 3h11a2 2 0 0 1 2 2v16l-7-3-7 3V5a2 2 0 0 1 1-2Zm16 2h1v16l-3-1.3V5a2 2 0 0 0-2-2h2a2 2 0 0 1 2 2ZM6 7v2h7V7H6Zm0 4v2h7v-2H6Z",
  membership: "M12 2 15 8l6 .9-4.5 4.3L17.6 20 12 16.9 6.4 20l1.1-6.8L3 8.9 9 8l3-6Z",
  scorecards: "M4 13h3v7H4v-7Zm6.5-5h3v12h-3V8ZM17 4h3v16h-3V4Z",
  coupons: "M4 6h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8a2 2 0 0 1 2-2Zm11 2v2h2V8h-2Zm0 4v4h2v-4h-2Z",
};
const Icon = ({ k }: { k: string }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="nav-ico"><path fill="currentColor" d={ICON[k] ?? ""} /></svg>;

const NAV: { group: Key; items: NavItem[] }[] = [
  { group: "g_operations", items: [
    { href: "/", key: "overview", cap: "overview" },
    { href: "/dispatch/", key: "dispatch", cap: "dispatch" },
    { href: "/kitchen/", key: "kitchen", cap: "kitchen" },
    { href: "/orders/", key: "orders", cap: "orders" },
    { href: "/pos/", key: "pos", soon: true },
    { href: "/support/", key: "support", soon: true },
  ] },
  { group: "g_business", items: [
    { href: "/merchants/", key: "merchants", cap: "catalogue" },
    { href: "/menu/", key: "menu", cap: "catalogue" },
    { href: "/scorecards/", key: "scorecards", cap: "overview" },
    { href: "/zones/", key: "zones", soon: true },
    { href: "/membership/", key: "membership", cap: "membership" },
    { href: "/coupons/", key: "coupons", cap: "markets" },
    { href: "/promotions/", key: "promotions", soon: true },
    { href: "/customers/", key: "customers", soon: true },
    { href: "/riders/", key: "riders", cap: "riders" },
  ] },
  { group: "g_money", items: [
    { href: "/finance/", key: "finance", cap: "finance" },
    { href: "/payments/", key: "payments", cap: "payments" },
    { href: "/payouts/", key: "payouts", soon: true },
  ] },
  { group: "g_platform", items: [
    { href: "/team/", key: "team", cap: "team" },
    { href: "/markets/", key: "markets", cap: "markets" },
    { href: "/comms/", key: "comms", cap: "markets" },
    { href: "/audit/", key: "audit", cap: "audit" },
  ] },
];

export function Shell({ title, children, actions }: { title: Key; children: ReactNode; actions?: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountryState] = useState("CD");
  const [lang, setLang] = useState<Lang>("fr");
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");

  useEffect(() => {
    if (!session.token()) { router.replace("/login/"); return; }
    setCountryState(session.country());
    const l = store.get(LANG_KEY);
    if (l === "en" || l === "fr") setLang(l);
    const th = store.get(THEME_KEY);
    if (th === "light" || th === "dark") setTheme(th);
  }, [router]);

  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const load = useCallback(async (c: string) => {
    try {
      const m = await api<Me>("/v1/me", { country: c });
      setMe(m);
      setError(null);
      // Kitchen teams have no dashboard: their home is the live board.
      if (window.location.pathname === "/" && !m.capabilities.overview && m.capabilities.kitchen) router.replace("/kitchen/");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login/");
      else setError((e as Error).message);
    }
  }, [router]);
  useEffect(() => { if (session.token()) void load(country); }, [country, load]);

  const t = useCallback((k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);
  const setCountry = (c: string) => { session.setCountry(c); setCountryState(c); };

  if (error) return <div className="content"><div className="banner error">{error}</div></div>;
  if (!me) return <div className="content muted">…</div>;

  const initials = me.user.display_name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).map((w) => w.at(0) ?? "").join("").slice(0, 2).toUpperCase();
  return (
    <ConsoleCtx.Provider value={{ me, country, lang, t, setCountry }}>
      <div className="shell">
        <aside className="side" aria-label="Navigation">
          <div className="brand">
            <img src="/brand/tunakula-logo.jpg" alt="Tunakula — Get to eat" width={48} height={48} />
            <div><b>Tunakula</b><small>Admin</small></div>
          </div>
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.soon || (i.cap && me.capabilities[i.cap]));
            if (!items.some((i) => !i.soon)) return null;
            return (
              <div key={g.group} style={{ display: "contents" }}>
                <div className="group">{t(g.group)}</div>
                {items.map((i) => i.soon ? (
                  <a key={i.href} aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }}><Icon k={i.key} />{t(i.key)}<span className="soon">{t("soon")}</span></a>
                ) : (
                  <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== "/" && path.startsWith(i.href)) ? "page" : undefined}><Icon k={i.key} />{t(i.key)}</Link>
                ))}
              </div>
            );
          })}
        </aside>
        <div className="main">
          <header className="top">
            <h1>{t(title)}</h1>
            {actions}
            <select className="select" aria-label="Market" value={country} onChange={(e) => setCountry(e.target.value)}>
              {(me.markets.length ? me.markets : [{ iso2: country, name: country, status: "" }]).map((m) => <option key={m.iso2} value={m.iso2}>{m.iso2} · {m.name}</option>)}
            </select>
            <div className="seg" role="group" aria-label="Language">
              {(["fr", "en"] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => { setLang(l); store.set(LANG_KEY, l); }}>{l.toUpperCase()}</button>)}
            </div>
            <button className="btn ghost" type="button" aria-label="Theme" onClick={() => { const n = theme === "dark" ? "light" : "dark"; setTheme(n); store.set(THEME_KEY, n); }}>{theme === "dark" ? "☀" : "☾"}</button>
            <div className="user">
              <span className="avatar" aria-hidden>{initials}</span>
              <span>{me.user.display_name}</span>
              <button className="link-btn" type="button" onClick={() => { session.setToken(null); router.replace("/login/"); }}>{t("sign_out")}</button>
            </div>
          </header>
          <div className="content">{children}</div>
        </div>
      </div>
    </ConsoleCtx.Provider>
  );
}

/** Renders the page only when the person has the capability; otherwise a plain explanation. */
export function Gate({ cap, children }: { cap: keyof Me["capabilities"]; children: ReactNode }) {
  const { me, t } = useConsole();
  return me.capabilities[cap] ? <>{children}</> : <div className="banner">{t("no_access")}</div>;
}
