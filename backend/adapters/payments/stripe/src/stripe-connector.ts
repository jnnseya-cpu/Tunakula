/**
 * Stripe connector — the card rail (PRD §20). Implements the PaymentConnector
 * port over Stripe's PaymentIntents API: create an intent, the customer confirms
 * the card (3-D Secure handled client-side via the returned redirect/client
 * secret), Stripe fires `payment_intent.succeeded`, and refunds are real and
 * partial. Money moves only with an Idempotency-Key; Tunakula never holds funds.
 *
 * Payouts to merchants/riders are not done here — that is Stripe Connect / the
 * group payout rail — so this connector advertises payout:false and implements
 * only PaymentConnector.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchTransport, classifyStatus, type HttpResponse, type HttpTransport } from "@tunakula/payment-http";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import {
  ConnectorOutcomeUnknownError,
  type ConnectorCapability,
  type ConnectorHealth,
  type InitiateResult,
  type NextAction,
  type NormalisedWebhookEvent,
  type PaymentConnector,
  type PaymentIntent,
  type RefundResult,
  type StatementLine,
  type StatusResult,
} from "@tunakula/ts-contracts";
import { HEADERS, PATHS, STRIPE_BASE_URL, mapErrorCode, mapEventType, mapIntentStatus, mapRefundStatus } from "./mapping.ts";

export interface StripeOptions {
  readonly id?: string;
  /** sk_test_… hits the sandbox, sk_live_… the real rails. Read from Secret Manager, server side only. */
  readonly apiKey: string;
  /** whsec_… signing secret of the registered webhook endpoint. */
  readonly webhookSecret: string;
  readonly capabilities: readonly ConnectorCapability[];
  /** Where Stripe returns the customer after 3-D Secure (deep link into the app or the web order page). */
  readonly returnUrlFor?: (intent: PaymentIntent) => string | undefined;
  readonly baseUrl?: string;
  readonly transport?: HttpTransport;
  readonly healthWindow?: number;
}

interface StripeIntent {
  id: string;
  status: string;
  amount?: number | string;
  amount_received?: number | string;
  amount_refunded?: number | string;
  currency?: string;
  client_secret?: string;
  next_action?: { type?: string; redirect_to_url?: { url?: string } } | null;
  last_payment_error?: { code?: string; decline_code?: string } | null;
}

export class StripeConnector implements PaymentConnector {
  readonly id: string;
  readonly version = "0.1.0";
  readonly #options: StripeOptions;
  readonly #http: HttpTransport;
  readonly #samples: { ok: boolean; ms: number }[] = [];

  constructor(options: StripeOptions) {
    if (!/^(sk|rk)_(test|live)_/.test(options.apiKey)) throw new TypeError("Stripe needs a secret (sk_) or restricted (rk_) key; pk_ keys belong in the browser only");
    if (!options.webhookSecret?.startsWith("whsec_")) throw new TypeError("Stripe webhook signing secret (whsec_) is required");
    this.id = options.id ?? "stripe";
    this.#options = options;
    this.#http = options.transport ?? fetchTransport({ connectorId: this.id, baseUrl: options.baseUrl ?? STRIPE_BASE_URL });
  }

  get liveMode(): boolean {
    return this.#options.apiKey.includes("_live_");
  }

  capabilities(): readonly ConnectorCapability[] {
    return this.#options.capabilities;
  }

