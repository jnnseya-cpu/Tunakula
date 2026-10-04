import { Money } from "./money.ts";
import { currencies as defaultRegistry, type CurrencyRegistry } from "./registry.ts";
import { parseDecimal, type RoundingMode } from "./rational.ts";

/**
 * Per-market cash rounding (PRD §19.4): separate from ISO minor units, it
 * reflects the smallest note or coin in practical use — e.g. CDF to the
 * nearest 100 FC, USD to 0.25 in a dual-currency market.
 */
export interface CashRoundingRule {
  readonly currency: string;
  /** Smallest practical unit, in major units, as a decimal string. */
  readonly increment: string;
  readonly mode: RoundingMode;
}

export function incrementInMinorUnits(rule: CashRoundingRule, registry: CurrencyRegistry = defaultRegistry): bigint {
  const { minorUnits } = registry.get(rule.currency);
  const { numerator, denominator } = parseDecimal(rule.increment);
  const scaled = numerator * 10n ** BigInt(minorUnits);
  if (scaled <= 0n || scaled % denominator !== 0n) {
    throw new RangeError(`Cash increment ${rule.increment} is not representable in ${rule.currency}`);
  }
  return scaled / denominator;
}

/**
 * Rounds a payable amount to the market's cash increment. Returns the rounded
 * amount and the difference, which posts to the `rounding` ledger account (MR-8).
 */
export function applyCashRounding(
  amount: Money,
  rule: CashRoundingRule,
  registry: CurrencyRegistry = defaultRegistry,
): { rounded: Money; difference: Money } {
  if (amount.currency !== rule.currency) {
    throw new TypeError(`Rule is for ${rule.currency}, amount is ${amount.currency}`);
  }
  const rounded = amount.roundToIncrement(incrementInMinorUnits(rule, registry), rule.mode);
  return { rounded, difference: rounded.subtract(amount) };
}
