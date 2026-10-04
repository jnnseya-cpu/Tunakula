/**
 * In-memory BitriPay that follows the documented sandbox: magic MSISDNs drive
 * the attempt machine, POSTs are idempotent by Idempotency-Key, refunds are
 * reserved against the refundable amount, and webhooks are signed with the
 * endpoint secret (HMAC) and the platform Ed25519 key.
 */
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import type { HttpRequest, HttpResponse, HttpTransport } from "@tunakula/payment-http";

interface Intent {
  id: string;
  status: string;
  amount_minor: number;
  currency: string;
  msisdn?: string;
  account?: string;
  refunded: number;
  last_payment_error: { code: string } | null;
  settled_at?: string;
}

export class FakeBitriPay {
  readonly webhookSecret = "whsec_test_123";
  readonly kid = "k2026";
  readonly #keys = generateKeyPairSync("ed25519");
  readonly publicKeyPem = this.#keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  readonly intents = new Map<string, Intent>();
  readonly #idem = new Map<string, HttpResponse>();
  readonly requests: HttpRequest[] = [];
  #n = 0;
  down: "none" | "refused" | "rate_limited" | "server_error" = "none";
  today = "2026-10-04";

  transport: HttpTransport = async (req) => {
    this.requests.push(req);
    if (this.down === "rate_limited") return { status: 429, headers: { "retry-after": "1" }, body: { error: { code: "rate_limited" } } };
    if (this.down === "server_error") return { status: 502, headers: {}, body: "bad gateway" };
    if (!req.headers?.["Authorization"]?.startsWith("Bearer sk_test_")) return { status: 401, headers: {}, body: { error: { code: "unauthorized" } } };
    const key = req.headers?.["Idempotency-Key"];
    if (req.method === "POST" && !key) return { status: 400, headers: {}, body: { error: { code: "idempotency_key_required" } } };
    if (key && this.#idem.has(`${req.path}:${key}`)) return this.#idem.get(`${req.path}:${key}`) as HttpResponse;
    const res = this.#route(req);
    if (key && res.status < 500) this.#idem.set(`${req.path}:${key}`, res);
    return res;
  };

  #route(req: HttpRequest): HttpResponse {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (req.method === "POST" && req.path === "/payment_intents") return this.#createIntent(b, req.headers?.["BitriPay-Account"]);
    const m = /^\/payment_intents\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && m) {
      const intent = this.intents.get(decodeURIComponent(m[1] as string));
      return intent ? ok(this.#view(intent)) : { status: 404, headers: {}, body: { error: { code: "not_found" } } };
    }
    if (req.method === "POST" && req.path === "/refunds") return this.#refund(b);
    if (req.method === "POST" && req.path === "/payouts") {
      const dest = b["destination"] as { msisdn?: string } | undefined;
      if (dest?.msisdn?.endsWith("0404")) return { status: 422, headers: {}, body: { error: { code: "invalid_msisdn" } } };
      return ok({ id: `po_${++this.#n}`, status: "pending" });
    }
    if (req.method === "GET" && req.path === "/settlement_cycles") return ok({ data: [{ id: `cyc_${req.query?.["date"]}` }] });
    const s = /^\/settlement_cycles\/cyc_(.+)\/statement$/.exec(req.path);
    if (req.method === "GET" && s) {
      const items = [...this.intents.values()]
        .filter((i) => i.settled_at?.startsWith(s[1] as string))
        .map((i) => ({ payment_intent: i.id, reference: i.id, amount_minor: i.amount_minor, fee_minor: Math.round(i.amount_minor * 0.015), currency: i.currency, type: "payment", settled_at: i.settled_at }));
      return ok({ items });
    }
    return { status: 404, headers: {}, body: { error: { code: "not_found" } } };
  }

  #createIntent(b: Record<string, unknown>, account?: string): HttpResponse {
    if (typeof b["amount_minor"] !== "number" || !Number.isInteger(b["amount_minor"])) return { status: 400, headers: {}, body: { error: { code: "invalid_amount" } } };
    const msisdn = b["payer_msisdn"] as string | undefined;
    const intent: Intent = {
      id: `pi_${++this.#n}`,
      status: "REQUIRES_ACTION",
      amount_minor: b["amount_minor"] as number,
      currency: b["currency"] as string,
      refunded: 0,
      last_payment_error: null,
      ...(msisdn ? { msisdn } : {}),
      ...(account ? { account } : {}),
    };
    // Documented sandbox numbers.
    if (msisdn === "+243000000501") this.#succeed(intent);
    else if (msisdn === "+243000000404") Object.assign(intent, { status: "REQUIRES_PAYMENT_METHOD", last_payment_error: { code: "invalid_msisdn" } });
    else if (msisdn === "+243000000408") intent.status = "AMBIGUOUS";
    else if (msisdn === "+243000000500") intent.status = "PROCESSING";
    else if (msisdn === "+243000000503") Object.assign(intent, { status: "REQUIRES_PAYMENT_METHOD", last_payment_error: { code: "provider_unavailable" } });
    else if (msisdn?.endsWith("0000")) Object.assign(intent, { status: "REQUIRES_PAYMENT_METHOD", last_payment_error: { code: "declined" } });
    this.intents.set(intent.id, intent);
    return ok(this.#view(intent));
  }

  #refund(b: Record<string, unknown>): HttpResponse {
    const intent = this.intents.get(b["payment_intent"] as string);
    const amount = b["amount_minor"] as number;
    if (!intent || !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(intent.status)) return { status: 409, headers: {}, body: { error: { code: "not_refundable" } } };
    if (amount <= 0 || amount > intent.amount_minor - intent.refunded) return { status: 422, headers: {}, body: { error: { code: "amount_exceeds_refundable" } } };
    intent.refunded += amount;
    intent.status = intent.refunded === intent.amount_minor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return ok({ id: `re_${++this.#n}`, status: "succeeded" });
  }

  #succeed(intent: Intent): void {
    intent.status = "SUCCEEDED";
    intent.settled_at = `${this.today}T12:00:00Z`;
  }

  #view(i: Intent) {
    return {
      id: i.id,
      status: i.status,
      amount_minor: i.amount_minor,
      currency: i.currency,
      checkout_url: `https://pay.bitripay.com/c/${i.id}`,
      qr_payload: `000201BITRI${i.id}`,
      last_payment_error: i.last_payment_error,
    };
  }

  /** "+243000000500: timeout then succeed" — completes and returns the signed webhook BitriPay sends. */
  completePending(id: string): { headers: Record<string, string>; body: string } {
    const intent = this.intents.get(id) as Intent;
    this.#succeed(intent);
    return this.signedEvent({ id: `evt_${++this.#n}`, type: "payment_intent.succeeded", created: 1_791_000_000, data: { object: this.#view(intent) } });
  }

  signedEvent(event: unknown): { headers: Record<string, string>; body: string } {
    const body = JSON.stringify(event);
    const t = "1791000000";
    const v1 = createHmac("sha256", this.webhookSecret).update(`${t}.${body}`).digest("hex");
    const sig = sign(null, Buffer.from(body), this.#keys.privateKey).toString("base64");
    return { headers: { "BitriPay-Signature": `t=${t},v1=${v1}`, "BitriPay-Platform-Signature": `kid=${this.kid},sig=${sig}` }, body };
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
