"use client";
/**
 * `<T k="key" />` — renders a translated string inside otherwise-static (server) pages. It defers to the `useT`
 * hook, so it paints the default language first and settles on the viewer's choice after mount. Pass `vars` for
 * {placeholder} interpolation. Use this for one-off labels in server components; use `useT` directly inside
 * components that are already client-side.
 */
import { useT } from "./use-t";

export function T({ k, vars }: { k: string; vars?: Record<string, string | number> }) {
  const t = useT();
  return <>{t(k, vars)}</>;
}
