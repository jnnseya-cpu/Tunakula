import { Money } from "./money.ts";
import { currencies as defaultRegistry, type CurrencyRegistry, type VolatilityClass } from "./registry.ts";
import { divideRounded, parseDecimal, type RoundingMode } from "./rational.ts";

/** PRD §19.5: FX quote time-to-live per volatility class. */
export const QUOTE_TTL_MS: Readonly<Record<VolatilityClass, number>> = {
  PEGGED: 30 * 60_000,
  MANAGED: 15 * 60_000,
  VOLATILE: 5 * 60_000,
  HYPER: 2 * 60_000,
};

/**
 * A firm, time-boxed FX snapshot (PRD §21 `fx_quote`, MR-4): 1 unit of `base`
 * = `midRate` units of `quote`, in major units. Rates may be decimal; amounts
 * may not. The order stores the quote id so every cross-currency amount can
 * be audited back to the rate the customer saw.
 */
export interface FxQuote {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  /** Exact decimal string, never a float. */
  readonly midRate: string;
  /** Platform spread in basis points, charged on top of mid (MR-9). */
  readonly spreadBps: number;
  readonly source: string;
  readonly quotedAt: Date;
  readonly expiresAt: Date;
}

export class FxQuoteExpiredError extends Error {
  readonly quoteId: string;

  constructor(quoteId: string) {
    super(`FX quote ${quoteId} has expired; re-quote before checkout`);
    this.name = "FxQuoteExpiredError";
    this.quoteId = quoteId;
  }
}

export interface CreateQuoteInput {
  id: string;
  base: string;
  quote: string;
  midRate: string;
  spreadBps: number;
  source: string;
  quotedAt?: Date;
  registry?: CurrencyRegistry;
}

/**
 * Builds a quote whose expiry follows the stricter (shorter) TTL of the two
 * currencies' volatility classes.
 */
export function createQuote(input: CreateQuoteInput): FxQuote {
  const { registry = defaultRegistry, quotedAt = new Date() } = input;
  const base = registry.getActive(input.base);
  const quote = registry.getActive(input.quote);
  if (base.code === quote.code) throw new RangeError("A quote needs two different currencies");
  if (parseDecimal(input.midRate).numerator <= 0n) throw new RangeError("Mid rate must be positive");
  if (!Number.isInteger(input.spreadBps) || input.spreadBps < 0) {
    throw new RangeError("Spread must be a non-negative whole number of basis points");
  }
  const ttl = Math.min(QUOTE_TTL_MS[base.volatilityClass], QUOTE_TTL_MS[quote.volatilityClass]);
  return Object.freeze({
    id: input.id,
    base: base.code,
    quote: quote.code,
    midRate: input.midRate,
    spreadBps: input.spreadBps,
    source: input.source,
    quotedAt,
    expiresAt: new Date(quotedAt.getTime() + ttl),
  });
}

export interface ConversionOptions {
  at?: Date;
  mode?: RoundingMode;
  registry?: CurrencyRegistry;
}

export interface Conversion {
  /** What the payer is charged, spread included. */
  readonly charged: Money;
  /** The same amount at the mid rate. */
  readonly atMid: Money;
  /** `charged − atMid`, posted to `fx_spread_revenue`. */
  readonly spread: Money;
  readonly quoteId: string;
}

/**
 * Converts an amount in the quote's base currency into its quote currency.
 * Used for "pay abroad, eat at home": a Kinshasa order priced in USD is paid
 * in GBP by a payer in London, at the rate locked at checkout.
 */
export function convert(money: Money, quote: FxQuote, options: ConversionOptions = {}): Conversion {
  const { at = new Date(), mode = "half-up", registry = defaultRegistry } = options;
  if (money.currency !== quote.base) {
    throw new TypeError(`Quote ${quote.id} converts ${quote.base}, not ${money.currency}`);
  }
  if (at.getTime() >= quote.expiresAt.getTime()) throw new FxQuoteExpiredError(quote.id);

  const fromScale = 10n ** BigInt(registry.get(quote.base).minorUnits);
  const toScale = 10n ** BigInt(registry.get(quote.quote).minorUnits);
  const rate = parseDecimal(quote.midRate);

  // to_minor = from_minor × rate × 10^to / 10^from, rounded once (MR-8).
  const midNumerator = money.minor * rate.numerator * toScale;
  const midDenominator = rate.denominator * fromScale;
  const atMid = divideRounded(midNumerator, midDenominator, mode);
  const charged = divideRounded(
    midNumerator * BigInt(10_000 + quote.spreadBps),
    midDenominator * 10_000n,
    mode,
  );

  const chargedMoney = Money.ofMinor(charged, quote.quote, registry);
  const atMidMoney = Money.ofMinor(atMid, quote.quote, registry);
  return Object.freeze({
    charged: chargedMoney,
    atMid: atMidMoney,
    spread: chargedMoney.subtract(atMidMoney),
    quoteId: quote.id,
  });
}