  async initiate(intent: PaymentIntent): Promise<InitiateResult> {
    const returnUrl = this.#options.returnUrlFor?.(intent);
    const res = await this.#call(
      "POST",
      PATHS.paymentIntents,
      {
        amount: wireAmount(intent.amount),
        currency: intent.amount.currency.toLowerCase(),
        description: intent.description,
        confirm: true,
        // The browser/kiosk supplies the card via Stripe.js; the sandbox drives outcomes by this token.
        ...(intent.payer.token ? { payment_method: intent.payer.token } : {}),
        ...(returnUrl ? { return_url: returnUrl } : {}),
        "metadata[tunakula_intent_id]": intent.id,
        "metadata[method_type]": intent.methodType,
      },
      { [HEADERS.idempotency]: intent.idempotencyKey },
      true,
    );
    const body = res.body as StripeIntent;
    if (res.status >= 400) {
      // On a declined confirm Stripe returns 402 with the PaymentIntent nested under `error.payment_intent`;
      // keep its id so the payment is still readable by getStatus for reconciliation.
      const code = declineOf(res.body);
      const failedRef = body?.id ?? erroredIntentId(res.body) ?? `rejected:${intent.idempotencyKey}`;
      return { providerRef: failedRef, state: "FAILED", nextAction: { type: "NONE" }, reasonCode: mapErrorCode(code) };
    }
    const code = body.last_payment_error?.decline_code ?? body.last_payment_error?.code ?? undefined;
    const state = mapIntentStatus(body.status, code);
    return {
      providerRef: body.id,
      state,
      nextAction: nextAction(body, state),
      ...(state === "FAILED" ? { reasonCode: mapErrorCode(code) } : {}),
    };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const res = await this.#call("GET", PATHS.paymentIntent(providerRef));
    if (res.status >= 400) throw new Error(`Stripe could not read ${providerRef}: HTTP ${res.status}`);
    const body = res.body as StripeIntent;
    const code = body.last_payment_error?.decline_code ?? body.last_payment_error?.code ?? undefined;
    const state = mapIntentStatus(body.status, code);
    return { providerRef, state, ...(state === "FAILED" ? { reasonCode: mapErrorCode(code), ...(code ? { providerCode: code } : {}) } : {}) };
  }

  async refund(providerRef: string, amount: MoneyJSON, idempotencyKey: string): Promise<RefundResult> {
    const res = await this.#call("POST", PATHS.refunds, { payment_intent: providerRef, amount: wireAmount(amount) }, { [HEADERS.idempotency]: idempotencyKey }, true);
    const body = res.body as { id?: string; status?: string };
    if (res.status >= 400) return { refundRef: body?.id ?? `rejected:${idempotencyKey}`, state: "FAILED", reasonCode: mapErrorCode(declineOf(res.body)) };
    return { refundRef: body.id as string, state: mapRefundStatus(body.status ?? "") };
  }

  /**
   * Stripe-Signature verification: HMAC-SHA256 of "<t>.<raw body>" with the
   * endpoint signing secret, constant-time compared. (Replay-window checks on
   * `t` are enforced at the HTTP edge, not here.)
   */
  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): boolean {
    const header = Object.entries(headers).find(([k]) => k.toLowerCase() === HEADERS.signature)?.[1];
    const parsed = parseSignatureHeader(header);
    if (!parsed) return false;
    const signed = parsed.t ? `${parsed.t}.${body}` : body;
    const expected = createHmac("sha256", this.#options.webhookSecret).update(signed).digest("hex");
    return safeEqualHex(parsed.v1, expected);
  }

  parseWebhook(headers: Readonly<Record<string, string>>, body: string): NormalisedWebhookEvent {
    if (!this.verifyWebhook(headers, body)) throw new Error("Invalid Stripe webhook signature");
    const event = JSON.parse(body) as { id: string; type: string; created?: number; data?: { object?: StripeIntent & { payment_intent?: string; amount?: number } } };
    const object = event.data?.object;
    if (!object) throw new Error(`Unhandled Stripe event ${event.type}`);
    let state = mapEventType(event.type);
    if (event.type === "charge.refunded") {
      const amount = Number(object.amount ?? 0);
      const refunded = Number(object.amount_refunded ?? 0);
      state = refunded > 0 && refunded < amount ? "PARTIALLY_REFUNDED" : "REFUNDED";
    }
    state ??= object.status ? mapIntentStatus(object.status, object.last_payment_error?.code ?? undefined) : undefined;
    if (!state) throw new Error(`Unhandled Stripe event ${event.type}`);
    const code = object.last_payment_error?.decline_code ?? object.last_payment_error?.code ?? undefined;
    return {
      eventId: event.id,
      providerRef: object.payment_intent ?? object.id,
      state,
      ...(state === "FAILED" ? { reasonCode: mapErrorCode(code) } : {}),
      occurredAt: typeof event.created === "number" ? new Date(event.created * 1000) : new Date(),
    };
  }

  /** Statement lines for reconciliation (§20.6), from the day's balance transactions. */
  async fetchStatement(date: string): Promise<readonly StatementLine[]> {
    const res = await this.#call("GET", PATHS.balanceTransactions, undefined, {}, false, { "created[gte]": epochStart(date), "created[lt]": epochStart(date, 1), limit: "100" });
    const list = ((res.body as { data?: BalanceTxn[] })?.data ?? []) as BalanceTxn[];
    return list
      .filter((b) => b.type === "charge" || b.type === "refund")
      .map((b) => ({
        providerRef: b.payment_intent ?? b.source,
        amount: { currency: (b.currency ?? "usd").toUpperCase(), minor: String(Math.abs(Number(b.amount))) },
        fee: { currency: (b.currency ?? "usd").toUpperCase(), minor: String(Math.abs(Number(b.fee ?? 0))) },
        kind: b.type === "refund" ? "REFUND" : "COLLECTION",
        settledAt: new Date(Number(b.created) * 1000),
      }));
  }

  health(): ConnectorHealth {
    const n = this.#samples.length;
    if (n === 0) return { latencyMsP95: 0, errorRate: 0, successRate: 1 };
    const errors = this.#samples.filter((s) => !s.ok).length;
    const sorted = this.#samples.map((s) => s.ms).sort((a, b) => a - b);
    return { latencyMsP95: sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0, errorRate: errors / n, successRate: 1 - errors / n };
  }

  async #call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}, movesMoney = false, query?: Record<string, string>): Promise<HttpResponse> {
    const started = Date.now();
    let ok = false;
    try {
      const res = await this.#http({
        method,
        path,
        headers: { Authorization: `Bearer ${this.#options.apiKey}`, ...headers },
        ...(body !== undefined ? { body } : {}),
        ...(query ? { query } : {}),
      });
      if (movesMoney) classifyStatus(this.id, res);
      else if (res.status >= 500) throw new ConnectorOutcomeUnknownError(this.id, `HTTP ${res.status}`);
      ok = res.status < 500 && res.status !== 429;
      return res;
    } finally {
      this.#samples.push({ ok, ms: Date.now() - started });
      if (this.#samples.length > (this.#options.healthWindow ?? 200)) this.#samples.shift();
    }
  }
}

