/**
 * Display formatting only. Amounts arrive as minor units in strings (the API's wire format); they are
 * converted to a decimal string by place shifting, never by floating-point arithmetic, before Intl formats them.
 */
import type { Lang } from "./i18n";

const locale = (lang: Lang) => (lang === "fr" ? "fr-CD" : "en-GB");
const digitsOf = (currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;

/** "123456" minor units of USD → "1234.56" exactly. */
export function minorToDecimal(minor: string, currency: string): string {
  const d = digitsOf(currency);
  const neg = minor.startsWith("-");
  const digits = (neg ? minor.slice(1) : minor).padStart(d + 1, "0");
  const s = d ? `${digits.slice(0, -d)}.${digits.slice(-d)}` : digits;
  return neg ? `-${s}` : s;
}

export function money(lang: Lang, minor: string, currency: string, opts: { compact?: boolean } = {}): string {
  const value = Number(minorToDecimal(minor, currency)); // display only
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency,
    ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  }).format(value);
}

/** For chart geometry: a plotted length, never a stored or summed amount. */
export const minorToNumber = (minor: string, currency: string) => Number(minorToDecimal(minor, currency));

export const count = (lang: Lang, n: number, compact = false) =>
  new Intl.NumberFormat(locale(lang), compact ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n);

export const pct = (lang: Lang, ratio: number, digits = 1) =>
  new Intl.NumberFormat(locale(lang), { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(ratio);

export const dateShort = (lang: Lang, iso: string) => new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

export const dateTime = (lang: Lang, iso: string, timeZone = "Africa/Kinshasa") =>
  new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

/** Clean axis ticks: 0 and up to `n` round steps covering `max`. */
export function niceTicks(max: number, n = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
