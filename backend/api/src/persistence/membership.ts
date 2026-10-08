/**
 * Membership plans and customer subscriptions (the "Plus" subscription) over PostgreSQL.
 * Tenant tables under country RLS; all reads/writes run inside a `db.tx({ country })`.
 */
import type { Sql } from "../db/db.ts";

export interface PlanRow {
  id: string;
  country_iso2: string;
  name: string;
  description: string;
  price_minor: string;
  currency: string;
  period: "MONTH" | "YEAR";
  free_delivery: boolean;
  min_subtotal_minor: string;
  service_charge_off_bps: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionRow {
  id: string;
  country_iso2: string;
  user_id: string;
  plan_id: string;
  status: "ACTIVE" | "CANCELLED" | "EXPIRED";
  started_at: Date;
  current_period_end: Date;
  auto_renew: boolean;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PlanInput {
  name: string;
  description: string;
  priceMinor: bigint;
  currency: string;
  period: "MONTH" | "YEAR";
  freeDelivery: boolean;
  minSubtotalMinor: bigint;
  serviceChargeOffBps: number;
  active: boolean;
}

const PLAN_COLUMNS =
  "id, country_iso2, name, description, price_minor::text, currency, period, free_delivery, min_subtotal_minor::text, service_charge_off_bps, active, created_at, updated_at";

export async function listPlans(sql: Sql, country: string, opts: { activeOnly?: boolean } = {}): Promise<PlanRow[]> {
  const where = opts.activeOnly ? "WHERE country_iso2 = $1 AND active = true" : "WHERE country_iso2 = $1";
  return sql.query<PlanRow & Record<string, unknown>>(`SELECT ${PLAN_COLUMNS} FROM membership.plan ${where} ORDER BY price_minor ASC, created_at ASC`, [country]);
}

export async function planById(sql: Sql, id: string): Promise<PlanRow | undefined> {
  const [row] = await sql.query<PlanRow & Record<string, unknown>>(`SELECT ${PLAN_COLUMNS} FROM membership.plan WHERE id = $1`, [id]);
  return row;
}

export async function insertPlan(sql: Sql, country: string, p: PlanInput): Promise<PlanRow> {
  const [row] = await sql.query<PlanRow & Record<string, unknown>>(
    `INSERT INTO membership.plan (country_iso2, name, description, price_minor, currency, period, free_delivery, min_subtotal_minor, service_charge_off_bps, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${PLAN_COLUMNS}`,
    [country, p.name, p.description, p.priceMinor.toString(), p.currency, p.period, p.freeDelivery, p.minSubtotalMinor.toString(), p.serviceChargeOffBps, p.active],
  );
  return row as PlanRow;
}

export async function updatePlan(sql: Sql, id: string, p: PlanInput): Promise<PlanRow> {
  const [row] = await sql.query<PlanRow & Record<string, unknown>>(
    `UPDATE membership.plan SET name = $2, description = $3, price_minor = $4, currency = $5, period = $6,
       free_delivery = $7, min_subtotal_minor = $8, service_charge_off_bps = $9, active = $10, updated_at = now()
     WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
    [id, p.name, p.description, p.priceMinor.toString(), p.currency, p.period, p.freeDelivery, p.minSubtotalMinor.toString(), p.serviceChargeOffBps, p.active],
  );
  return row as PlanRow;
}

const SUB_COLUMNS =
  "id, country_iso2, user_id, plan_id, status, started_at, current_period_end, auto_renew, cancelled_at, created_at, updated_at";

/** The customer's live subscription in this market (ACTIVE, or CANCELLED but still inside its paid period). */
export async function liveSubscription(sql: Sql, country: string, userId: string, now: Date): Promise<SubscriptionRow | undefined> {
  const [row] = await sql.query<SubscriptionRow & Record<string, unknown>>(
    `SELECT ${SUB_COLUMNS} FROM membership.subscription
      WHERE user_id = $1 AND country_iso2 = $2 AND status IN ('ACTIVE', 'CANCELLED') AND current_period_end > $3
      ORDER BY current_period_end DESC LIMIT 1`,
    [userId, country, now],
  );
  return row;
}

export async function insertSubscription(
  sql: Sql,
  country: string,
  input: { userId: string; planId: string; periodEnd: Date },
): Promise<SubscriptionRow> {
  const [row] = await sql.query<SubscriptionRow & Record<string, unknown>>(
    `INSERT INTO membership.subscription (country_iso2, user_id, plan_id, current_period_end)
     VALUES ($1, $2, $3, $4) RETURNING ${SUB_COLUMNS}`,
    [country, input.userId, input.planId, input.periodEnd],
  );
  return row as SubscriptionRow;
}

export async function setAutoRenew(sql: Sql, id: string, autoRenew: boolean, now: Date): Promise<SubscriptionRow | undefined> {
  const [row] = await sql.query<SubscriptionRow & Record<string, unknown>>(
    `UPDATE membership.subscription SET auto_renew = $2, cancelled_at = CASE WHEN $2 = false THEN $3::timestamptz ELSE NULL END, updated_at = now()
     WHERE id = $1 RETURNING ${SUB_COLUMNS}`,
    [id, autoRenew, now],
  );
  return row;
}

/** ACTIVE auto-renewing subscriptions whose period has ended, and ACTIVE/CANCELLED ones that lapsed without renewal. */
export async function subscriptionsToSettle(sql: Sql, now: Date, limit = 100): Promise<SubscriptionRow[]> {
  return sql.query<SubscriptionRow & Record<string, unknown>>(
    `SELECT ${SUB_COLUMNS} FROM membership.subscription
      WHERE status IN ('ACTIVE', 'CANCELLED') AND current_period_end <= $1
      ORDER BY current_period_end ASC LIMIT $2`,
    [now, limit],
  );
}

export async function renewSubscription(sql: Sql, id: string, periodEnd: Date): Promise<void> {
  await sql.query("UPDATE membership.subscription SET current_period_end = $2, updated_at = now() WHERE id = $1", [id, periodEnd]);
}

export async function expireSubscription(sql: Sql, id: string): Promise<void> {
  await sql.query("UPDATE membership.subscription SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [id]);
}
