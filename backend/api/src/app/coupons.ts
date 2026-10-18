/**
 * Coupons / promo codes. An admin defines codes; a customer applies one at checkout; the platform
 * funds the discount at settlement (promotion_expense) so the merchant and rider are paid in full.
 * Commerce calls `priceFor` to value a code against an order and `record` to log the redemption.
 */
import { Money, ratio } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import {
  couponByCode,
  couponById,
  insertCoupon,
  insertRedemption,
  listCoupons,
  listCouponsForBranch,
  redemptionCounts,
  updateCoupon,
  type CouponInput,
  type CouponRow,
} from "../persistence/coupons.ts";
import { getBranch } from "../persistence/catalogue.ts";
import { badRequest, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

export interface CouponPrice {
  readonly couponId: string;
  readonly code: string;
  readonly discount: Money;
  /** Who funds this discount: the platform (promotion_expense) or the merchant (reduced payout). */
  readonly fundedBy: "PLATFORM" | "MERCHANT";
}

/** What commerce needs: price a code against an order, and record the redemption once the order exists. */
export interface CouponLookup {
  priceFor(sql: Sql, country: string, userId: string, code: string, fees: { goods: Money; customerDeliveryFee: Money }, branchId: string): Promise<CouponPrice | undefined>;
  record(sql: Sql, country: string, couponId: string, userId: string, orderId: string, amount: Money): Promise<void>;
}

export class CouponService implements CouponLookup {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  async list(country: string, principal: Principal) {
    const profile = this.profile(country);
    require(principal, "campaign:write", { type: "coupon", country }, { activeCountry: country, profile });
    const rows = await this.db.tx({ country }, (sql) => listCoupons(sql, country));
    return { coupons: rows.map(view) };
  }

  async save(country: string, principal: Principal, couponId: string | undefined, body: Record<string, unknown>) {
    const profile = this.profile(country);
    require(principal, "campaign:write", { type: "coupon", country }, { activeCountry: country, profile });
    const input = parse(body, profile.money.settlement_currency, this.now());
    return this.db.tx({ country }, async (sql) => {
      // A merchant scope must be a real storefront in this market (RLS already confines the lookup).
      if (input.branchId) {
        const branch = await getBranch(sql, input.branchId);
        if (!branch) throw notFound("Merchant");
      }
      let row: CouponRow;
      if (couponId) {
        const existing = await couponById(sql, couponId);
        if (!existing || existing.country_iso2 !== country) throw notFound("Coupon");
        row = await updateCoupon(sql, couponId, input);
      } else {
        row = await insertCoupon(sql, country, input);
      }
      await audit(sql, { actor: principal.userId, action: couponId ? "coupon.updated" : "coupon.created", target: `coupon:${row.id}`, country, detail: { code: row.code, kind: row.kind } });
      return view(row);
    });
  }

  /** A merchant's own promo codes for one of their storefronts. */
  async listForMerchant(country: string, principal: Principal, branchId: string) {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Merchant");
      require(principal, "branch:manage", { type: "branch", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      const rows = await listCouponsForBranch(sql, country, branchId);
      return { coupons: rows.map(view) };
    });
  }

  /**
   * A merchant creates or edits a promo code for their own storefront, without needing an admin.
   * The code is always scoped to that merchant and funded by that merchant (never the platform),
   * and cannot be free delivery (the platform and rider share that fee).
   */
  async saveForMerchant(country: string, principal: Principal, branchId: string, couponId: string | undefined, body: Record<string, unknown>) {
    const profile = this.profile(country);
    const input = { ...parse({ ...body, branch_id: branchId, funded_by: "MERCHANT" }, profile.money.settlement_currency, this.now()), branchId, fundedBy: "MERCHANT" as const };
    return this.db.tx({ country }, async (sql) => {
      const branch = await getBranch(sql, branchId);
      if (!branch) throw notFound("Merchant");
      require(principal, "branch:manage", { type: "branch", country, branchId, restaurantGroupId: branch.restaurant_group_id }, { activeCountry: country, profile });
      let row: CouponRow;
      if (couponId) {
        const existing = await couponById(sql, couponId);
        if (!existing || existing.country_iso2 !== country || existing.branch_id !== branchId) throw notFound("Coupon");
        row = await updateCoupon(sql, couponId, input);
      } else {
        row = await insertCoupon(sql, country, input);
      }
      await audit(sql, { actor: principal.userId, action: couponId ? "coupon.updated" : "coupon.created", target: `coupon:${row.id}`, country, detail: { code: row.code, kind: row.kind, branchId } });
      return view(row);
    });
  }

  /** Values a code for a customer against an order's fees, enforcing window, minimum and limits. */
  async priceFor(sql: Sql, country: string, userId: string, code: string, fees: { goods: Money; customerDeliveryFee: Money }, branchId: string): Promise<CouponPrice | undefined> {
    const coupon = await couponByCode(sql, country, code.trim());
    if (!coupon) throw unprocessable("COUPON_INVALID", "That promo code is not valid");
    // A merchant-scoped coupon only applies on that merchant's orders.
    if (coupon.branch_id && coupon.branch_id !== branchId) throw unprocessable("COUPON_WRONG_MERCHANT", "That code does not apply at this restaurant");
    const now = this.now();
    if (new Date(coupon.starts_at) > now || new Date(coupon.ends_at) < now) throw unprocessable("COUPON_EXPIRED", "That promo code is not active right now");
    const ccy = fees.goods.currency;
    if (coupon.currency !== ccy) throw unprocessable("COUPON_WRONG_CURRENCY", "That code does not apply in this market");
    if (fees.goods.compare(Money.ofMinor(BigInt(coupon.min_subtotal_minor), ccy)) < 0) {
      throw unprocessable("COUPON_BELOW_MINIMUM", `Spend at least ${Money.ofMinor(BigInt(coupon.min_subtotal_minor), ccy).toString()} to use this code`);
    }
    const counts = await redemptionCounts(sql, coupon.id, userId);
    if (coupon.usage_limit > 0 && counts.total >= coupon.usage_limit) throw unprocessable("COUPON_USED_UP", "This promo code has reached its limit");
    if (counts.byUser >= coupon.per_customer_limit) throw unprocessable("COUPON_ALREADY_USED", "You have already used this promo code");
    const discount = this.#discount(coupon, fees);
    if (discount.isZero()) return undefined;
    return { couponId: coupon.id, code: coupon.code, discount, fundedBy: coupon.funded_by };
  }

  #discount(coupon: CouponRow, fees: { goods: Money; customerDeliveryFee: Money }): Money {
    const ccy = fees.goods.currency;
    let d: Money;
    if (coupon.kind === "FREE_DELIVERY") d = fees.customerDeliveryFee;
    else if (coupon.kind === "FIXED") d = Money.ofMinor(BigInt(coupon.value_minor), ccy);
    else d = fees.goods.multiply(ratio(BigInt(coupon.value_bps), 10_000n));
    const cap = BigInt(coupon.max_discount_minor);
    if (cap > 0n && d.minor > cap) d = Money.ofMinor(cap, ccy);
    // Never discount more than the goods plus delivery the customer is paying.
    const ceiling = fees.goods.add(fees.customerDeliveryFee);
    if (d.compare(ceiling) > 0) d = ceiling;
    return d;
  }

  async record(sql: Sql, country: string, couponId: string, userId: string, orderId: string, amount: Money): Promise<void> {
    await insertRedemption(sql, country, { couponId, userId, orderId, amountMinor: amount.minor, currency: amount.currency });
  }
}

