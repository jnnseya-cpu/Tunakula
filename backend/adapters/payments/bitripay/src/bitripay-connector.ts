/**
 * BitriPay connector — the group payment rail (PRD §20: "connectors live in
 * BitriPay wherever it covers a market"). Implements the PaymentConnector and
 * PayoutConnector ports over BitriPay's REST API.
 *
 * Money moves only with an Idempotency-Key. Tunakula never holds funds:
 * merchants can be BitriPay connected accounts (merchant of record), addressed
 * per intent with the BitriPay-Account header.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { fetchTransport, classifyStatus, type HttpResponse, type HttpTransport } from "@tunakula/payment-http";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import {
  ConnectorOutcomeUnknownError,
  type Beneficiary,
  type ConnectorCapability,
  type ConnectorHealth,
  type InitiateResult,
  type NextAction,
  type NormalisedWebhookEvent,
  type PaymentConnector,
  type PaymentIntent,
  type PaymentReasonCode,
  type PayoutConnector,
  type RefundResult,
  type StatementLine,
  type StatusResult,
} from "@tunakula/ts-contracts";
import {
  BITRIPAY_BASE_URL,
  DEFAULT_OPERATORS,
  HEADERS,
  PATHS,
  PAYER_MSISDN_FIELD,
  mapErrorCode,
  mapEventType,
  mapIntentStatus,
  mapPayoutStatus,
  mapRefundStatus,
} from "./mapping.ts";

export interface BitriPayOptions {
  readonly id?: string;
  /** sk_test_… hits the sandbox, sk_live_… the real rails (same base URL). Read from Secret Manager. */
  readonly apiKey: string;
  /** whsec_… secret of the registered webhook endpoint. */
  readonly webhookSecret: string;
  /** Platform Ed25519 public keys by key id, from GET /v1/keys (PEM/SPKI). When set, webhooks must carry a valid platform signature too. */
  readonly platformKeys?: Readonly<Record<string, string>>;
  readonly capabilities: readonly ConnectorCapability[];
  readonly operatorsByCountry?: Readonly<Record<string, readonly string[]>>;
  /** The merchant's BitriPay connected account for this intent, if payments settle to merchants directly. */
  readonly connectedAccountFor?: (intent: PaymentIntent) => string | undefined;
  readonly baseUrl?: string;
  readonly transport?: HttpTransport;
  readonly healthWindow?: number;
}

interface BitriPayIntent {
  id: string;
  status: string;
  amount_minor?: number | string;
  currency?: string;
  checkout_url?: string;
  qr_payload?: string;
  expires_at?: string;
  last_payment_error?: { code?: string } | null;
}

export class BitriPayConnector implements PaymentConnector, PayoutConnector {
  readonly id: string;
  readonly version = "0.1.0";
  readonly #options: BitriPayOptions;
  readonly #http: HttpTransport;
  readonly #samples: { ok: boolean; ms: number }[] = [];

  constructor(options: BitriPayOptions) {
    if (!/^(sk|rk)_(test|live)_/.test(options.apiKey)) throw new TypeError("BitriPay needs a secret (sk_) or restricted (rk_) key");
    if (!options.webhookSecret) throw new TypeError("BitriPay webhook secret (whsec_) is required");
    this.id = options.id ?? "bitripay";
    this.#options = options;
    this.#http = options.transport ?? fetchTransport({ connectorId: this.id, baseUrl: options.baseUrl ?? BITRIPAY_BASE_URL });
  }

  get liveMode(): boolean {
    return this.#options.apiKey.includes("_live_");
  }

  capabilities(): readonly ConnectorCapability[] {
    return this.#options.capabilities;
  }

