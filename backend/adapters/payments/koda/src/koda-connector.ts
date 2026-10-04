/**
 * KODA connector: the customer pays the operator, then submits the reference
 * from the operator SMS; KODA matches it against the Sentinel SIM ledger,
 * scores it and fires a signed `payment.verified` webhook. Verification-only:
 * KODA does not move refunds or payouts, so those are refused honestly.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchTransport, classifyStatus, type HttpResponse, type HttpTransport } from "@tunakula/payment-http";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import {
  ConnectorOutcomeUnknownError,
  type ConnectorCapability,
  type ConnectorHealth,
  type InitiateResult,
  type NormalisedWebhookEvent,
  type PaymentConnector,
  type PaymentIntent,
  type PaymentReasonCode,
  type PaymentState,
  type RefundResult,
  type StatementLine,
  type StatusResult,
} from "@tunakula/ts-contracts";
import { DEFAULT_OPERATORS, KODA_BASE_URL, PATHS, SIGNATURE_HEADER, mapEventType, mapIntentStatus, mapVerifyError } from "./mapping.ts";

/**
 * KODA's documentation does not describe an Idempotency-Key, so the connector
 * guarantees "same key → same intent" itself. Production backs this with
 * PostgreSQL (unique idempotency_key, §21); the default is in-memory.
 */
export interface IdempotencyStore {
  get(key: string): Promise<InitiateResult | undefined>;
  put(key: string, result: InitiateResult): Promise<void>;
}

export function memoryIdempotencyStore(): IdempotencyStore {
  const map = new Map<string, InitiateResult>();
  return { get: async (k) => map.get(k), put: async (k, v) => void map.set(k, v) };
}

export interface KodaOptions {
  readonly id?: string;
  /** sk_test_… or sk_live_… (secret, server side only). */
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly capabilities: readonly ConnectorCapability[];
  readonly operatorsByCountry?: Readonly<Record<string, readonly string[]>>;
  /** Where the hosted checkout returns the customer (deep link into the app or web order page). */
  readonly successUrlFor?: (intent: PaymentIntent) => string;
  readonly baseUrl?: string;
  readonly transport?: HttpTransport;
  readonly idempotency?: IdempotencyStore;
}

export class KodaConnector implements PaymentConnector {
  readonly id: string;
  readonly version = "0.1.0";
  readonly #options: KodaOptions;
  readonly #http: HttpTransport;
  readonly #samples: { ok: boolean; ms: number }[] = [];
  readonly #idempotency: IdempotencyStore;

  constructor(options: KodaOptions) {
    if (!/^sk_(test|live)_/.test(options.apiKey)) throw new TypeError("KODA needs a secret (sk_) key; pk_ keys belong in the browser only");
    if (!options.webhookSecret) throw new TypeError("KODA webhook secret is required");
    this.id = options.id ?? "koda";
    this.#options = options;
    this.#http = options.transport ?? fetchTransport({ connectorId: this.id, baseUrl: options.baseUrl ?? KODA_BASE_URL });
    this.#idempotency = options.idempotency ?? memoryIdempotencyStore();
  }

  capabilities(): readonly ConnectorCapability[] {
    return this.#options.capabilities;
  }

  async initiate(intent: PaymentIntent): Promise<InitiateResult> {
    const previous = await this.#idempotency.get(intent.idempotencyKey);
    if (previous) {
      // Same key → same intent; refresh its state rather than creating another.
      if (previous.providerRef.startsWith("rejected:")) return previous;
      return { ...previous, state: (await this.getStatus(previous.providerRef)).state };
    }
    const result = await this.#create(intent);
    await this.#idempotency.put(intent.idempotencyKey, result);
    return result;
  }

  async #create(intent: PaymentIntent): Promise<InitiateResult> {
    const operators = (this.#options.operatorsByCountry ?? DEFAULT_OPERATORS)[intent.payerCountry];
    const successUrl = this.#options.successUrlFor?.(intent);
    const res = await this.#call(
      "POST",
      PATHS.intents,
      {
        amount: wireAmount(intent.amount),
        currency: intent.amount.currency,
        ...(operators ? { operators } : {}),
        metadata: { ...intent.metadata, order_id: intent.metadata?.["order_id"] ?? intent.id, tunakula_intent_id: intent.id },
        ...(successUrl ? { success_url: successUrl } : {}),
      },
      { "Idempotency-Key": intent.idempotencyKey },
      true,
    );
    if (res.status >= 400) {
      return { providerRef: `rejected:${intent.idempotencyKey}`, state: "FAILED", nextAction: { type: "NONE" }, reasonCode: res.status === 402 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN" };
    }
    const body = res.body as { intent_id: string; checkout_url?: string; status?: string; expires_at?: string };
    return {
      providerRef: body.intent_id,
      state: body.status ? mapIntentStatus(body.status) : "PENDING_CUSTOMER_ACTION",
      nextAction: body.checkout_url ? { type: "REDIRECT", url: body.checkout_url } : { type: "NONE" },
      ...(body.expires_at ? { expiresAt: new Date(body.expires_at) } : {}),
    };
  }

