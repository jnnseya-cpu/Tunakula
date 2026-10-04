/** Payment intents, attempts and connector events (§21). */
import type { PaymentAttempt } from "../modules/payments/payment-router.ts";
import type { Sql } from "../db/db.ts";

export interface IntentRow {
  id: string;
  order_id: string;
  country_iso2: string;
  brand_id: string;
  payer_user_id: string;
  payer_country: string;
  method_type: string;
  amount_minor: string;
  currency: string;
  idempotency_key: string;
  status: string;
  connector_id: string | null;
  provider_ref: string | null;
  reason_code: string | null;
}

const COLS = "id, order_id, country_iso2, brand_id, payer_user_id, payer_country, method_type, amount_minor, currency, idempotency_key, status, connector_id, provider_ref, reason_code";

export async function intentByKey(sql: Sql, key: string): Promise<IntentRow | undefined> {
  return (await sql.query<IntentRow & Record<string, unknown>>(`SELECT ${COLS} FROM payments.payment_intent WHERE idempotency_key = $1`, [key]))[0];
}

export async function intentById(sql: Sql, id: string): Promise<IntentRow | undefined> {
  return (await sql.query<IntentRow & Record<string, unknown>>(`SELECT ${COLS} FROM payments.payment_intent WHERE id = $1`, [id]))[0];
}

export async function intentByProviderRef(sql: Sql, connectorId: string, providerRef: string): Promise<IntentRow | undefined> {
  return (await sql.query<IntentRow & Record<string, unknown>>(`SELECT ${COLS} FROM payments.payment_intent WHERE connector_id = $1 AND provider_ref = $2`, [connectorId, providerRef]))[0];
}

export async function createIntent(sql: Sql, i: Omit<IntentRow, "id" | "status" | "connector_id" | "provider_ref" | "reason_code">): Promise<IntentRow> {
  const [row] = await sql.query<IntentRow & Record<string, unknown>>(
    `INSERT INTO payments.payment_intent (order_id, country_iso2, brand_id, payer_user_id, payer_country, method_type, amount_minor, currency, idempotency_key, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED') RETURNING ${COLS}`,
    [i.order_id, i.country_iso2, i.brand_id, i.payer_user_id, i.payer_country, i.method_type, i.amount_minor, i.currency, i.idempotency_key],
  );
  return row as IntentRow;
}

export async function updateIntent(sql: Sql, id: string, u: { status: string; connectorId?: string | null; providerRef?: string | null; reasonCode?: string | null }): Promise<void> {
  await sql.query(
    "UPDATE payments.payment_intent SET status = $2, connector_id = COALESCE($3, connector_id), provider_ref = COALESCE($4, provider_ref), reason_code = $5, updated_at = now() WHERE id = $1",
    [id, u.status, u.connectorId ?? null, u.providerRef ?? null, u.reasonCode ?? null],
  );
}

export async function recordAttempts(sql: Sql, intent: IntentRow, attempts: readonly PaymentAttempt[]): Promise<void> {
  for (const a of attempts) {
    await sql.query(
      "INSERT INTO payments.payment_attempt (intent_id, country_iso2, connector_id, idempotency_key, state, provider_ref, reason_code, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [intent.id, intent.country_iso2, a.connectorId, a.idempotencyKey, a.state, a.providerRef ?? null, a.reasonCode ?? null, a.at],
    );
  }
}

/** Stores a webhook once; returns false if this event id was already processed (at-least-once delivery). */
export async function recordConnectorEvent(sql: Sql, e: { connectorId: string; eventId: string; providerRef: string; state: string; raw: string; signatureOk: boolean }): Promise<boolean> {
  const rows = await sql.query(
    `INSERT INTO payments.connector_event (connector_id, event_id, provider_ref, state, raw, signature_ok) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (connector_id, event_id) DO NOTHING RETURNING event_id`,
    [e.connectorId, e.eventId, e.providerRef, e.state, e.raw, e.signatureOk],
  );
  return rows.length === 1;
}