  async initiate(intent: PaymentIntent): Promise<InitiateResult> {
    const operators = (this.#options.operatorsByCountry ?? DEFAULT_OPERATORS)[intent.payerCountry];
    const account = this.#options.connectedAccountFor?.(intent);
    const res = await this.#call(
      "POST",
      PATHS.paymentIntents,
      {
        amount_minor: wireAmount(intent.amount),
        currency: intent.amount.currency,
        description: intent.description,
        ...(operators ? { allowed_operators: operators } : {}),
        ...(intent.payer.msisdn ? { [PAYER_MSISDN_FIELD]: intent.payer.msisdn } : {}),
        metadata: { ...intent.metadata, tunakula_intent_id: intent.id, method_type: intent.methodType },
      },
      { [HEADERS.idempotency]: intent.idempotencyKey, ...(account ? { [HEADERS.account]: account } : {}) },
      true,
    );
    const body = res.body as BitriPayIntent;
    if (res.status >= 400) {
      const code = errorCodeOf(res.body);
      return { providerRef: body?.id ?? `rejected:${intent.idempotencyKey}`, state: "FAILED", nextAction: { type: "NONE" }, reasonCode: mapErrorCode(code) };
    }
    const state = mapIntentStatus(body.status, body.last_payment_error?.code);
    return {
      providerRef: body.id,
      state,
      nextAction: nextAction(intent, body, state),
      ...(body.expires_at ? { expiresAt: new Date(body.expires_at) } : {}),
      ...(state === "FAILED" ? { reasonCode: mapErrorCode(body.last_payment_error?.code ?? undefined) } : {}),
    };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const res = await this.#call("GET", PATHS.paymentIntent(providerRef));
    if (res.status >= 400) throw new Error(`BitriPay could not read ${providerRef}: HTTP ${res.status} ${errorCodeOf(res.body) ?? ""}`);
    const body = res.body as BitriPayIntent;
    const code = body.last_payment_error?.code ?? undefined;
    const state = mapIntentStatus(body.status, code);
    return { providerRef, state, ...(state === "FAILED" ? { reasonCode: mapErrorCode(code), ...(code ? { providerCode: code } : {}) } : {}) };
  }

  async refund(providerRef: string, amount: MoneyJSON, idempotencyKey: string): Promise<RefundResult> {
    const res = await this.#call("POST", PATHS.refunds, { payment_intent: providerRef, amount_minor: wireAmount(amount) }, { [HEADERS.idempotency]: idempotencyKey }, true);
    const body = res.body as { id?: string; status?: string };
    if (res.status >= 400) return { refundRef: body?.id ?? `rejected:${idempotencyKey}`, state: "FAILED", reasonCode: mapErrorCode(errorCodeOf(res.body)) };
    return { refundRef: body.id as string, state: mapRefundStatus(body.status ?? "") };
  }