  /** Server-side submission of the customer's SMS reference (in-app flow without the hosted page). */
  async submitReference(providerRef: string, reference: string): Promise<{ state: PaymentState; reasonCode?: PaymentReasonCode }> {
    const res = await this.#call("POST", PATHS.verify(providerRef), { reference }, {}, true);
    if (res.status >= 400) {
      const mapped = mapVerifyError(errorCodeOf(res.body));
      return { state: mapped.state, ...(mapped.reason ? { reasonCode: mapped.reason } : {}) };
    }
    return { state: mapIntentStatus((res.body as { status?: string }).status ?? "verifying") };
  }

  async cancel(providerRef: string): Promise<PaymentState> {
    const res = await this.#call("POST", PATHS.cancel(providerRef), {}, {}, true);
    return res.status < 400 ? "CANCELLED" : (await this.getStatus(providerRef)).state;
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const res = await this.#call("GET", PATHS.intent(providerRef));
    if (res.status >= 400) throw new Error(`KODA could not read ${providerRef}: HTTP ${res.status}`);
    const body = res.body as { status: string };
    return { providerRef, state: mapIntentStatus(body.status), providerCode: body.status };
  }

  /** KODA verifies payments; it does not move money back. Refunds go through a rail that can (e.g. BitriPay or wallet credit). */
  async refund(providerRef: string): Promise<RefundResult> {
    return { refundRef: `unsupported:${providerRef}`, state: "FAILED", reasonCode: "NOT_SUPPORTED" };
  }

  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): boolean {
    const given = Object.entries(headers).find(([k]) => k.toLowerCase() === SIGNATURE_HEADER)?.[1];
    if (!given) return false;
    const expected = createHmac("sha256", this.#options.webhookSecret).update(body).digest("hex");
    const a = Buffer.from(given.replace(/^sha256=/, ""), "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(headers: Readonly<Record<string, string>>, body: string): NormalisedWebhookEvent {
    if (!this.verifyWebhook(headers, body)) throw new Error("Invalid KODA webhook signature");
    const event = JSON.parse(body) as { id: string; type: string; created_at?: string; data: { intent_id: string; status?: string } };
    const state = mapEventType(event.type) ?? (event.data.status ? mapIntentStatus(event.data.status) : undefined);
    if (!state) throw new Error(`Unhandled KODA event ${event.type}`);
    return { eventId: event.id, providerRef: event.data.intent_id, state, occurredAt: new Date(event.created_at ?? Date.now()) };
  }

  /** Verified-payments ledger for reconciliation (§20.6). VERIFY: filter parameter names. */
  async fetchStatement(date: string): Promise<readonly StatementLine[]> {
    const res = await this.#call("GET", PATHS.receipts, undefined, {}, false, { from: date, to: date });
    const receipts = ((res.body as { data?: Receipt[] })?.data ?? []) as Receipt[];
    return receipts.map((r) => ({
      providerRef: r.intent_id,
      amount: { currency: r.currency, minor: String(r.amount) },
      fee: { currency: r.currency, minor: String(r.fee ?? 0) },
      kind: "COLLECTION",
      settledAt: new Date(r.verified_at),
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
      const res = await this.#http({ method, path, headers: { Authorization: `Bearer ${this.#options.apiKey}`, ...headers }, ...(body !== undefined ? { body } : {}), ...(query ? { query } : {}) });
      if (movesMoney) classifyStatus(this.id, res);
      else if (res.status >= 500) throw new ConnectorOutcomeUnknownError(this.id, `HTTP ${res.status}`);
      ok = res.status < 500 && res.status !== 429;
      return res;
    } finally {
      this.#samples.push({ ok, ms: Date.now() - started });
      if (this.#samples.length > 200) this.#samples.shift();
    }
  }
}

interface Receipt {
  intent_id: string;
  amount: number | string;
  currency: string;
  fee?: number | string;
  verified_at: string;
}

/** KODA takes an integer in the currency's minor unit (documented: "the same convention as Stripe"). */
function wireAmount(amount: MoneyJSON): number {
  const minor = Money.fromJSON(amount).minor;
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`Amount ${amount.minor} cannot be sent exactly to KODA`);
  return Number(minor);
}

function errorCodeOf(body: unknown): string | undefined {
  const b = body as { error?: { code?: string } | string; code?: string };
  return typeof b?.error === "object" ? b.error?.code : (b?.code ?? (typeof b?.error === "string" ? b.error : undefined));
}
