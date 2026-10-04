/**
 * Pricing, fees and revenue (PRD §18).
 *
 *   1. Merchants pay 0% commission on every channel.
 *   2. Customers pay a compulsory service charge (default 10%) on the merchant subtotal.
 *   3. Riders keep 70% of the delivery fee actually charged; the platform keeps 30%.
 *   4–5. City fee per km up to a cap held to 7 km, then +30% per further 8 km band.
 *   6. Rural zones pay 75% of the city fee at every step.
 *
 * All rates come from the Country Profile. Arithmetic is exact (rational
 * bigint) and each amount is rounded once, half-to-even (MR-8) — which is what
 * reproduces the PRD's own tables (e.g. 5.00 × 1.3³ = 10.985 → 10.98).
 */
import { Money, divideRounded, parseDecimal, type Ratio } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import { createJournal, type Journal, type LedgerEntry } from "../money/journal.ts";
import { RIDER_ORDER_TYPES, type OrderChannel, type OrderType } from "../ordering/order-types.ts";

export type PricingConfig = CountryProfile["pricing"];

export class PricingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PricingError(code, message);
}

const BPS = 10_000n;
const ROUNDING = "half-even" as const;

export interface SurgeInput {
  /** Zone-level multiplier, e.g. "1.3" for rain. Never per customer (§18.5). */
  readonly multiplier: string;
  readonly trigger: string;
  readonly zoneId: string;
}

export interface DeliveryFeeInput {
  /** Routed travel distance for the rider's vehicle (§18.3), in metres. */
  readonly distanceMeters: number;
  readonly rural: boolean;
  readonly surge?: SurgeInput;
  /** Declared emergency or market rule restricting increases (§18.5, PRC-011). */
  readonly surgeSuppressed?: boolean;
}

export interface DeliveryFee {
  /** Distance charged: every started kilometre, minimum 1. */
  readonly chargedKm: number;
  /** Number of +step bands applied beyond the cap-hold distance. */
  readonly bands: number;
  readonly step: "PER_KM" | "CAPPED" | "BANDED";
  readonly rural: boolean;
  readonly surgeMultiplier: string;
  readonly surgeTrigger?: string;
  readonly surgeSuppressed: boolean;
  /** Fee charged for the delivery (before any merchant-funded promotion). */
  readonly fee: Money;
  /** §18.4: rider share of the fee actually charged. */
  readonly riderShare: Money;
  readonly platformShare: Money;
}

/** §18.3 ladder, §18.5 surge (applied after the ladder), §18.4 rider split. */
export function deliveryFee(pricing: PricingConfig, currency: string, input: DeliveryFeeInput): DeliveryFee {
  if (!Number.isInteger(input.distanceMeters) || input.distanceMeters < 0) fail("DISTANCE_INVALID", "Distance must be whole metres");
  const cfg = pricing.delivery_fee;
  const perKm = Money.of(cfg.per_km, currency).minor;
  const cap = Money.of(cfg.cap, currency).minor;
  const chargedKm = Math.max(1, Math.ceil(input.distanceMeters / 1000));

  // Exact fee in minor units as a fraction n/d, rounded once at the end.
  let n: bigint;
  let d = 1n;
  let bands = 0;
  let step: DeliveryFee["step"];
  if (chargedKm <= cfg.cap_hold_km) {
    const linear = perKm * BigInt(chargedKm);
    n = linear < cap ? linear : cap;
    step = linear < cap ? "PER_KM" : "CAPPED";
  } else {
    bands = Math.ceil((chargedKm - cfg.cap_hold_km) / cfg.band_km);
    n = cap * (BPS + BigInt(cfg.band_step_bps)) ** BigInt(bands);
    d = BPS ** BigInt(bands);
    step = "BANDED";
  }
  if (input.rural) {
    n *= BigInt(pricing.delivery_fee.rural_bps);
    d *= BPS;
  }

  let surgeMultiplier = "1";
  const suppressed = !!input.surge && !!input.surgeSuppressed;
  if (input.surge && !input.surgeSuppressed) {
    const m = parseDecimal(input.surge.multiplier);
    const max = parseDecimal(pricing.surge_max_multiplier);
    if (m.numerator < m.denominator) fail("SURGE_BELOW_ONE", "Surge multipliers are at least 1.0");
    if (m.numerator * max.denominator > max.numerator * m.denominator) {
      fail("SURGE_ABOVE_CAP", `Surge ${input.surge.multiplier} exceeds the market cap ${pricing.surge_max_multiplier}`);
    }
    n *= m.numerator;
    d *= m.denominator;
    surgeMultiplier = input.surge.multiplier;
  }

  const fee = Money.ofMinor(divideRounded(n, d, ROUNDING), currency);
  const riderShare = share(fee, pricing.rider_share_bps);
  return {
    chargedKm,
    bands,
    step,
    rural: input.rural,
    surgeMultiplier,
    ...(input.surge && !suppressed ? { surgeTrigger: input.surge.trigger } : {}),
    surgeSuppressed: suppressed,
    fee,
    riderShare,
    platformShare: fee.subtract(riderShare),
  };
}

