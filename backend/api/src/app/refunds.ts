/**
 * Customer-initiated refund requests on a delivered order. The customer files a request with a reason
 * within the refund window; the order moves to REFUND_REQUESTED. Support reviews the queue and either
 * approves — the money is refunded through the same provider and the settlement is reversed so the books
 * stay balanced (the REFUND command does the reversal) — or declines, returning the order to DELIVERED.
 * Additive: it reuses the order aggregate's existing REQUEST_REFUND / REFUND / DECLINE_REFUND commands.
 */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit } from "../persistence/identity.ts";
import type { CommerceService } from "./commerce.ts";
import type { PaymentService } from "./payments.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";

export const REFUND_REASONS = ["ITEM_MISSING", "FOOD_QUALITY", "WRONG_ORDER", "DAMAGED", "LATE", "NEVER_ARRIVED", "OTHER"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
/** A refund can be requested within this many days of delivery. */
const REFUND_WINDOW_DAYS = 7;

interface RequestRow {
  id: string; order_id: string; customer_id: string; reason_code: string; comment: string | null;
  status: string; amount_minor: string; currency: string; resolution_note: string | null;
  resolved_at: Date | null; created_at: Date; customer_name?: string | null;
}

export class RefundService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly commerce: CommerceService;
  private readonly payments: PaymentService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, commerce: CommerceService, payments: PaymentService, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.commerce = commerce;
    this.payments = payments;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** Support/finance may see and resolve refund requests for the market. */
  private async assertStaff(principal: Principal, country: string, actions: readonly Action[]): Promise<void> {
    const profile = this.profile(country);
    const allowed = actions.some((a) => authorize(principal, a, { type: "order", country }, { activeCountry: country, profile }).allowed);
    if (!allowed) throw forbidden("Refund requests are handled by support or finance");
  }

  /** Customer: request a refund on their delivered order, within the window, with a reason. */
  async request(country: string, principal: Principal, orderId: string, input: { reasonCode: string; comment?: string }) {
    const reason = String(input.reasonCode ?? "").toUpperCase();
    if (!REFUND_REASONS.includes(reason as RefundReason)) throw badRequest("REASON_INVALID", `A reason is one of ${REFUND_REASONS.join(", ")}`);
    const prepared = await this.db.tx({ country }, async (sql) => {
      const o = await this.#orderFacts(sql, orderId);
      if (!o) throw notFound("Order");
      if (o.customer_id !== principal.userId) throw forbidden("You can only request a refund on your own order");
      const [open] = await sql.query<{ id: string }>("SELECT id FROM payments.refund_request WHERE order_id = $1 AND status IN ('PENDING','APPROVED')", [orderId]);
      if (open) throw conflict("REFUND_ALREADY_REQUESTED", "A refund is already open for this order");
      if (o.state !== "DELIVERED") throw unprocessable("NOT_REFUNDABLE", "You can request a refund once an order has been delivered");
      if (!o.delivered_at || this.now().getTime() - new Date(o.delivered_at).getTime() > REFUND_WINDOW_DAYS * 86_400_000) {
        throw unprocessable("REFUND_WINDOW_CLOSED", `A refund can be requested within ${REFUND_WINDOW_DAYS} days of delivery`);
      }
      const [row] = await sql.query<{ id: string }>(
        `INSERT INTO payments.refund_request (country_iso2, order_id, customer_id, reason_code, comment, amount_minor, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [country, orderId, principal.userId, reason, input.comment?.slice(0, 1000) ?? null, o.total_minor, o.currency],
      );
      await audit(sql, { actor: principal.userId, action: "refund.requested", target: `order:${orderId}`, country, detail: { reason } });
      return { requestId: row?.id as string };
    });
    try {
      // Moves the order DELIVERED -> REFUND_REQUESTED (customer owns it; order:read with OWN_RESOURCE).
      await this.commerce.transition(country, principal, orderId, { type: "REQUEST_REFUND", reasonCode: reason }, `refund-request:${prepared.requestId}`);
    } catch (error) {
      await this.db.tx({ country }, (sql) => sql.query("DELETE FROM payments.refund_request WHERE id = $1", [prepared.requestId]));
      throw error;
    }
    return { id: prepared.requestId, status: "PENDING" as const, reason_code: reason };
  }

  /** Customer: their own refund requests. */
  async mine(country: string, principal: Principal, limit = 30) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<RequestRow & Record<string, unknown>>(
        `SELECT id, order_id, customer_id, reason_code, comment, status, amount_minor::text AS amount_minor, currency, resolution_note, resolved_at, created_at
           FROM payments.refund_request WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [principal.userId, Math.min(Math.max(limit, 1), 100)],
      );
      return { requests: rows.map(view) };
    });
  }

  /** Customer or support: the request for a specific order, if any. */
  async forOrder(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const o = await this.#orderFacts(sql, orderId);
      if (!o) throw notFound("Order");
      const isOwner = o.customer_id === principal.userId;
      if (!isOwner) await this.assertStaff(principal, country, ["refund:issue", "order:manage"]);
      const [r] = await sql.query<RequestRow & Record<string, unknown>>(
        `SELECT id, order_id, customer_id, reason_code, comment, status, amount_minor::text AS amount_minor, currency, resolution_note, resolved_at, created_at
           FROM payments.refund_request WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );
      const hasOpen = !!r && (r.status === "PENDING" || r.status === "APPROVED");
      const refundable = isOwner && o.state === "DELIVERED" && !hasOpen && !!o.delivered_at && this.now().getTime() - new Date(o.delivered_at).getTime() <= REFUND_WINDOW_DAYS * 86_400_000;
      return { refundable, request: r ? view(r) : null };
    });
  }

  /** Support/finance: the pending refund queue for the market. */
  async queue(country: string, principal: Principal, limit = 100) {
    await this.assertStaff(principal, country, ["refund:issue", "order:manage"]);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<RequestRow & Record<string, unknown>>(
        `SELECT r.id, r.order_id, r.customer_id, r.reason_code, r.comment, r.status, r.amount_minor::text AS amount_minor, r.currency, r.resolution_note, r.resolved_at, r.created_at,
                u.display_name AS customer_name
           FROM payments.refund_request r LEFT JOIN identity.app_user u ON u.id = r.customer_id
          WHERE r.status = 'PENDING' ORDER BY r.created_at ASC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)],
      );
      return { requests: rows.map((r) => ({ ...view(r), customer: firstName(r.customer_name) })) };
    });
  }

  /** Support/finance: approve (refund + reverse settlement) or decline a pending request. */
  async decide(country: string, principal: Principal, requestId: string, approve: boolean, note?: string) {
    await this.assertStaff(principal, country, approve ? ["refund:issue"] : ["refund:issue", "order:manage"]);
    const req = await this.db.tx({ country }, async (sql) => {
      const [r] = await sql.query<{ order_id: string; status: string; reason_code: string }>("SELECT order_id, status, reason_code FROM payments.refund_request WHERE id = $1", [requestId]);
      if (!r) throw notFound("Refund request");
      if (r.status !== "PENDING") throw conflict("ALREADY_RESOLVED", "This refund request has already been resolved");
      return r;
    });
    if (approve) {
      // Refund the money through the provider first (outside the state transaction); a cash order has none.
      const out = await this.payments.refundPaidOrder(country, req.order_id, `REFUND_${req.reason_code}`, this.now);
      if (!out.ok) throw unprocessable("REFUND_PROVIDER_FAILED", out.error ?? "The refund could not be processed; try again");
      // Moves the order REFUND_REQUESTED -> REFUNDED and reverses the settlement so the books stay balanced.
      await this.commerce.transition(country, principal, req.order_id, { type: "REFUND", reasonCode: `REFUND_${req.reason_code}`.slice(0, 60) }, `refund-approve:${requestId}`);
    } else {
      await this.commerce.transition(country, principal, req.order_id, { type: "DECLINE_REFUND", reasonCode: "REFUND_DECLINED" }, `refund-decline:${requestId}`);
    }
    return this.db.tx({ country }, async (sql) => {
      await sql.query(
        "UPDATE payments.refund_request SET status = $2, resolved_by = $3, resolution_note = $4, resolved_at = $5, updated_at = $5 WHERE id = $1",
        [requestId, approve ? "APPROVED" : "DECLINED", principal.userId, note?.slice(0, 1000) ?? null, this.now()],
      );
      await audit(sql, { actor: principal.userId, action: approve ? "refund.approved" : "refund.declined", target: `order:${req.order_id}`, country });
      return { id: requestId, status: approve ? "APPROVED" : "DECLINED" };
    });
  }

  /** The order facts a refund needs: who owns it, its state, its total, and when it was delivered. */
  async #orderFacts(sql: Sql, orderId: string) {
    const [o] = await sql.query<{ customer_id: string; state: string; total_minor: string; currency: string; delivered_at: Date | null }>(
      `SELECT o.customer_id, o.state, o.total_minor::text AS total_minor, o.currency,
              (SELECT max(e.at) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'DELIVERED') AS delivered_at
         FROM ordering.order_view o WHERE o.order_id = $1`,
      [orderId],
    );
    return o ?? null;
  }
}

function view(r: RequestRow) {
  return {
    id: r.id, order_id: r.order_id, reason_code: r.reason_code, comment: r.comment, status: r.status,
    amount: { amount_minor: r.amount_minor, currency: r.currency },
    resolution_note: r.resolution_note, resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  };
}
const firstName = (n: string | null | undefined) => (n ? n.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] ?? "Customer" : "Customer");
