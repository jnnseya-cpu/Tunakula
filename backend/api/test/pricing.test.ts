import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "@tunakula/ts-money";
import {
  PricingError,
  deliveryFee,
  displayItemPrice,
  orderSettlementJournal,
  priceOrder,
  proportionalRefund,
  riderBonus,
  type PricingConfig,
} from "../src/index.ts";
import { syntheticProfile } from "./helpers.ts";

const usd = (v: string) => Money.of(v, "USD");
const cd = syntheticProfile("cd").pricing; // group defaults, USD
const gb = syntheticProfile("gb").pricing; // all-in pricing market
const sn = syntheticProfile("sn").pricing; // XOF, zero decimals
const km = (k: number) => k * 1000;
const fee = (p: PricingConfig, ccy: string, k: number, rural = false, surge?: string) =>
  deliveryFee(p, ccy, { distanceMeters: km(k), rural, ...(surge ? { surge: { multiplier: surge, trigger: "rain", zoneId: "z1" } } : {}) });
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof PricingError && e.code === code, code);

test("PRC-004/005/006/007: the §18.3 ladder, rural 75% and rider 70%, row by row", () => {
  // [km, city, rural, rider (city)]
  const table: [number, string, string, string][] = [
    [1, "1.00", "0.75", "0.70"],
    [2, "2.00", "1.50", "1.40"],
    [3, "3.00", "2.25", "2.10"],
    [4, "4.00", "3.00", "2.80"],
    [5, "5.00", "3.75", "3.50"],
    [6, "5.00", "3.75", "3.50"],
    [7, "5.00", "3.75", "3.50"],
    [8, "6.50", "4.88", "4.55"],
    [15, "6.50", "4.88", "4.55"],
    [16, "8.45", "6.34", "5.92"],
    [23, "8.45", "6.34", "5.92"],
    [24, "10.98", "8.24", "7.69"],
    [31, "10.98", "8.24", "7.69"],
  ];
  for (const [k, city, rural, rider] of table) {
    const c = fee(cd, "USD", k);
    assert.equal(c.fee.toDecimalString(), city, `${k} km city`);
    assert.equal(c.riderShare.toDecimalString(), rider, `${k} km rider`);
    assert.ok(c.riderShare.add(c.platformShare).equals(c.fee), "70/30 split loses nothing");
    assert.equal(fee(cd, "USD", k, true).fee.toDecimalString(), rural, `${k} km rural`);
  }
  assert.equal(fee(cd, "USD", 7).step, "CAPPED");
  assert.equal(fee(cd, "USD", 16).bands, 2);
});

test("distance is charged per started kilometre, minimum one", () => {
  assert.equal(deliveryFee(cd, "USD", { distanceMeters: 0, rural: false }).fee.toDecimalString(), "1.00");
  assert.equal(deliveryFee(cd, "USD", { distanceMeters: 2_300, rural: false }).chargedKm, 3);
  assert.equal(deliveryFee(cd, "USD", { distanceMeters: 7_001, rural: false }).fee.toDecimalString(), "6.50");
  rejects(() => deliveryFee(cd, "USD", { distanceMeters: 1.5, rural: false }), "DISTANCE_INVALID");
});

test("PRC-010: §18.5 surge on the fee only, after the ladder, capped, rider gets 70%", () => {
  const rows: [string, string, string][] = [["1.0", "3.00", "2.10"], ["1.3", "3.90", "2.73"], ["1.6", "4.80", "3.36"], ["2.0", "6.00", "4.20"]];
  for (const [m, f, r] of rows) {
    const d = fee(cd, "USD", 3, false, m);
    assert.equal(d.fee.toDecimalString(), f, `×${m}`);
    assert.equal(d.riderShare.toDecimalString(), r, `×${m} rider`);
  }
  // After the ladder, including band steps: 8.45 × 1.3 = 10.985 → 10.98
  assert.equal(fee(cd, "USD", 16, false, "1.3").fee.toDecimalString(), "10.98");
  rejects(() => fee(cd, "USD", 3, false, "2.1"), "SURGE_ABOVE_CAP");
  rejects(() => fee(cd, "USD", 3, false, "0.9"), "SURGE_BELOW_ONE");
  // Service charge and food never surge.
  const surged = priceOrder(cd, { goods: usd("20.00"), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(3), rural: false, surge: { multiplier: "1.6", trigger: "match", zoneId: "z1" } } });
  assert.equal(surged.serviceCharge.toDecimalString(), "2.00");
  assert.equal(surged.goods.toDecimalString(), "20.00");
  assert.equal(surged.delivery?.surgeTrigger, "match");
});

