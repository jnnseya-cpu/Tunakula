/** Payment intents through Payment Orchestration (§20) and provider webhooks. */
import { Money } from "@tunakula/ts-money";
import type { PaymentConnector, PaymentMethodType } from "@tunakula/ts-contracts";
import type { Db } from "../db/db.ts";
import type { Principal } from "../modules/identity/policy.ts";
import type { PaymentRouter } from "../modules/payments/payment-router.ts";
import { replay } from "../modules/ordering/order-aggregate.ts";
import { loadOrderEvents } from "../persistence/orders.ts";
import { createIntent, intentById, intentByKey, intentByProviderRef, recordAttempts, recordConnectorEvent, updateIntent, type IntentRow } from "../persistence/payments.ts";
import type { CommerceService } from "./commerce.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";

export class PaymentService {
  private readonly db: Db;
  private readonly router: PaymentRouter;
  private readonly connectors: ReadonlyMap<string, PaymentConnector>;
  private readonly commerce: CommerceService;

  constructor(db: Db, router: PaymentRouter, connectors: ReadonlyMap<string, PaymentConnector>, commerce: CommerceService) {
    this.db = db;
    this.router = router;
    this.connectors = connectors;
    this.commerce = commerce;
  }

  /**
   * Refunds one paid order's money through its provider, outside any state transaction, and records it.
   * Idempotent on the order (payments.refund is one-per-order). For a cash order there is no online payment
   * to reverse, so it returns ok with cod=true and records nothing. Used by the post-delivery refund flow.
   */
  async refundPaidOrder(country: string, orderId: string, reasonCode: string, now: () => Date = () => new Date()): Promise<{ ok: boolean; cod?: boolean; error?: string }> {
    const intent = await this.db.tx({ country }, async (sql) => {
      const [existing] = await sql.query<{ status: string }>("SELECT status FROM payments.refund WHERE order_id = $1", [orderId]);
      if (existing?.status === "SUCCEEDED") return { done: true as const };
      const [i] = await sql.query<{ intent_id: string; connector_id: string; provider_ref: string | null; amount_minor: string; currency: string }>(
        `SELECT i.id AS intent_id, i.connector_id, i.provider_ref, i.amount_minor::text AS amount_minor, i.currency
           FROM payments.payment_intent i WHERE i.order_id = $1 AND i.status = 'SUCCEEDED' LIMIT 1`,
        [orderId],
      );
      return { done: false as const, intent: i ?? null };
    });
    if ("done" in intent && intent.done) return { ok: true };
    const i = intent.intent;
    if (!i) return { ok: true, cod: true }; // cash order: no online payment to reverse
    const connector = this.connectors.get(i.connector_id);
    let outcome: { ok: true; ref: string } | { ok: false; error: string };
    if (!connector || !i.provider_ref) outcome = { ok: false, error: `Connector ${i.connector_id} unavailable` };
    else {
      try {
        const r = await connector.refund(i.provider_ref, { minor: i.amount_minor, currency: i.currency }, `refund:${orderId}`);
        outcome = { ok: true, ref: r.refundRef };
      } catch (e) { outcome = { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Refund failed" }; }
    }
    await this.db.tx({ country }, async (sql) => {
      await sql.query(
        `INSERT INTO payments.refund (country_iso2, order_id, intent_id, connector_id, amount_minor, currency, status, refund_ref, reason_code, failure, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $11)
         ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, refund_ref = EXCLUDED.refund_ref, failure = EXCLUDED.failure,
           attempts = payments.refund.attempts + 1, updated_at = EXCLUDED.updated_at`,
        [country, orderId, i.intent_id, i.connector_id, i.amount_minor, i.currency, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.ok ? outcome.ref : null, reasonCode.slice(0, 60), outcome.ok ? null : outcome.error, now()],
      );
      if (outcome.ok) await updateIntent(sql, i.intent_id, { status: "REFUNDED" });
    });
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
  }

  /**
   * Automatic refunds: every paid order that ended before delivery (cancelled, rejected, delivery failed)
   * gets its full amount back through the same provider, then moves to REFUNDED. The provider call is
   * made outside any database transaction and is idempotent on `refund:<order>`, so a retry never pays
   * twice. Failures are recorded and retried with back-off (1, 4, 9, 16 minutes; five attempts, then ops sees them).
   */
  async refundSweep(country: string, now: () => Date = () => new Date()): Promise<{ refunded: number; failed: number }> {
    const due = await this.db.tx({ country }, (sql) => sql.query<{ order_id: string; state: string; intent_id: string; connector_id: string; provider_ref: string; amount_minor: string; currency: string; reason: string | null; attempts: number | null }>(
      `SELECT o.order_id, o.state, i.id AS intent_id, i.connector_id, i.provider_ref, i.amount_minor::text, i.currency,
              (SELECT e.payload->>'reasonCode' FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' ORDER BY e.seq DESC LIMIT 1) AS reason,
              r.attempts
         FROM ordering.order_view o
         JOIN payments.payment_intent i ON i.order_id = o.order_id AND i.status = 'SUCCEEDED'
         LEFT JOIN payments.refund r ON r.order_id = o.order_id
        WHERE o.state IN ('CANCELLED', 'REJECTED', 'DELIVERY_FAILED') AND o.payment_mode = 'PREPAID'
          AND (r.id IS NULL OR (r.status = 'FAILED' AND r.attempts < 5 AND r.updated_at <= $1::timestamptz - make_interval(mins => r.attempts * r.attempts)))
        LIMIT 50`,
      [now()],
    ));
    let refunded = 0, failed = 0;
    for (const d of due) {
      const connector = this.connectors.get(d.connector_id);
      let outcome: { ok: true; ref: string } | { ok: false; error: string };
      if (!connector || !d.provider_ref) outcome = { ok: false, error: `Connector ${d.connector_id} unavailable` };
      else {
        try {
          const r = await connector.refund(d.provider_ref, { minor: d.amount_minor, currency: d.currency }, `refund:${d.order_id}`);
          outcome = { ok: true, ref: r.refundRef };
        } catch (e) { outcome = { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Refund failed" }; }
      }
      await this.db.tx({ country }, async (sql) => {
        const reason = d.reason ?? d.state;
        await sql.query(
          `INSERT INTO payments.refund (country_iso2, order_id, intent_id, connector_id, amount_minor, currency, status, refund_ref, reason_code, failure, attempts, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $11)
           ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, refund_ref = EXCLUDED.refund_ref, failure = EXCLUDED.failure,
             attempts = payments.refund.attempts + 1, updated_at = EXCLUDED.updated_at`,
          [country, d.order_id, d.intent_id, d.connector_id, d.amount_minor, d.currency, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.ok ? outcome.ref : null, reason, outcome.ok ? null : outcome.error, now()],
        );
        if (outcome.ok) {
          await this.commerce.systemCommand(sql, country, d.order_id, `refund:${d.order_id}`, { type: "REFUND", reasonCode: `AUTO_${reason}`.slice(0, 60) }, "refunds");
          await updateIntent(sql, d.intent_id, { status: "REFUNDED" });
        }
      });
      if (outcome.ok) refunded++; else failed++;
    }
    return { refunded, failed };
  }

  /** GET /v1/countries/{iso2}/payment-methods — eligible methods in profile order (§20.5). */
  methods(country: string, payerCountry: string, amount: { currency: string; minor: string }): PaymentMethodType[] {
    const profile = this.commerce.profile(country);
    return this.router.presentableMethods(profile, {
      id: "preview",
      idempotencyKey: "preview",
      amount,
      payerCountry,
      marketCountry: country,
      payer: {},
      description: "preview",
    });
  }

  async create(country: string, principal: Principal, input: { orderId: string; methodType: PaymentMethodType; payerCountry: string; payer: { msisdn?: string; token?: string } }, idempotencyKey: string) {
    const profile = this.commerce.profile(country);
    return this.db.tx({ country }, async (sql) => {
      const existing = await intentByKey(sql, idempotencyKey);
      if (existing) return view(existing);
      const order = replay(await loadOrderEvents(sql, input.orderId));
      if (!order) throw notFound("Order");
      if (order.snapshot.customerId !== principal.userId) throw forbidden("Only the person who placed the order can pay for it");
      if (order.state !== "PENDING_PAYMENT") throw conflict("ORDER_NOT_AWAITING_PAYMENT", `Order is ${order.state}`);
      if (!/^[A-Z]{2}$/.test(input.payerCountry ?? "")) throw badRequest("PAYER_COUNTRY_INVALID", "payer_country is an ISO 3166 code");
      const total = Money.fromJSON(order.snapshot.total);
      const intent = await createIntent(sql, {
        order_id: input.orderId,
        country_iso2: country,
        brand_id: order.snapshot.brandId,
        payer_user_id: principal.userId,
        payer_country: input.payerCountry,
        method_type: input.methodType,
        amount_minor: total.minor.toString(),
        currency: total.currency,
        idempotency_key: idempotencyKey,
      });
      const outcome = await this.router.pay(profile, {
        id: intent.id,
        idempotencyKey: intent.id,
        amount: order.snapshot.total,
        methodType: input.methodType,
        payerCountry: input.payerCountry,
        marketCountry: country,
        payer: input.payer,
        description: `Tunakula order ${input.orderId}`,
        metadata: { order_id: input.orderId },
      });
      await recordAttempts(sql, intent, outcome.attempts);
      switch (outcome.status) {
        case "SUCCEEDED":
          await updateIntent(sql, intent.id, { status: "SUCCEEDED", connectorId: outcome.connectorId, providerRef: outcome.result.providerRef });
          await this.commerce.systemCommand(sql, country, input.orderId, `payment:${intent.id}:confirm`, { type: "CONFIRM_PAYMENT", paymentIntentId: intent.id });
          break;
        case "PENDING":
          await updateIntent(sql, intent.id, { status: outcome.result.state, connectorId: outcome.connectorId, providerRef: outcome.result.providerRef });
          break;
        case "DECLINED":
          await updateIntent(sql, intent.id, { status: "FAILED", reasonCode: outcome.reasonCode });
          await this.commerce.systemCommand(sql, country, input.orderId, `payment:${intent.id}:fail`, { type: "FAIL_PAYMENT", reasonCode: outcome.reasonCode });
          break;
        case "NO_ROUTE":
          await updateIntent(sql, intent.id, { status: "FAILED", reasonCode: "PROVIDER_UNAVAILABLE" });
          await this.commerce.systemCommand(sql, country, input.orderId, `payment:${intent.id}:fail`, { type: "FAIL_PAYMENT", reasonCode: "PROVIDER_UNAVAILABLE" });
          break;
        case "OUTCOME_UNKNOWN":
          // Never retried elsewhere (ADR 0003): status polling or the webhook resolves it.
          await updateIntent(sql, intent.id, { status: "PROCESSING", connectorId: outcome.connectorId });
          break;
      }
      const after = (await intentById(sql, intent.id)) as IntentRow;
      const next = outcome.status === "PENDING" ? outcome.result.nextAction : undefined;
      return { ...view(after), ...(next ? { next_action: next } : {}) };
    });
  }

  async get(country: string, principal: Principal, intentId: string) {
    return this.db.tx({ country }, async (sql) => {
      const intent = await intentById(sql, intentId);
      if (!intent || intent.payer_user_id !== principal.userId) throw notFound("Payment");
      return view(intent);
    });
  }

  /** POST /v1/webhooks/payments/{connector}: verified, deduplicated, then applied in the payment's own country. */
  async webhook(connectorId: string, headers: Record<string, string>, rawBody: string): Promise<{ accepted: boolean; duplicate?: boolean }> {
    const connector = this.connectors.get(connectorId);
    if (!connector) throw notFound("Connector");
    if (!connector.verifyWebhook(headers, rawBody)) throw unprocessable("SIGNATURE_INVALID", "Webhook signature verification failed");
    const event = connector.parseWebhook(headers, rawBody);
    const [row] = await this.db.tx({}, (sql) => sql.query<{ country: string | null }>("SELECT payments.country_for_provider_ref($1, $2) AS country", [connectorId, event.providerRef]));
    const country = row?.country;
    if (!country) throw notFound("Payment for this webhook");
    return this.db.tx({ country }, async (sql) => {
      const fresh = await recordConnectorEvent(sql, { connectorId, eventId: event.eventId, providerRef: event.providerRef, state: event.state, raw: rawBody, signatureOk: true });
      if (!fresh) return { accepted: true, duplicate: true };
      const intent = (await intentByProviderRef(sql, connectorId, event.providerRef)) as IntentRow;
      if (intent.status === "SUCCEEDED" || intent.status === "FAILED") return { accepted: true };
      await updateIntent(sql, intent.id, { status: event.state, reasonCode: event.reasonCode ?? null });
      if (event.state === "SUCCEEDED") {
        await this.commerce.systemCommand(sql, country, intent.order_id, `payment:${intent.id}:confirm`, { type: "CONFIRM_PAYMENT", paymentIntentId: intent.id });
      } else if (["FAILED", "EXPIRED", "CANCELLED"].includes(event.state)) {
        await this.commerce.systemCommand(sql, country, intent.order_id, `payment:${intent.id}:fail`, { type: "FAIL_PAYMENT", reasonCode: event.reasonCode ?? event.state });
      }
      return { accepted: true };
    });
  }
}

function view(i: IntentRow) {
  return {
    id: i.id,
    order_id: i.order_id,
    status: i.status,
    method_type: i.method_type,
    amount: { amount_minor: i.amount_minor, currency: i.currency },
    ...(i.connector_id ? { connector: i.connector_id } : {}),
    ...(i.reason_code ? { reason_code: i.reason_code } : {}),
  };
}
