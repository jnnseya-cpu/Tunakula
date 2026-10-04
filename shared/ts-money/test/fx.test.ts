import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  FxQuoteExpiredError,
  Money,
  QUOTE_TTL_MS,
  applyCashRounding,
  convert,
  createQuote,
} from "../src/index.ts";

const t0 = new Date("2026-10-04T12:00:00Z");

test("PRD §19.2 worked example: 20.50 USD at 0.7500 → 15.38 GBP", () => {
  const quote = createQuote({ id: "q1", base: "USD", quote: "GBP", midRate: "0.7500", spreadBps: 0, source: "test", quotedAt: t0 });
  const subtotal = Money.of("18.50", "USD").add(Money.of("2.00", "USD"));
  const { charged } = convert(subtotal, quote, { at: t0 });
  assert.equal(charged.toDecimalString(), "15.38");
});

test("spread is charged on top of mid and reported separately (MR-9)", () => {
  const quote = createQuote({ id: "q2", base: "USD", quote: "GBP", midRate: "0.75", spreadBps: 150, source: "test", quotedAt: t0 });
  const result = convert(Money.of("100.00", "USD"), quote, { at: t0 });
  assert.equal(result.atMid.toDecimalString(), "75.00");
  assert.equal(result.charged.toDecimalString(), "76.13"); // 75 × 1.015 = 76.125 → half-up
  assert.equal(result.spread.toDecimalString(), "1.13");
  assert.equal(result.quoteId, "q2");
});

test("converts across different minor units (2 → 0 decimals)", () => {
  const quote = createQuote({ id: "q3", base: "EUR", quote: "XOF", midRate: "655.957", spreadBps: 0, source: "peg", quotedAt: t0 });
  assert.equal(convert(Money.of("10.00", "EUR"), quote, { at: t0 }).charged.minor, 6560n);
});

test("TTL follows the stricter volatility class (§19.5) and expired quotes refuse", () => {
  const pegged = createQuote({ id: "a", base: "EUR", quote: "XOF", midRate: "655.957", spreadBps: 0, source: "x", quotedAt: t0 });
  assert.equal(pegged.expiresAt.getTime() - t0.getTime(), QUOTE_TTL_MS.MANAGED);
  const volatile = createQuote({ id: "b", base: "USD", quote: "CDF", midRate: "2850", spreadBps: 0, source: "x", quotedAt: t0 });
  assert.equal(volatile.expiresAt.getTime() - t0.getTime(), QUOTE_TTL_MS.VOLATILE);
  assert.throws(() => convert(Money.of("1", "USD"), volatile, { at: volatile.expiresAt }), FxQuoteExpiredError);
  assert.throws(() => convert(Money.of("1", "EUR"), volatile, { at: t0 }), /converts USD/);
});

test("quotes reject retired currencies and bad inputs", () => {
  const base = { id: "x", quote: "GBP", midRate: "1", spreadBps: 0, source: "x" };
  assert.throws(() => createQuote({ ...base, base: "SLL" }), /retired/);
  assert.throws(() => createQuote({ ...base, base: "GBP" }), /different/);
  assert.throws(() => createQuote({ ...base, base: "USD", midRate: "0" }), /positive/);
  assert.throws(() => createQuote({ ...base, base: "USD", spreadBps: -1 }), /basis points/);
});

test("cash rounding to market increments with the difference reported (MR-8)", () => {
  const cdf = applyCashRounding(Money.of("5249.00", "CDF"), { currency: "CDF", increment: "100", mode: "half-up" });
  assert.equal(cdf.rounded.toDecimalString(), "5200.00");
  assert.equal(cdf.difference.toDecimalString(), "-49.00");
  const usd = applyCashRounding(Money.of("15.38", "USD"), { currency: "USD", increment: "0.25", mode: "half-up" });
  assert.equal(usd.rounded.toDecimalString(), "15.50");
  assert.throws(() => applyCashRounding(Money.of("1", "XOF"), { currency: "XOF", increment: "0.5", mode: "half-up" }), /not representable/);
});

test("property: spread never makes the payer pay less than mid", () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 10n ** 12n }),
      fc.integer({ min: 0, max: 2000 }),
      fc.stringMatching(/^[1-9]\d{0,3}\.\d{1,6}$/),
      (amount, bps, rate) => {
        const quote = createQuote({ id: "p", base: "USD", quote: "CDF", midRate: rate, spreadBps: bps, source: "x", quotedAt: t0 });
        const r = convert(Money.ofMinor(amount, "USD"), quote, { at: t0 });
        assert.ok(!r.spread.isNegative());
        assert.ok(r.charged.equals(r.atMid.add(r.spread)));
      },
    ),
  );
});
