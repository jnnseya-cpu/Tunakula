import type { MoneyWire } from "./api/types";

/**
 * Format a Money wire value (integer minor units + ISO currency) for display. Minor units are divided by
 * the currency's own fraction digits — 2 for USD, 0 for CDF (the Congolese franc) — read from Intl so we
 * never hard-code "/100". Hermes ships Intl, so this works on-device. Display only; every charged amount
 * comes from the server, never recomputed here.
 */
export function formatMoney(m: MoneyWire, locale = "fr-CD"): string {
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: m.currency });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  const major = Number(m.amount_minor) / 10 ** digits;
  try {
    return nf.format(major);
  } catch {
    return `${m.currency} ${major.toLocaleString(locale)}`;
  }
}

/** Multiply a money value by a whole quantity, staying in integer minor units. */
export function times(m: MoneyWire, quantity: number): MoneyWire {
  return { amount_minor: String(BigInt(m.amount_minor) * BigInt(quantity)), currency: m.currency };
}

/** Sum money values (assumed same currency; a cart is single-currency). Returns zero-of-currency if empty. */
export function sum(values: readonly MoneyWire[], currency: string): MoneyWire {
  const total = values.reduce((acc, v) => acc + BigInt(v.amount_minor), 0n);
  return { amount_minor: String(total), currency: values[0]?.currency ?? currency };
}