  async payout(beneficiary: Beneficiary, amount: MoneyJSON, idempotencyKey: string): Promise<{ payoutRef: string; state: "PENDING" | "SENT" | "FAILED"; reasonCode?: PaymentReasonCode }> {
    const destination =
      beneficiary.rail === "MOBILE_MONEY"
        ? { type: "mobile_money", msisdn: beneficiary.account, country: beneficiary.country }
        : { type: "bank_account", account_number: beneficiary.account, country: beneficiary.country };
    const res = await this.#call(
      "POST",
      PATHS.payouts,
      { amount_minor: wireAmount(amount), currency: amount.currency, destination, metadata: { beneficiary_id: beneficiary.id, beneficiary_kind: beneficiary.kind } },
      { [HEADERS.idempotency]: idempotencyKey },
      true,
    );
    const body = res.body as { id?: string; status?: string };
    if (res.status >= 400) {
      return { payoutRef: body?.id ?? `rejected:${idempotencyKey}`, state: "FAILED", reasonCode: mapErrorCode(errorCodeOf(res.body)) };
    }
    return { payoutRef: body.id as string, state: mapPayoutStatus(body.status ?? "") };
  }

  /**
   * Webhook verification: HMAC-SHA256 of the raw body with the endpoint secret
   * (BitriPay-Signature) and, when platform keys are configured, the platform
   * Ed25519 signature. Both must pass.
   */
  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): boolean {
    const h = lower(headers);
    const given = parseSignatureHeader(h[HEADERS.signature]);
    if (!given) return false;
    const signed = given.t ? `${given.t}.${body}` : body;
    const expected = createHmac("sha256", this.#options.webhookSecret).update(signed).digest("hex");
    if (!safeEqualHex(given.v1, expected)) return false;
    if (!this.#options.platformKeys) return true;
    const platform = parseSignatureHeader(h[HEADERS.platformSignature]);
    const pem = platform?.kid ? this.#options.platformKeys[platform.kid] : undefined;
    if (!platform?.sig || !pem) return false;
    try {
      return verifySignature(null, Buffer.from(body), createPublicKey(pem), Buffer.from(platform.sig, "base64"));
    } catch {
      return false;
    }
  }

  parseWebhook(headers: Readonly<Record<string, string>>, body: string): NormalisedWebhookEvent {
    if (!this.verifyWebhook(headers, body)) throw new Error("Invalid BitriPay webhook signature");
    const event = JSON.parse(body) as { id: string; type: string; created?: number | string; data?: { object?: BitriPayIntent & { payment_intent?: string } } };
    const object = event.data?.object;
    const state = mapEventType(event.type) ?? (object?.status ? mapIntentStatus(object.status, object.last_payment_error?.code ?? undefined) : undefined);
    if (!state || !object) throw new Error(`Unhandled BitriPay event ${event.type}`);
    const code = object.last_payment_error?.code ?? undefined;
    return {
      eventId: event.id,
      providerRef: object.payment_intent ?? object.id,
      state,
      ...(state === "FAILED" ? { reasonCode: mapErrorCode(code) } : {}),
      occurredAt: typeof event.created === "number" ? new Date(event.created * 1000) : new Date(event.created ?? Date.now()),
    };
  }

  /** Statement lines for reconciliation (§20.6), from the settlement cycles of the day. */
  async fetchStatement(date: string): Promise<readonly StatementLine[]> {
    const cycles = await this.#call("GET", PATHS.settlementCycles, undefined, {}, false, { date });
    const list = ((cycles.body as { data?: { id: string }[] })?.data ?? []) as { id: string }[];
    const lines: StatementLine[] = [];
    for (const cycle of list) {
      const res = await this.#call("GET", PATHS.settlementStatement(cycle.id), undefined, {}, false, { format: "json" });
      const items = ((res.body as { items?: StatementItem[] })?.items ?? []) as StatementItem[];
      for (const item of items) {
        lines.push({
          providerRef: item.payment_intent ?? item.reference,
          amount: { currency: item.currency, minor: String(item.amount_minor) },
          fee: { currency: item.currency, minor: String(item.fee_minor ?? 0) },
          kind: item.type === "refund" ? "REFUND" : item.type === "payout" ? "PAYOUT" : item.type === "reversal" ? "REVERSAL" : "COLLECTION",
          settledAt: new Date(item.settled_at),
        });
      }
    }
    return lines;
  }

  health(): ConnectorHealth {
    const n = this.#samples.length;
    if (n === 0) return { latencyMsP95: 0, errorRate: 0, successRate: 1 };
    const errors = this.#samples.filter((s) => !s.ok).length;
    const sorted = this.#samples.map((s) => s.ms).sort((a, b) => a - b);
    return { latencyMsP95: sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0, errorRate: errors / n, successRate: 1 - errors / n };
  }

  async #call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    movesMoney = false,
    query?: Record<string, string>,
  ): Promise<HttpResponse> {
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

interface StatementItem {
  payment_intent?: string;
  reference: string;
  amount_minor: number | string;
  fee_minor?: number | string;
  currency: string;
  type?: string;
  settled_at: string;
}

function nextAction(intent: PaymentIntent, body: BitriPayIntent, state: string): NextAction {
  if (state !== "PENDING_CUSTOMER_ACTION" && state !== "PROCESSING") return { type: "NONE" };
  if (intent.methodType === "QR" && body.qr_payload) return { type: "QR", payload: body.qr_payload };
  if (intent.methodType === "MOBILE_MONEY_PUSH" && intent.payer.msisdn) return { type: "PUSH_SENT", msisdn: intent.payer.msisdn };
  if (body.checkout_url) return { type: "REDIRECT", url: body.checkout_url };
  return { type: "NONE" };
}

/** BitriPay takes amount_minor as a JSON integer; refuse amounts JSON cannot carry exactly. */
function wireAmount(amount: MoneyJSON): number {
  const minor = Money.fromJSON(amount).minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < 0n) throw new RangeError(`Amount ${amount.minor} cannot be sent exactly to BitriPay`);
  return Number(minor);
}

function errorCodeOf(body: unknown): string | undefined {
  const b = body as { error?: { code?: string } | string; code?: string };
  return typeof b?.error === "object" ? b.error?.code : (b?.code ?? (typeof b?.error === "string" ? b.error : undefined));
}

/** Accepts "v1=<hex>", "t=<ts>,v1=<hex>", "kid=<id>,sig=<b64>" or a bare hex digest. */
function parseSignatureHeader(value: string | undefined): { t?: string; v1: string; kid?: string; sig?: string } | undefined {
  if (!value) return undefined;
  if (!value.includes("=")) return { v1: value.trim() };
  const parts = Object.fromEntries(value.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  return { v1: parts["v1"] ?? "", ...(parts["t"] ? { t: parts["t"] } : {}), ...(parts["kid"] ? { kid: parts["kid"] } : {}), ...(parts["sig"] ? { sig: parts["sig"] } : {}) };
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function lower(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
