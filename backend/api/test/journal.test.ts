import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import { Money, convert, createQuote } from "@tunakula/ts-money";
import { Ledger, PaymentRouter, UnbalancedJournalError, createJournal, reverseJournal } from "../src/index.ts";
import { capability, intent, syntheticProfile } from "./helpers.ts";

const usd = (v: string) => Money.of(v, "USD");
const gbp = (v: string) => Money.of(v, "GBP");

test("journals must balance per currency", () => {
  assert.throws(
    () => createJournal({ id: "j", idempotencyKey: "k", description: "x", entries: [
      { account: "psp_clearing", country: "CD", amount: usd("10.00") },
      { account: "restaurant_payable", country: "CD", amount: usd("-9.99") },
    ] }),
    UnbalancedJournalError,
  );
  // Balanced in USD but a lone GBP leg is not: currencies never net against each other.
  assert.throws(
    () => createJournal({ id: "j", idempotencyKey: "k", description: "x", entries: [
      { account: "psp_clearing", country: "CD", amount: usd("10.00") },
      { account: "restaurant_payable", country: "CD", amount: usd("-10.00") },
      { account: "psp_clearing", country: "GB", amount: gbp("1.00") },
      { account: "customer_receivable", country: "GB", amount: gbp("-0.99") },
    ] }),
    /GBP/,
  );
  assert.throws(() => createJournal({ id: "j", idempotencyKey: "k", description: "x", entries: [{ account: "rounding", country: "CD", amount: usd("1") }] }), /two entries/);
});

test("ledger is append-only: idempotent posting, corrections by reversal only", () => {
  const ledger = new Ledger();
  const j = createJournal({ id: "j1", idempotencyKey: "order-1:settle", description: "settle", entries: [
    { account: "psp_clearing", country: "CD", amount: usd("10.00") },
    { account: "restaurant_payable", country: "CD", amount: usd("-10.00") },
  ] });
  ledger.post(j);
  ledger.post(j);
  assert.equal(ledger.journals().length, 1);
  assert.ok(Object.isFrozen(ledger.journals()[0]?.entries));

  ledger.post(reverseJournal(j, "j2", "posted to wrong restaurant"));
  assert.ok(ledger.balance("restaurant_payable", "CD", "USD").isZero());
  // Replaying the reversal is deduplicated by its idempotency key…
  ledger.post(reverseJournal(j, "j3", "replayed"));
  assert.equal(ledger.journals().length, 2);
  // …and a second, distinct reversal of the same journal is refused.
  const second = createJournal({ ...reverseJournal(j, "j4", "double"), idempotencyKey: "other-key" });
  assert.throws(() => ledger.post(second), /already reversed/);
  assert.equal(ledger.journals().length, 2);
});

test("end to end: payer in GB sends a meal to Kinshasa (PRD §19.2, §33.1)", async () => {
  const cd = syntheticProfile("cd");
  const at = new Date("2026-10-04T12:00:00Z");

  // 1. Order priced in the settlement currency of the restaurant's market.
  const menu = usd("18.50");
  const deliveryFee = usd("2.00");
  const subtotal = menu.add(deliveryFee);

  // 2. FX snapshot locked at checkout (rate comes from the licensed partner).
  const quote = createQuote({ id: randomUUID(), base: "USD", quote: "GBP", midRate: "0.7500", spreadBps: 100, source: "bitripay-fx", quotedAt: at });
  const fx = convert(subtotal, quote, { at });
  assert.equal(fx.atMid.toDecimalString(), "15.38");
  assert.equal(fx.charged.toDecimalString(), "15.53");

  // 3. Routing: governed by the CD profile (order market), payer country GB.
  const bitripay = new SandboxConnector({
    id: "bitripay",
    capabilities: [capability({ methodType: "CARD", countries: ["GB"], currencies: ["GBP"], settlement: { currency: "GBP", delayDays: 2 } })],
  });
  const outcome = await new PaymentRouter([bitripay]).pay(
    cd,
    intent({ methodType: "CARD", payerCountry: "GB", marketCountry: "CD", amount: fx.charged.toJSON(), payer: { token: "tok_test" }, metadata: { fx_quote_id: quote.id } }),
  );
  assert.equal(outcome.status, "SUCCEEDED");

  // 4. Ledger: each currency balances on its own; splits in settlement currency (MR-5).
  // §18.1: zero merchant commission — the restaurant receives the full menu price;
  // the rider keeps 70% of the delivery fee and the platform 30%.
  const riderShare = deliveryFee.multiply("0.70");
  const ledger = new Ledger();
  ledger.post(createJournal({ id: "j-collect", idempotencyKey: `${quote.id}:collect`, description: "XBO collection in GBP", entries: [
    { account: "psp_clearing", country: "GB", amount: fx.charged },
    { account: "fx_spread_revenue", country: "GB", amount: fx.spread.negate() },
    { account: "customer_receivable", country: "GB", amount: fx.atMid.negate() },
  ] }));
  ledger.post(createJournal({ id: "j-settle", idempotencyKey: `${quote.id}:settle`, description: "Partner settles USD to the CD market", entries: [
    { account: "psp_clearing", country: "CD", amount: subtotal },
    { account: "restaurant_payable", country: "CD", amount: menu.negate() },
    { account: "rider_payable", country: "CD", amount: riderShare.negate() },
    { account: "delivery_fee_revenue", country: "CD", amount: deliveryFee.subtract(riderShare).negate() },
  ] }));

  assert.equal(ledger.balance("restaurant_payable", "CD", "USD").toDecimalString(), "-18.50");
  assert.ok(ledger.balance("commission_revenue", "CD", "USD").isZero(), "no commission, ever (PRC-001)");
  assert.equal(ledger.balance("rider_payable", "CD", "USD").toDecimalString(), "-1.40");
  assert.equal(ledger.balance("fx_spread_revenue", "GB", "GBP").toDecimalString(), "-0.15");
});