export interface PriceOrderInput {
  /** Merchant subtotal (the goods) in the settlement currency (MR-5). */
  readonly goods: Money;
  readonly channel: OrderChannel;
  readonly orderType: OrderType;
  /** POS only: the platform charges the service charge where it processes the payment (§18.1). */
  readonly platformProcessesPayment?: boolean;
  readonly delivery?: DeliveryFeeInput;
  /** Merchant-funded free or reduced delivery (§18.3, PRC-015). */
  readonly merchantDeliveryContribution?: Money;
  /** 100% to the rider, outside every charge and bonus (§18.4). */
  readonly tip?: Money;
}

export interface PriceBreakdown {
  readonly currency: string;
  readonly goods: Money;
  /** Always zero: no code path deducts commission from a merchant sale (PRC-001). */
  readonly commission: Money;
  readonly serviceCharge: Money;
  readonly serviceChargeBps: number;
  readonly delivery?: DeliveryFee;
  readonly merchantDeliveryContribution: Money;
  /** Delivery fee the customer pays after any merchant-funded promotion. */
  readonly customerDeliveryFee: Money;
  readonly tip: Money;
  /** What the customer pays. */
  readonly total: Money;
  readonly merchantReceives: Money;
  readonly riderReceives: Money;
  readonly platformReceives: Money;
  /** Named lines for the price breakdown shown before payment (§18.2 disclosure). */
  readonly lines: readonly { readonly code: "GOODS" | "SERVICE_CHARGE" | "DELIVERY_FEE" | "DELIVERY_PROMOTION" | "TIP"; readonly amount: Money }[];
}

export function priceOrder(pricing: PricingConfig, input: PriceOrderInput): PriceBreakdown {
  const ccy = input.goods.currency;
  const zero = Money.zero(ccy);
  if (input.goods.isNegative()) fail("GOODS_NEGATIVE", "Goods subtotal cannot be negative");
  const tip = input.tip ?? zero;
  if (tip.currency !== ccy || tip.isNegative()) fail("TIP_INVALID", "Tips are non-negative, in the order's settlement currency");

  const needsDelivery = RIDER_ORDER_TYPES.includes(input.orderType);
  if (needsDelivery && !input.delivery) fail("DELIVERY_REQUIRED", `${input.orderType} orders need a delivery distance`);
  if (!needsDelivery && input.delivery) fail("NO_DELIVERY_FOR_TYPE", `${input.orderType} orders have no delivery fee`);
  if (!needsDelivery && !tip.isZero()) fail("TIP_WITHOUT_RIDER", "Tips go to riders; this order has none");

  // §18.1: service charge on every channel, except a POS sale the platform does not process (merchant's own cash).
  const charged = input.channel !== "POS" || input.platformProcessesPayment === true;
  const serviceChargeBps = charged ? pricing.service_charge_bps : 0;
  const serviceCharge = share(input.goods, serviceChargeBps);

  const delivery = input.delivery ? deliveryFee(pricing, ccy, input.delivery) : undefined;
  const fee = delivery?.fee ?? zero;
  const contribution = input.merchantDeliveryContribution ?? zero;
  if (contribution.currency !== ccy || contribution.isNegative()) fail("PROMOTION_INVALID", "Promotion must be non-negative, in the settlement currency");
  if (contribution.compare(fee) > 0) fail("PROMOTION_EXCEEDS_FEE", "A merchant cannot fund more than the delivery fee");
  if (contribution.compare(input.goods) > 0) fail("PROMOTION_EXCEEDS_GOODS", "Promotion cannot exceed the merchant's own sale");

  const customerDeliveryFee = fee.subtract(contribution);
  const total = input.goods.add(serviceCharge).add(customerDeliveryFee).add(tip);
  // The rider is paid on the full fee even when the merchant funds part of it (PRC-015).
  const riderReceives = (delivery?.riderShare ?? zero).add(tip);
  const platformReceives = serviceCharge.add(delivery?.platformShare ?? zero);
  const merchantReceives = input.goods.subtract(contribution);

  const lines: PriceBreakdown["lines"][number][] = [{ code: "GOODS", amount: input.goods }];
  if (!serviceCharge.isZero()) lines.push({ code: "SERVICE_CHARGE", amount: serviceCharge });
  if (delivery) lines.push({ code: "DELIVERY_FEE", amount: fee });
  if (!contribution.isZero()) lines.push({ code: "DELIVERY_PROMOTION", amount: contribution.negate() });
  if (!tip.isZero()) lines.push({ code: "TIP", amount: tip });

  return {
    currency: ccy,
    goods: input.goods,
    commission: zero,
    serviceCharge,
    serviceChargeBps,
    ...(delivery ? { delivery } : {}),
    merchantDeliveryContribution: contribution,
    customerDeliveryFee,
    tip,
    total,
    merchantReceives,
    riderReceives,
    platformReceives,
    lines,
  };
}

