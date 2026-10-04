import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { CurrencyMismatchError, Money, currencies, divideRounded, type RoundingMode } from "../src/index.ts";

test("parses major units exactly and rejects excess precision (§19.4)", () => {
  assert.equal(Money.of("18.50", "USD").minor, 1850n);
  assert.equal(Money.of("5000", "XOF").minor, 5000n);
  assert.equal(Money.of("1.234", "TND").minor, 1234n);
  assert.throws(() => Money.of("10.5", "XOF"), /decimal places/);
  assert.throws(() => Money.of("1.001", "USD"), /decimal places/);
  assert.equal(Money.ofMajorRounded("1.005", "USD", "half-up").minor, 101n);
  assert.throws(() => Money.of("1e3", "USD"), /Invalid decimal/);
});

test("refuses to mix currencies without FX", () => {
  assert.throws(() => Money.of("1", "USD").add(Money.of("1", "CDF")), CurrencyMismatchError);
});

test("enforces signed 64-bit minor units (MR-1)", () => {
  assert.throws(() => Money.ofMinor(2n ** 63n, "USD"), /64-bit/);
  assert.throws(() => Money.ofMinor(0.5, "USD"), /safe integer/);
  Money.ofMinor(2n ** 63n - 1n, "USD");
});

test("decimal strings and JSON round-trip losslessly", () => {
  assert.equal(Money.of("-0.05", "USD").toDecimalString(), "-0.05");
  assert.equal(Money.of("1500", "XAF").toDecimalString(), "1500");
  const m = Money.of("12.345", "LYD");
  assert.ok(Money.fromJSON(JSON.parse(JSON.stringify(m))).equals(m));
});

test("formats by locale with currency precision", () => {
  assert.equal(Money.of("15.38", "GBP").format("en-GB"), "£15.38");
  assert.equal(Money.of("5000", "XOF").format("fr-SN").replace(/\s/g, " "), "5 000 F CFA");
});

test("multiply applies exact rates with explicit rounding", () => {
  assert.equal(Money.of("18.50", "USD").multiply("0.16").minor, 296n);
  assert.equal(Money.of("0.25", "USD").multiply("0.5", "half-even").minor, 12n);
  assert.equal(Money.of("0.25", "USD").multiply("0.5", "half-up").minor, 13n);
});

test("rounding modes match their definitions", () => {
  const cases: [bigint, bigint, RoundingMode, bigint][] = [
    [5n, 2n, "half-up", 3n],
    [-5n, 2n, "half-up", -3n],
    [5n, 2n, "half-even", 2n],
    [7n, 2n, "half-even", 4n],
    [-5n, 2n, "half-even", -2n],
    [5n, 2n, "floor", 2n],
    [-5n, 2n, "floor", -3n],
    [5n, 2n, "ceil", 3n],
    [-5n, 2n, "ceil", -2n],
    [-5n, 2n, "truncate", -2n],
  ];
  for (const [n, d, mode, expected] of cases) assert.equal(divideRounded(n, d, mode), expected, `${n}/${d} ${mode}`);
});

const activeCodes = currencies.list({ status: "ACTIVE" }).map((c) => c.code);
const minor = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const code = fc.constantFrom(...activeCodes);
const weights = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 }).filter((w) => w.some((x) => x > 0));

test("property: allocate never creates or loses a minor unit", () => {
  fc.assert(
    fc.property(minor, code, weights, (amount, ccy, ws) => {
      const parts = Money.ofMinor(amount, ccy).allocate(ws);
      assert.equal(parts.reduce((t, p) => t + p.minor, 0n), amount);
      // Zero weight always yields zero; shares differ from exact by < 1 unit.
      const total = BigInt(ws.reduce((a, b) => a + b, 0));
      parts.forEach((p, i) => {
        const exact = amount * BigInt(ws[i] ?? 0);
        const diff = p.minor * total - exact;
        assert.ok(diff > -total && diff < total);
        if (ws[i] === 0) assert.equal(p.minor, 0n);
      });
    }),
  );
});

test("property: add/subtract are inverse and commutative", () => {
  fc.assert(
    fc.property(minor, minor, code, (a, b, ccy) => {
      const x = Money.ofMinor(a, ccy);
      const y = Money.ofMinor(b, ccy);
      assert.ok(x.add(y).subtract(y).equals(x));
      assert.ok(x.add(y).equals(y.add(x)));
    }),
  );
});

test("property: decimal string round-trips for every currency", () => {
  fc.assert(
    fc.property(minor, code, (a, ccy) => {
      const m = Money.ofMinor(a, ccy);
      assert.ok(Money.of(m.toDecimalString(), ccy).equals(m));
    }),
  );
});

test("property: every rounding mode lands within one unit of the exact value", () => {
  const modes: RoundingMode[] = ["half-up", "half-even", "floor", "ceil", "truncate"];
  fc.assert(
    fc.property(minor, fc.bigInt({ min: 1n, max: 10n ** 6n }), fc.constantFrom(...modes), (n, d, mode) => {
      const r = divideRounded(n, d, mode);
      const diff = r * d - n;
      assert.ok(diff > -d && diff < d);
      if (mode === "floor") assert.ok(diff <= 0n);
      if (mode === "ceil") assert.ok(diff >= 0n);
    }),
  );
});
