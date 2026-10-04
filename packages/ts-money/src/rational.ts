/**
 * Exact rational arithmetic on bigint. Money never touches floating point:
 * rates, percentages and tax rates are parsed from decimal strings into
 * fractions and only rounded once, at the end, with an explicit mode.
 */

export type RoundingMode =
  /** Round half away from zero — common retail rounding. */
  | "half-up"
  /** Round half to even — banker's rounding, used for FX and ledgers. */
  | "half-even"
  /** Towards negative infinity. */
  | "floor"
  /** Towards positive infinity. */
  | "ceil"
  /** Towards zero. */
  | "truncate";

export interface Ratio {
  readonly numerator: bigint;
  /** Always positive. */
  readonly denominator: bigint;
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** Parses "655.957", "0.15", "-2" into an exact ratio. */
export function parseDecimal(value: string): Ratio {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) throw new TypeError(`Invalid decimal "${value}"`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  const denominator = 10n ** BigInt(fraction.length);
  const magnitude = BigInt(whole + fraction);
  return { numerator: sign === "-" ? -magnitude : magnitude, denominator };
}

export function ratio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator === 0n) throw new RangeError("Division by zero");
  return denominator < 0n
    ? { numerator: -numerator, denominator: -denominator }
    : { numerator, denominator };
}

/** Divides `numerator / denominator` and rounds to an integer. */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const { numerator: n, denominator: d } = ratio(numerator, denominator);
  const quotient = n / d; // truncates toward zero
  const remainder = n % d;
  if (remainder === 0n) return quotient;

  const negative = n < 0n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const awayFromZero = negative ? quotient - 1n : quotient + 1n;

  switch (mode) {
    case "truncate":
      return quotient;
    case "floor":
      return negative ? quotient - 1n : quotient;
    case "ceil":
      return negative ? quotient : quotient + 1n;
    case "half-up":
      return twiceRemainder >= d ? awayFromZero : quotient;
    case "half-even":
      if (twiceRemainder > d) return awayFromZero;
      if (twiceRemainder < d) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
  }
}