/** §18.2: the service charge is refunded in proportion to the goods refunded (PRC-002). */
export function proportionalRefund(breakdown: PriceBreakdown, refundedGoods: Money): { goods: Money; serviceCharge: Money } {
  if (refundedGoods.isNegative() || refundedGoods.compare(breakdown.goods) > 0) fail("REFUND_INVALID", "Refund must be between zero and the goods subtotal");
  if (breakdown.goods.isZero()) return { goods: refundedGoods, serviceCharge: Money.zero(breakdown.currency) };
  const serviceCharge = refundedGoods.equals(breakdown.goods)
    ? breakdown.serviceCharge
    : breakdown.serviceCharge.multiply({ numerator: refundedGoods.minor, denominator: breakdown.goods.minor }, ROUNDING);
  return { goods: refundedGoods, serviceCharge };
}

/**
 * §18.2 all-in markets: compulsory fees are included in the first price shown,
 * never added late. Otherwise the item price shows as listed and the charge is
 * a named line before payment.
 */
export function displayItemPrice(pricing: PricingConfig, price: Money): Money {
  return pricing.all_in_pricing ? price.add(share(price, pricing.service_charge_bps)) : price;
}

/** §18.4 performance bonus: share of the rider's own delivery earnings, from the platform's share, within the zone budget. */
export function riderBonus(pricing: PricingConfig, deliveryEarnings: Money, qualifies: boolean, remainingZoneBudget: Money): { bonus: Money; throttled: boolean } {
  if (!qualifies) return { bonus: Money.zero(deliveryEarnings.currency), throttled: false };
  const full = share(deliveryEarnings, pricing.rider_bonus_bps);
  if (full.compare(remainingZoneBudget) <= 0) return { bonus: full, throttled: false };
  const budget = remainingZoneBudget.isNegative() ? Money.zero(deliveryEarnings.currency) : remainingZoneBudget;
  return { bonus: budget, throttled: true };
}

/**
 * PRC-016: one balanced journal per completed order, with every component on
 * its own account. Prepaid orders clear through the PSP; cash orders through
 * the rider's cash in transit.
 */
export function orderSettlementJournal(
  breakdown: PriceBreakdown,
  context: { id: string; idempotencyKey: string; country: string; paymentMode: "PREPAID" | "CASH_ON_DELIVERY"; postedAt?: Date },
): Journal {
  const c = context.country;
  const entries: LedgerEntry[] = [
    { account: context.paymentMode === "PREPAID" ? "psp_clearing" : "cod_cash_in_transit", country: c, amount: breakdown.total },
    { account: "restaurant_payable", country: c, amount: breakdown.merchantReceives.negate() },
    { account: "service_charge_revenue", country: c, amount: breakdown.serviceCharge.negate() },
    { account: "rider_payable", country: c, amount: breakdown.riderReceives.negate() },
    { account: "delivery_fee_revenue", country: c, amount: (breakdown.delivery?.platformShare ?? Money.zero(breakdown.currency)).negate() },
  ].filter((e) => !e.amount.isZero()) as LedgerEntry[];
  return createJournal({
    id: context.id,
    idempotencyKey: context.idempotencyKey,
    description: "Order settlement",
    entries,
    ...(context.postedAt ? { postedAt: context.postedAt } : {}),
  });
}

function share(amount: Money, bps: number): Money {
  const ratio: Ratio = { numerator: BigInt(bps), denominator: BPS };
  return amount.multiply(ratio, ROUNDING);
}
