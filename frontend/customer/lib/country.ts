/**
 * Which market the storefront serves, resolved at runtime so one build (and one domain) can serve any country.
 * Resolution order: an explicit override the customer picked → a ?country= query → the subdomain (cd.tunakula.com,
 * and the DRC/RDC aliases) → the default, CD. The resolved code is sent as the X-Country header on every request;
 * the API is host-agnostic, so switching market never needs a different build or API host. SSR-safe (build → CD).
 */
export interface Market { readonly code: string; readonly name: string; readonly live: boolean; readonly flag: string }

/** CD (DR Congo) is live today; the rest are on the roadmap and shown "coming soon" in the picker. */
export const MARKETS: readonly Market[] = [
  { code: "CD", name: "RD Congo", live: true, flag: "🇨🇩" },
  { code: "CG", name: "Congo-Brazzaville", live: false, flag: "🇨🇬" },
  { code: "AO", name: "Angola", live: false, flag: "🇦🇴" },
  { code: "GB", name: "United Kingdom", live: false, flag: "🇬🇧" },
];

const DEFAULT = "CD";
const KEY = "tk-country";
/** Marketing / legacy labels that mean a market (so drc.tunakula.com and ?country=drc still resolve to CD). */
const ALIAS: Record<string, string> = { drc: "CD", rdc: "CD", congo: "CD", kinshasa: "CD" };

function normalise(value: string | null | undefined): string | null {
  if (!value) return null;
  const alias = ALIAS[value.toLowerCase()];
  if (alias) return alias;
  const up = value.toUpperCase();
  return /^[A-Z]{2}$/.test(up) ? up : null;
}

/** Resolves the active market for this page load. */
export function resolveCountry(): string {
  if (typeof window === "undefined") return DEFAULT; // build / prerender
  try { const o = normalise(localStorage.getItem(KEY)); if (o) return o; } catch { /* storage blocked */ }
  try { const q = normalise(new URLSearchParams(window.location.search).get("country")); if (q) return q; } catch { /* no search */ }
  const label = window.location.hostname.toLowerCase().split(".")[0];
  if (label && !["www", "tunakula", "localhost", "127"].includes(label)) { const s = normalise(label); if (s) return s; }
  return DEFAULT;
}

/** The resolved market code for this page load. */
export const COUNTRY = resolveCountry();
export const market = (code: string = COUNTRY): Market | undefined => MARKETS.find((m) => m.code === code);

/** Switch market: persist the choice and reload so every subsequent request carries the new X-Country. */
export function setCountry(code: string): void {
  try { localStorage.setItem(KEY, code.toUpperCase()); } catch { /* storage blocked */ }
  if (typeof window !== "undefined") window.location.reload();
}
