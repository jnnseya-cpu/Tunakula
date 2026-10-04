/**
 * PostgreSQL order event store (§21 order_event). Same contract as the
 * in-memory store: replay → decide → append, optimistic concurrency on
 * (order_id, seq), and command idempotency (INT-002).
 */
import type { Sql } from "../db/db.ts";
import { decide, replay, type CommandEnvelope, type OrderAggregate } from "../modules/ordering/order-aggregate.ts";
import type { OrderEvent } from "../modules/ordering/order-types.ts";

interface EventRow extends Record<string, unknown> {
  order_id: string;
  seq: number;
  command_id: string;
  type: string;
  actor: OrderEvent["actor"];
  payload: Record<string, unknown>;
  at: Date;
}

export class OrderConflictError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} changed concurrently; retry the command`);
    this.name = "OrderConflictError";
  }
}

export async function loadOrderEvents(sql: Sql, orderId: string): Promise<OrderEvent[]> {
  const rows = await sql.query<EventRow>("SELECT order_id, seq, command_id, type, actor, payload, at FROM ordering.order_event WHERE order_id = $1 ORDER BY seq", [orderId]);
  return rows.map(toEvent);
}

export async function handleOrderCommand(
  sql: Sql,
  env: CommandEnvelope,
  tenant: { country: string; brandId: string },
): Promise<{ events: OrderEvent[]; order: OrderAggregate }> {
  // Serialise commands per order inside this transaction.
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [env.orderId]);
  const events = await loadOrderEvents(sql, env.orderId);
  const previous = await sql.query<{ first_seq: number | null; last_seq: number | null }>(
    "SELECT first_seq, last_seq FROM ordering.order_command WHERE order_id = $1 AND command_id = $2",
    [env.orderId, env.commandId],
  );
  if (previous[0]) {
    const { first_seq, last_seq } = previous[0];
    const replayed = first_seq === null ? [] : events.filter((e) => e.seq >= (first_seq as number) && e.seq <= (last_seq as number));
    return { events: replayed, order: replay(events) as OrderAggregate };
  }

  const current = replay(events);
  const next = decide(current, env);
  for (const e of next) {
    try {
      await sql.query(
        "INSERT INTO ordering.order_event (order_id, seq, country_iso2, brand_id, command_id, type, actor, payload, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [e.orderId, e.seq, tenant.country, tenant.brandId, e.commandId, e.type, JSON.stringify(e.actor), JSON.stringify(payloadOf(e)), e.at],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new OrderConflictError(env.orderId);
      throw error;
    }
  }
  await sql.query(
    "INSERT INTO ordering.order_command (order_id, command_id, country_iso2, first_seq, last_seq) VALUES ($1, $2, $3, $4, $5)",
    [env.orderId, env.commandId, tenant.country, next[0]?.seq ?? null, next.at(-1)?.seq ?? null],
  );
  const order = replay([...events, ...next]) as OrderAggregate;
  await upsertView(sql, order, tenant, env.at);
  return { events: next, order };
}

async function upsertView(sql: Sql, o: OrderAggregate, tenant: { country: string; brandId: string }, at: Date): Promise<void> {
  const s = o.snapshot;
  await sql.query(
    `INSERT INTO ordering.order_view (order_id, country_iso2, brand_id, branch_id, customer_id, rider_id, type, channel, payment_mode, state, total_minor, currency, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     ON CONFLICT (order_id) DO UPDATE SET rider_id = EXCLUDED.rider_id, state = EXCLUDED.state, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
    [s.orderId, tenant.country, tenant.brandId, s.branchId, s.customerId, o.riderId ?? null, s.type, s.channel, s.paymentMode, o.state, s.total.minor, s.total.currency, o.version, at],
  );
}

function payloadOf(e: OrderEvent): Record<string, unknown> {
  const { orderId: _o, seq: _s, commandId: _c, at: _a, actor: _ac, type: _t, ...rest } = e;
  return rest;
}

function toEvent(r: EventRow): OrderEvent {
  return { orderId: r.order_id, seq: r.seq, commandId: r.command_id, at: new Date(r.at), actor: r.actor, type: r.type, ...r.payload } as unknown as OrderEvent;
}
