/** Figures the website publishes (shared/ts-contracts/published) must be what the pricing engine charges. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { Money } from "@tunakula/ts-money";
import { deliveryFee, priceOrder } from "../src/index.ts";

const ladder = createRequire(import.meta.url)("@tunakula/ts-contracts/published/rider-ladder.json") as {
  currency: string;
  pricing: Parameters<typeof deliveryFee>[0];
  rows: { label: string; from_km: number; to_km: number; fee: string; rider: string; rider_rural: string }[];
};

test("the published ladder uses the §18 group defaults", () => {
  assert.deepEqual(ladder.pricing, syntheticProfileDocument("cd")["pricing"]);
});

test("every published row, at both ends of its range, is what the engine computes", () => {
  for (const row of ladder.rows) {
    for (const km of new Set([row.from_km, row.to_km])) {
      const urban = deliveryFee(ladder.pricing, ladder.currency, { distanceMeters: km * 1000, rural: false });
      const rural = deliveryFee(ladder.pricing, ladder.currency, { distanceMeters: km * 1000, rural: true });
      assert.equal(urban.fee.toDecimalString(), row.fee, `${row.label} @ ${km} km fee`);
      assert.equal(urban.riderShare.toDecimalString(), row.rider, `${row.label} @ ${km} km rider`);
      assert.equal(rural.riderShare.toDecimalString(), row.rider_rural, `${row.label} @ ${km} km rural rider`);
    }
  }
});

const comparison = createRequire(import.meta.url)("@tunakula/ts-contracts/published/fee-comparison.json") as {
  currency: string;
  goods: string;
  distance_km: number;
  tunakula: Record<"menu" | "commission" | "delivery" | "service" | "customer_pays" | "restaurant_keeps", string>;
  competitors: { label: string; commission_bps: number; markup_bps: number; menu: string; commission: string; customer_pays: string; restaurant_keeps: string }[];
};

test("the published 'same meal' comparison: Tunakula row from the engine, competitor rows by their stated rule", () => {
  const ccy = comparison.currency;
  const b = priceOrder(ladder.pricing, {
    goods: Money.of(comparison.goods, ccy),
    channel: "ONLINE",
    orderType: "DELIVERY",
    delivery: { distanceMeters: comparison.distance_km * 1000, rural: false },
  });
  const t = comparison.tunakula;
  assert.equal(b.goods.toDecimalString(), t.menu);
  assert.equal(b.commission.toDecimalString(), t.commission);
  assert.equal(b.delivery?.fee.toDecimalString(), t.delivery);
  assert.equal(b.serviceCharge.toDecimalString(), t.service);
  assert.equal(b.total.toDecimalString(), t.customer_pays);
  assert.equal(b.merchantReceives.toDecimalString(), t.restaurant_keeps);

  const pct = (m: Money, bps: number) => Money.ofMinor((m.minor * BigInt(bps)) / 10_000n, m.currency); // exact for these inputs
  const delivery = Money.of(t.delivery, ccy);
  for (const c of comparison.competitors) {
    const menu = Money.of(comparison.goods, ccy).add(pct(Money.of(comparison.goods, ccy), c.markup_bps));
    const commission = pct(menu, c.commission_bps);
    const service = pct(menu, ladder.pricing.service_charge_bps);
    assert.equal(menu.toDecimalString(), c.menu, c.label);
    assert.equal(commission.toDecimalString(), c.commission, c.label);
    assert.equal(menu.subtract(commission).toDecimalString(), c.restaurant_keeps, c.label);
    assert.equal(menu.add(delivery).add(service).toDecimalString(), c.customer_pays, c.label);
  }
});
