import { currencies as defaultRegistry, type CurrencyRegistry } from "./registry.ts";
import { divideRounded, parseDecimal, type Ratio, type RoundingMode } from "./rational.ts";

/** MR-1: amounts are signed 64-bit integers in minor units. */
const INT64_MAX = 2n ** 63n - 1n;
const INT64_MIN = -(2n ** 63n);

export interface MoneyJSON {
  readonly currency: string;
  /** Minor units as a decimal integer string (bigint-safe on the wire). */
  readonly minor: string;
}

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`Cannot combine ${left} with ${right} without an explicit FX conversion`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * An immutable amount of a single currency, held as an integer count of
 * minor units (e.g. cents, or whole francs for zero-decimal currencies).
 */
export class Money {
  readonly currency: string;
  readonly minor: bigint;

  private constructor(currency: string, minor: bigint) {
    if (minor > INT64_MAX || minor < INT64_MIN) {
      throw new RangeError(`Amount ${minor} ${currency} overflows signed 64-bit minor units`);
    }
    this.currency = currency;
    this.minor = minor;
    Object.freeze(this);
  }

  static ofMinor(minor: bigint | number, currency: string, registry: CurrencyRegistry = defaultRegistry): Money {
    registry.get(currency);
    if (typeof minor === "number" && !Number.isSafeInteger(minor)) {
      throw new RangeError(`Minor amount must be a safe integer, got ${minor}`);
    }
    return new Money(currency, BigInt(minor));
  }

  /**
   * Builds money from a decimal string in major units ("12.50").
   * Rejects more precision than the currency allows instead of silently
   * rounding — use `Money.ofMajorRounded` when rounding is intended.
   */
  static of(amount: string, currency: string, registry: CurrencyRegistry = defaultRegistry): Money {
    const { minorUnits } = registry.get(currency);
    const { numerator, denominator } = parseDecimal(amount);
    const scaled = numerator * 10n ** BigInt(minorUnits);
    if (scaled % denominator !== 0n) {
      throw new RangeError(`${amount} has more than ${minorUnits} decimal places for ${currency}`);
    }
    return new Money(currency, scaled / denominator);
  }

  static ofMajorRounded(
    amount: string,
    currency: string,
    mode: RoundingMode,
    registry: CurrencyRegistry = defaultRegistry,
  ): Money {
    const { minorUnits } = registry.get(currency);
    const { numerator, denominator } = parseDecimal(amount);
    return new Money(currency, divideRounded(numerator * 10n ** BigInt(minorUnits), denominator, mode));
  }

  static fromJSON(json: MoneyJSON, registry: CurrencyRegistry = defaultRegistry): Money {
    if (!/^-?\d+$/.test(json.minor)) throw new TypeError(`Invalid minor amount "${json.minor}"`);
    return Money.ofMinor(BigInt(json.minor), json.currency, registry);
  }

  static zero(currency: string, registry: CurrencyRegistry = defaultRegistry): Money {
    return Money.ofMinor(0n, currency, registry);
  }

  static sum(items: readonly Money[], currency: string): Money {
    return items.reduce((total, item) => total.add(item), Money.zero(currency));
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.currency, this.minor + other.minor);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.currency, this.minor - other.minor);
  }

  negate(): Money {
    return new Money(this.currency, -this.minor);
  }

  /** Multiplies by an exact factor such as a quantity, a tax rate ("0.16") or a commission ("0.12"). */
  multiply(factor: string | bigint | Ratio, mode: RoundingMode = "half-even"): Money {
    const { numerator, denominator } = toRatio(factor);
    return new Money(this.currency, divideRounded(this.minor * numerator, denominator, mode));
  }

  /**
   * Splits the amount across weights without losing or creating a single
   * minor unit (largest-remainder method). Used for commission splits,
   * group orders and multi-party settlement.
   */
  allocate(weights: readonly (number | bigint)[]): Money[] {
    const bigWeights = weights.map((w) => BigInt(w));
    if (bigWeights.length === 0) throw new RangeError("At least one weight is required");
    if (bigWeights.some((w) => w < 0n)) throw new RangeError("Weights must be non-negative");
    const total = bigWeights.reduce((a, b) => a + b, 0n);
    if (total === 0n) throw new RangeError("Weights must not all be zero");

    const sign = this.minor < 0n ? -1n : 1n;
    const magnitude = this.minor * sign;
    const shares = bigWeights.map((w) => (magnitude * w) / total);
    const remainders = bigWeights.map((w, i) => ({ i, r: (magnitude * w) % total }));
    let leftover = magnitude - shares.reduce((a, b) => a + b, 0n);

    remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    for (const { i } of remainders) {
      if (leftover === 0n) break;
      shares[i] = (shares[i] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return shares.map((s) => new Money(this.currency, s * sign));
  }

  /**
   * Rounds to a cash increment expressed in minor units, e.g. 5000n for
   * a market whose smallest note in circulation is 50.00.
   */
  roundToIncrement(incrementMinor: bigint, mode: RoundingMode = "half-up"): Money {
    if (incrementMinor <= 0n) throw new RangeError("Increment must be positive");
    return new Money(this.currency, divideRounded(this.minor, incrementMinor, mode) * incrementMinor);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    return this.minor === other.minor ? 0 : this.minor < other.minor ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** Decimal string in major units, e.g. "12.50". Lossless. */
  toDecimalString(registry: CurrencyRegistry = defaultRegistry): string {
    const { minorUnits } = registry.get(this.currency);
    const negative = this.minor < 0n;
    const digits = (negative ? -this.minor : this.minor).toString().padStart(minorUnits + 1, "0");
    const whole = digits.slice(0, digits.length - minorUnits);
    const fraction = digits.slice(digits.length - minorUnits);
    return `${negative ? "-" : ""}${whole}${minorUnits > 0 ? `.${fraction}` : ""}`;
  }

  /** Localised display string, e.g. format("fr-CD") → "12 500,00 FC". */
  format(locale: string, registry: CurrencyRegistry = defaultRegistry): string {
    const { minorUnits } = registry.get(this.currency);
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.currency,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
    });
    // Intl accepts decimal strings, which keeps large amounts exact.
    return formatter.format(this.toDecimalString(registry) as unknown as number);
  }

  toJSON(): MoneyJSON {
    return { currency: this.currency, minor: this.minor.toString() };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  #assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) throw new CurrencyMismatchError(this.currency, other.currency);
  }
}

function toRatio(factor: string | bigint | Ratio): Ratio {
  if (typeof factor === "string") return parseDecimal(factor);
  if (typeof factor === "bigint") return { numerator: factor, denominator: 1n };
  return factor;
}
