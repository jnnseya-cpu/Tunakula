/**
 * In-memory Stripe that follows the documented test behaviour: payment-method
 * test tokens drive the outcome (pm_card_visa succeeds, pm_card_authRequired goes
 * to 3-D Secure, the decline tokens fail with a decline_code), POSTs are
 * idempotent by Idempotency-Key, refunds are reserved against the refundable
 * amount, and webhooks are signed with the endpoint secret (Stripe-Signature).
 */
import { createHmac } from "node:crypto";
import type { HttpRequest, HttpResponse, HttpTransport } from "@tunakula/payment-http";

interface Intent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  token?: string;
  refunded: number;
  last_payment_error: { code: string; decline_code?: string } | null;
  settled_at?: string;
}

// Test tokens → sandbox outcome. Mirrors Stripe's own pm_card_* test methods.
const DECLINES: Record<string, { code: string; decline_code: string }> = {
  pm_card_chargeDeclined: { code: "card_declined", decline_code: "generic_decline" },
  pm_card_insufficient: { code: "card_declined", decline_code: "insufficient_funds" },
  pm_card_authFail: { code: "payment_intent_authentication_failure", decline_code: "authentication_failure" },
};

export class FakeStripe {
  readonly webhookSecret = "whsec_test_123";
  readonly intents = new Map<string, Intent>();
  readonly #idem = new Map<string, HttpResponse>();
  readonly requests: HttpRequest[] = [];
  #n = 0;
  down: "none" | "rate_limited" | "server_error" = "none";
  today = "2026-10-06";

  transport: HttpTransport = async (req) => {
    this.requests.push(req);
    if (this.down === "rate_limited") return { status: 429, headers: { "retry-after": "1" }, body: { error: { code: "rate_limited" } } };
    if (this.down === "server_error") return { status: 502, headers: {}, body: "bad gateway" };
    if (!req.headers?.["Authorization"]?.startsWith("Bearer sk_test_")) return { status: 401, headers: {}, body: { error: { code: "api_key_invalid" } } };
    const key = req.headers?.["Idempotency-Key"];
    if (req.method === "POST" && !key) return { status: 400, headers: {}, body: { error: { code: "idempotency_error" } } };
    if (key && this.#idem.has(`${req.path}:${key}`)) return this.#idem.get(`${req.path}:${key}`) as HttpResponse;
    const res = this.#route(req);
    if (key && res.status < 500) this.#idem.set(`${req.path}:${key}`, res);
    return res;
  };

  #route(req: HttpRequest): HttpResponse {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (req.method === "POST" && req.path === "/payment_intents") return this.#createIntent(b);
    const m = /^\/payment_intents\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && m) {
      const intent = this.intents.get(decodeURIComponent(m[1] as string));
      return intent ? ok(this.#view(intent)) : { status: 404, headers: {}, body: { error: { code: "resource_missing" } } };
    }
    if (req.method === "POST" && req.path === "/refunds") return this.#refund(b);
    if (req.method === "GET" && req.path === "/balance_transactions") {
      const data = [...this.intents.values()]
        .filter((i) => i.settled_at?.startsWith(this.today))
        .flatMap((i) => {
          const rows: Record<string, unknown>[] = [{ payment_intent: i.id, source: `ch_${i.id}`, amount: i.amount, fee: Math.round(i.amount * 0.029) + 30, currency: i.currency, type: "charge", created: Math.floor(Date.parse(i.settled_at as string) / 1000) }];
          if (i.refunded > 0) rows.push({ payment_intent: i.id, source: `re_${i.id}`, amount: -i.refunded, fee: 0, currency: i.currency, type: "refund", created: Math.floor(Date.parse(i.settled_at as string) / 1000) });
          return rows;
        });
      return ok({ data });
    }
    return { status: 404, headers: {}, body: { error: { code: "resource_missing" } } };
  }

  #createIntent(b: Record<string, unknown>): HttpResponse {
    if (typeof b["amount"] !== "number" || !Number.isInteger(b["amount"])) return { status: 400, headers: {}, body: { error: { code: "parameter_invalid_integer" } } };
    const token = b["payment_method"] as string | undefined;
    const intent: Intent = { id: `pi_${++this.#n}`, status: "requires_payment_method", amount: b["amount"] as number, currency: b["currency"] as string, refunded: 0, last_payment_error: null, ...(token ? { token } : {}) };
    if (token === "pm_card_visa") this.#succeed(intent);
    else if (token === "pm_card_authRequired") intent.status = "requires_action";
    else if (token === "pm_card_processing") intent.status = "processing";
    else if (token && DECLINES[token]) intent.last_payment_error = DECLINES[token]!;
    else this.#succeed(intent); // no token in the sandbox behaves like a confirmed test card
    this.intents.set(intent.id, intent);
    // A decline returns 402 with the error, exactly like Stripe.
    if (intent.last_payment_error) return { status: 402, headers: {}, body: { error: { ...intent.last_payment_error, payment_intent: this.#view(intent) } } };
    return ok(this.#view(intent));
  }

  #refund(b: Record<string, unknown>): HttpResponse {
    const intent = this.intents.get(b["payment_intent"] as string);
    const amount = b["amount"] as number;
    if (!intent || !["succeeded", "partially_refunded"].includes(intent.status)) return { status: 400, headers: {}, body: { error: { code: "charge_already_refunded" } } };
    if (amount <= 0 || amount > intent.amount - intent.refunded) return { status: 400, headers: {}, body: { error: { code: "amount_too_large" } } };
    intent.refunded += amount;
    intent.status = intent.refunded === intent.amount ? "refunded" : "partially_refunded";
    return ok({ id: `re_${++this.#n}`, status: "succeeded" });
  }

  #succeed(intent: Intent): void {
    intent.status = "succeeded";
    intent.last_payment_error = null;
    intent.settled_at = `${this.today}T12:00:00Z`;
  }

  #view(i: Intent) {
    return {
      id: i.id,
      status: i.status,
      amount: i.amount,
      amount_received: i.status === "succeeded" ? i.amount : 0,
      amount_refunded: i.refunded,
      currency: i.currency,
      client_secret: `${i.id}_secret_x`,
      next_action: i.status === "requires_action" ? { type: "redirect_to_url", redirect_to_url: { url: `https://hooks.stripe.com/3ds/${i.id}` } } : null,
      last_payment_error: i.last_payment_error,
    };
  }

  /** Drives a 3-D Secure intent to success and returns the signed webhook Stripe sends. */
  completePending(id: string): { headers: Record<string, string>; body: string } {
    const intent = this.intents.get(id) as Intent;
    this.#succeed(intent);
    return this.signedEvent({ id: `evt_${++this.#n}`, type: "payment_intent.succeeded", created: 1_791_000_000, data: { object: this.#view(intent) } });
  }

  signedEvent(event: unknown): { headers: Record<string, string>; body: string } {
    const body = JSON.stringify(event);
    const t = "1791000000";
    const v1 = createHmac("sha256", this.webhookSecret).update(`${t}.${body}`).digest("hex");
    return { headers: { "Stripe-Signature": `t=${t},v1=${v1}` }, body };
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
