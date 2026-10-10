"use client";
/**
 * Storefront language switcher (Français / English / Lingála / Kiswahili). Picking a language saves the choice and
 * reloads so the whole storefront renders in it. Renders the current language on first paint, then settles on the
 * resolved one after mount to avoid hydration drift.
 */
import { useEffect, useState } from "react";
import { LANGS, resolveLang, setLang, type Lang } from "../lib/i18n";

export function LangSwitcher() {
  const [code, setCode] = useState<Lang>("fr");
  useEffect(() => { setCode(resolveLang()); }, []);
  return (
    <label className="lang-switch" title="Language / langue">
      <select aria-label="Language" value={code} onChange={(e) => { const l = e.target.value as Lang; if (l !== code) setLang(l); }}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