test("PRC-011: declared emergencies suppress surge", () => {
  const d = deliveryFee(cd, "USD", { distanceMeters: km(3), rural: false, surge: { multiplier: "2.0", trigger: "storm", zoneId: "z1" }, surgeSuppressed: true });
  assert.equal(d.fee.toDecimalString(), "3.00");
  assert.equal(d.surgeSuppressed, true);
});

test("§18.1: same 20.00 of food at 3 km — merchant 20.00, customer 25.00, zero commission", () => {
  const b = priceOrder(cd, { goods: usd("20.00"), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(3), rural: false } });
  assert.equal(b.merchantReceives.toDecimalString(), "20.00");
  assert.equal(b.total.toDecimalString(), "25.00");
  assert.ok(b.commission.isZero());
  assert.deepEqual(b.lines.map((l) => [l.code, l.amount.toDecimalString()]), [["GOODS", "20.00"], ["SERVICE_CHARGE", "2.00"], ["DELIVERY_FEE", "3.00"]]);
  assert.ok(b.merchantReceives.add(b.riderReceives).add(b.platformReceives).equals(b.total), "every cent accounted for");
});

test("§18.8 unit economics: rider and platform gross per row", () => {
  const rows: [string, number, string, string][] = [
    ["10.00", 3, "2.10", "1.90"],
    ["10.00", 7, "3.50", "2.50"],
    ["10.00", 10, "4.55", "2.95"],
    ["20.00", 3, "2.10", "2.90"],
    ["20.00", 7, "3.50", "3.50"],
    ["20.00", 10, "4.55", "3.95"],
    ["35.00", 5, "3.50", "5.00"],
    ["35.00", 16, "5.92", "6.03"],
  ];
  for (const [goods, k, rider, platform] of rows) {
    const b = priceOrder(cd, { goods: usd(goods), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(k), rural: false } });
    assert.equal(b.riderReceives.toDecimalString(), rider, `${goods}@${k}km rider`);
    assert.equal(b.platformReceives.toDecimalString(), platform, `${goods}@${k}km platform`);
    assert.ok(b.platformReceives.isNegative() === false && !b.platformReceives.isZero(), "positive contribution at every distance");
  }
});

test("PRC-001/002: every channel — 0% commission; service charge online, kiosk and platform-processed POS only", () => {
  const goods = usd("12.00");
  const online = priceOrder(cd, { goods, channel: "ONLINE", orderType: "TAKEAWAY" });
  const kiosk = priceOrder(cd, { goods, channel: "HUB", orderType: "DINE_IN" });
  const posCash = priceOrder(cd, { goods, channel: "POS", orderType: "TAKEAWAY", platformProcessesPayment: false });
  const posCard = priceOrder(cd, { goods, channel: "POS", orderType: "TAKEAWAY", platformProcessesPayment: true });
  for (const b of [online, kiosk, posCash, posCard]) {
    assert.ok(b.commission.isZero());
    assert.ok(b.merchantReceives.equals(goods), "merchant keeps 100% of the goods");
  }
  assert.equal(online.serviceCharge.toDecimalString(), "1.20");
  assert.equal(kiosk.serviceCharge.toDecimalString(), "1.20");
  assert.ok(posCash.serviceCharge.isZero(), "merchant's own cash trade is not charged");
  assert.equal(posCard.serviceCharge.toDecimalString(), "1.20");
});

test("PRC-002: partial refunds return the service charge proportionally", () => {
  const b = priceOrder(cd, { goods: usd("20.00"), channel: "ONLINE", orderType: "TAKEAWAY" });
  assert.equal(proportionalRefund(b, usd("5.00")).serviceCharge.toDecimalString(), "0.50");
  assert.equal(proportionalRefund(b, usd("20.00")).serviceCharge.toDecimalString(), "2.00");
  assert.equal(proportionalRefund(b, usd("3.33")).serviceCharge.toDecimalString(), "0.33");
  rejects(() => proportionalRefund(b, usd("20.01")), "REFUND_INVALID");
});

