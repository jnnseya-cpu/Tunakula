"use client";
/**
 * Storefront language switcher (Français / English / Lingála / Kiswahili). Picking a language saves the choice and
 * reloads so the whole storefront renders in it. Renders the current language on first paint, then settles on the
 * resolved one after mount to avoid hydration drift.
 */
import { useEffect, useState } from "react";
import { LANGS, resolveLang, setLang, type Lang } from "../lib/i18n";
import { api, getSession } from "../lib/api";

export function LangSwitcher() {
  const [code, setCode] = useState<Lang>("fr");
  useEffect(() => { setCode(resolveLang()); }, []);
  const choose = async (l: Lang) => {
    if (l === code) return;
    // If signed in, remember the choice server-side so the AI agents write to them in it. Best-effort.
    if (getSession()) { try { await api("/v1/me/locale", { method: "POST", body: { locale: l } }); } catch { /* best-effort */ } }
    setLang(l);
  };
  return (
    <label className="lang-switch" title="Language / langue">
      <select aria-label="Language" value={code} onChange={(e) => { void choose(e.target.value as Lang); }}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