interface BalanceTxn {
  payment_intent?: string;
  source: string;
  amount: number | string;
  fee?: number | string;
  currency?: string;
  type?: string;
  created: number | string;
}

function nextAction(body: StripeIntent, state: string): NextAction {
  if (state !== "PENDING_CUSTOMER_ACTION" && state !== "PROCESSING") return { type: "NONE" };
  const url = body.next_action?.redirect_to_url?.url;
  if (url) return { type: "REDIRECT", url };
  return { type: "NONE" };
}

/** Stripe takes amount as a JSON integer in the currency's minor unit; refuse amounts JSON cannot carry exactly. */
function wireAmount(amount: MoneyJSON): number {
  const minor = Money.fromJSON(amount).minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < 0n) throw new RangeError(`Amount ${amount.minor} cannot be sent exactly to Stripe`);
  return Number(minor);
}

function declineOf(body: unknown): string | undefined {
  const b = body as { error?: { code?: string; decline_code?: string } };
  return b?.error?.decline_code ?? b?.error?.code;
}

function erroredIntentId(body: unknown): string | undefined {
  return (body as { error?: { payment_intent?: { id?: string } } })?.error?.payment_intent?.id;
}

/** Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>…]". Accepts a bare hex digest too. */
function parseSignatureHeader(value: string | undefined): { t?: string; v1: string } | undefined {
  if (!value) return undefined;
  if (!value.includes("=")) return { v1: value.trim() };
  const parts = value.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1 = parts.find(([k]) => k === "v1")?.[1] ?? "";
  return { v1, ...(t ? { t } : {}) };
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** UNIX seconds at UTC midnight of `date` (YYYY-MM-DD), plus `addDays`. */
function epochStart(date: string, addDays = 0): string {
  return String(Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + addDays * 86400);
}