test("PRC-015: merchant-funded free delivery never reduces rider pay", () => {
  const b = priceOrder(cd, {
    goods: usd("20.00"),
    channel: "ONLINE",
    orderType: "DELIVERY",
    delivery: { distanceMeters: km(3), rural: false },
    merchantDeliveryContribution: usd("3.00"),
  });
  assert.ok(b.customerDeliveryFee.isZero());
  assert.equal(b.riderReceives.toDecimalString(), "2.10");
  assert.equal(b.merchantReceives.toDecimalString(), "17.00");
  assert.equal(b.total.toDecimalString(), "22.00");
  rejects(() => priceOrder(cd, { goods: usd("20.00"), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(3), rural: false }, merchantDeliveryContribution: usd("3.01") }), "PROMOTION_EXCEEDS_FEE");
});

test("tips go 100% to the rider and carry no service charge", () => {
  const b = priceOrder(cd, { goods: usd("10.00"), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(3), rural: false }, tip: usd("1.00") });
  assert.equal(b.riderReceives.toDecimalString(), "3.10");
  assert.equal(b.serviceCharge.toDecimalString(), "1.00");
  rejects(() => priceOrder(cd, { goods: usd("10.00"), channel: "ONLINE", orderType: "TAKEAWAY", tip: usd("1.00") }), "TIP_WITHOUT_RIDER");
  rejects(() => priceOrder(cd, { goods: usd("10.00"), channel: "ONLINE", orderType: "DELIVERY" }), "DELIVERY_REQUIRED");
});

test("zero-decimal markets: XOF ladder with market values", () => {
  assert.equal(fee(sn, "XOF", 3).fee.toDecimalString(), "1800");
  assert.equal(fee(sn, "XOF", 10).fee.toDecimalString(), "3900");
  assert.equal(fee(sn, "XOF", 10, true).fee.toDecimalString(), "2925");
  assert.equal(fee(sn, "XOF", 10).riderShare.toDecimalString(), "2730");
});

test("PRC-003: all-in markets show the service charge in the first price", () => {
  assert.equal(displayItemPrice(gb, Money.of("8.00", "GBP")).toDecimalString(), "8.80");
  assert.equal(displayItemPrice(cd, usd("8.00")).toDecimalString(), "8.00");
});

test("PRC-009: performance bonus is 10% of the rider's earnings, capped by the zone budget", () => {
  assert.equal(riderBonus(cd, usd("120.00"), true, usd("500.00")).bonus.toDecimalString(), "12.00");
  assert.ok(riderBonus(cd, usd("120.00"), false, usd("500.00")).bonus.isZero());
  const throttled = riderBonus(cd, usd("120.00"), true, usd("5.00"));
  assert.deepEqual([throttled.bonus.toDecimalString(), throttled.throttled], ["5.00", true]);
});

test("PRC-016: settlement journal separates every component and balances", () => {
  const b = priceOrder(cd, { goods: usd("20.00"), channel: "ONLINE", orderType: "DELIVERY", delivery: { distanceMeters: km(10), rural: false }, tip: usd("0.50") });
  const j = orderSettlementJournal(b, { id: "j1", idempotencyKey: "o1:settle", country: "CD", paymentMode: "PREPAID" });
  const by = Object.fromEntries(j.entries.map((e) => [e.account, e.amount.toDecimalString()]));
  assert.deepEqual(by, {
    psp_clearing: "29.00",
    restaurant_payable: "-20.00",
    service_charge_revenue: "-2.00",
    rider_payable: "-5.05",
    delivery_fee_revenue: "-1.95",
  });
  const cod = orderSettlementJournal(priceOrder(cd, { goods: usd("5.00"), channel: "ONLINE", orderType: "TAKEAWAY" }), { id: "j2", idempotencyKey: "o2", country: "CD", paymentMode: "CASH_ON_DELIVERY" });
  assert.deepEqual(cod.entries.map((e) => e.account), ["cod_cash_in_transit", "restaurant_payable", "service_charge_revenue"]);
});