function money(minor: string, currency: string) {
  return { amount_minor: minor, currency };
}
function view(c: CouponRow) {
  return {
    id: c.id, code: c.code, description: c.description, kind: c.kind,
    value_bps: c.value_bps, value: money(c.value_minor, c.currency),
    min_subtotal: money(c.min_subtotal_minor, c.currency), max_discount: money(c.max_discount_minor, c.currency),
    usage_limit: c.usage_limit, per_customer_limit: c.per_customer_limit,
    branch_id: c.branch_id, funded_by: c.funded_by,
    starts_at: new Date(c.starts_at).toISOString(), ends_at: new Date(c.ends_at).toISOString(),
    active: c.active,
  };
}

function parse(body: Record<string, unknown>, settlement: string, now: Date): CouponInput {
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,24}$/.test(code)) throw badRequest("CODE_INVALID", "A code is 3–24 letters or digits");
  const kind = body.kind === "FIXED" ? "FIXED" : body.kind === "FREE_DELIVERY" ? "FREE_DELIVERY" : "PERCENT";
  const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : settlement;
  const valueBps = kind === "PERCENT" ? Math.trunc(Number(body.value_bps ?? 0)) : 0;
  if (kind === "PERCENT" && (!Number.isInteger(valueBps) || valueBps <= 0 || valueBps > 10_000)) throw badRequest("VALUE_INVALID", "value_bps is 1–10000 for a percentage coupon");
  const valueMinor = kind === "FIXED" ? big(body.value_minor, "value_minor") : 0n;
  if (kind === "FIXED" && valueMinor <= 0n) throw badRequest("VALUE_INVALID", "value_minor must be positive for a fixed coupon");
  const days = Math.min(Math.max(Math.trunc(Number(body.days) || 30), 1), 365);
  const branchId = typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null;
  const fundedBy = body.funded_by === "MERCHANT" ? "MERCHANT" : "PLATFORM";
  if (fundedBy === "MERCHANT" && !branchId) throw badRequest("MERCHANT_REQUIRED", "A merchant-funded coupon must name the merchant that funds it");
  if (fundedBy === "MERCHANT" && kind === "FREE_DELIVERY") throw badRequest("FUNDING_INVALID", "A merchant cannot fund free delivery; the platform and rider share that fee");
  return {
    code,
    description: String(body.description ?? "").slice(0, 280),
    kind,
    valueBps,
    valueMinor,
    currency,
    minSubtotalMinor: big(body.min_subtotal_minor ?? "0", "min_subtotal_minor"),
    maxDiscountMinor: big(body.max_discount_minor ?? "0", "max_discount_minor"),
    usageLimit: Math.max(0, Math.trunc(Number(body.usage_limit ?? 0))),
    perCustomerLimit: Math.max(1, Math.trunc(Number(body.per_customer_limit ?? 1))),
    branchId,
    fundedBy,
    endsAt: body.ends_at ? new Date(String(body.ends_at)) : new Date(now.getTime() + days * 86_400_000),
    active: body.active === undefined ? true : Boolean(body.active),
  };
}
function big(v: unknown, field: string): bigint {
  try { const n = BigInt(String(v)); if (n < 0n) throw new Error(); return n; } catch { throw badRequest("AMOUNT_INVALID", `${field} must be a whole number of minor units`); }
}
