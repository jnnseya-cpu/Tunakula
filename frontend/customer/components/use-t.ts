"use client";
/**
 * `useT` — a translator bound to the viewer's chosen language for use inside client components on the statically
 * exported storefront. First paint renders in the default language (French) so server HTML and the first client
 * render match; a mount effect then resolves the saved/browser language and re-renders if it differs. Switching
 * language reloads the page (see `setLang`), after which this resolves straight to the new choice.
 */
import { useEffect, useState } from "react";
import { resolveLang, translate, type Lang } from "../lib/i18n";

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const [l, setL] = useState<Lang>("fr");
  useEffect(() => { setL(resolveLang()); }, []);
  return (key, vars) => translate(key, l, vars);
}
