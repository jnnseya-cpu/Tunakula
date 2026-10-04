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
const NAV: { group: Key; items: NavItem[] }[] = [
  { group: "g_operations", items: [
    { href: "/", key: "overview", cap: "overview" },
    { href: "/orders/", key: "orders", cap: "orders" },
    { href: "/pos/", key: "pos", soon: true },
    { href: "/support/", key: "support", soon: true },
  ] },
  { group: "g_business", items: [
    { href: "/merchants/", key: "merchants", cap: "catalogue" },
    { href: "/zones/", key: "zones", soon: true },
    { href: "/promotions/", key: "promotions", soon: true },
    { href: "/customers/", key: "customers", soon: true },
    { href: "/riders/", key: "riders", soon: true },
  ] },
  { group: "g_money", items: [
    { href: "/finance/", key: "finance", cap: "finance" },
    { href: "/payments/", key: "payments", cap: "payments" },
    { href: "/payouts/", key: "payouts", soon: true },
  ] },
  { group: "g_platform", items: [
    { href: "/team/", key: "team", cap: "team" },
    { href: "/markets/", key: "markets", cap: "markets" },
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
      setMe(await api<Me>("/v1/me", { country: c }));
      setError(null);
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
                  <a key={i.href} aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }}>{t(i.key)}<span className="soon">{t("soon")}</span></a>
                ) : (
                  <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== "/" && path.startsWith(i.href)) ? "page" : undefined}>{t(i.key)}</Link>
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
