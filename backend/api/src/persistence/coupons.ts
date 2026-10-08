/** Coupons and their redemptions over PostgreSQL. Tenant tables under country RLS. */
import type { Sql } from "../db/db.ts";

export interface CouponRow {
  id: string;
  country_iso2: string;
  code: string;
  description: string;
  kind: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value_bps: number;
  value_minor: string;
  currency: string;
  min_subtotal_minor: string;
  max_discount_minor: string;
  usage_limit: number;
  per_customer_limit: number;
  starts_at: Date;
  ends_at: Date;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CouponInput {
  code: string;
  description: string;
  kind: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  valueBps: number;
  valueMinor: bigint;
  currency: string;
  minSubtotalMinor: bigint;
  maxDiscountMinor: bigint;
  usageLimit: number;
  perCustomerLimit: number;
  endsAt: Date;
  active: boolean;
}

const COLS =
  "id, country_iso2, code, description, kind, value_bps, value_minor::text, currency, min_subtotal_minor::text, max_discount_minor::text, usage_limit, per_customer_limit, starts_at, ends_at, active, created_at, updated_at";

export async function listCoupons(sql: Sql, country: string): Promise<CouponRow[]> {
  return sql.query<CouponRow & Record<string, unknown>>(`SELECT ${COLS} FROM promotions.coupon WHERE country_iso2 = $1 ORDER BY created_at DESC LIMIT 200`, [country]);
}
export async function couponById(sql: Sql, id: string): Promise<CouponRow | undefined> {
  const [row] = await sql.query<CouponRow & Record<string, unknown>>(`SELECT ${COLS} FROM promotions.coupon WHERE id = $1`, [id]);
  return row;
}
export async function couponByCode(sql: Sql, country: string, code: string): Promise<CouponRow | undefined> {
  const [row] = await sql.query<CouponRow & Record<string, unknown>>(`SELECT ${COLS} FROM promotions.coupon WHERE country_iso2 = $1 AND upper(code) = upper($2) AND active = true`, [country, code]);
  return row;
}
export async function insertCoupon(sql: Sql, country: string, c: CouponInput): Promise<CouponRow> {
  const [row] = await sql.query<CouponRow & Record<string, unknown>>(
    `INSERT INTO promotions.coupon (country_iso2, code, description, kind, value_bps, value_minor, currency, min_subtotal_minor, max_discount_minor, usage_limit, per_customer_limit, ends_at, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLS}`,
    [country, c.code, c.description, c.kind, c.valueBps, c.valueMinor.toString(), c.currency, c.minSubtotalMinor.toString(), c.maxDiscountMinor.toString(), c.usageLimit, c.perCustomerLimit, c.endsAt, c.active],
  );
  return row as CouponRow;
}
export async function updateCoupon(sql: Sql, id: string, c: CouponInput): Promise<CouponRow> {
  const [row] = await sql.query<CouponRow & Record<string, unknown>>(
    `UPDATE promotions.coupon SET code=$2, description=$3, kind=$4, value_bps=$5, value_minor=$6, currency=$7, min_subtotal_minor=$8,
       max_discount_minor=$9, usage_limit=$10, per_customer_limit=$11, ends_at=$12, active=$13, updated_at=now()
     WHERE id=$1 RETURNING ${COLS}`,
    [id, c.code, c.description, c.kind, c.valueBps, c.valueMinor.toString(), c.currency, c.minSubtotalMinor.toString(), c.maxDiscountMinor.toString(), c.usageLimit, c.perCustomerLimit, c.endsAt, c.active],
  );
  return row as CouponRow;
}

export async function redemptionCounts(sql: Sql, couponId: string, userId: string): Promise<{ total: number; byUser: number }> {
  const [r] = await sql.query<{ total: string; by_user: string }>(
    "SELECT count(*)::text AS total, count(*) FILTER (WHERE user_id = $2)::text AS by_user FROM promotions.coupon_redemption WHERE coupon_id = $1",
    [couponId, userId],
  );
  return { total: Number(r?.total ?? 0), byUser: Number(r?.by_user ?? 0) };
}
export async function insertRedemption(sql: Sql, country: string, r: { couponId: string; userId: string; orderId: string; amountMinor: bigint; currency: string }): Promise<void> {
  await sql.query(
    `INSERT INTO promotions.coupon_redemption (country_iso2, coupon_id, user_id, order_id, amount_minor, currency)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id) DO NOTHING`,
    [country, r.couponId, r.userId, r.orderId, r.amountMinor.toString(), r.currency],
  );
}
