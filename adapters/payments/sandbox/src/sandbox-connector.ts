/**
 * Sandbox PaymentConnector: a deterministic, in-memory provider used for
 * local development, orchestration tests and as the reference
 * implementation that the certification suite (§20.7) must pass.
 *
 * Outcomes are driven by `intent.metadata.sandbox_outcome`:
 *   SUCCEED (default) · ASYNC_SUCCEED · PROVIDER_UNAVAILABLE · TIMEOUT ·
 *   any customer-side reason code (INSUFFICIENT_FUNDS, CUSTOMER_DECLINED, …)
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import {
  ConnectorUnavailableError,
  PAYMENT_REASON_CODES,
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

interface SandboxPayment {
  providerRef: string;
  intent: PaymentIntent;
  state: PaymentState;
  reasonCode?: PaymentReasonCode;
  refunded: bigint;
  settledAt?: Date;
  refunds: Map<string, RefundResult & { amount: MoneyJSON }>;
}

export interface SandboxOptions {
  id?: string;
  capabilities: readonly ConnectorCapability[];
  webhookSecret?: string;
  /** Simulates the provider being down: `initiate` throws before sending. */
  unreachable?: boolean;
  now?: () => Date;
}

const SIGNATURE_HEADER = "x-sandbox-signature";

export class SandboxConnector implements PaymentConnector {
  readonly id: string;
  readonly version = "0.1.0";
  unreachable: boolean;
  readonly #capabilities: readonly ConnectorCapability[];
  readonly #secret: string;
  readonly #now: () => Date;
  readonly #payments = new Map<string, SandboxPayment>();
  readonly #byIdempotencyKey = new Map<string, string>();
  #calls = 0;
  #failures = 0;

  constructor(options: SandboxOptions) {
    this.id = options.id ?? "sandbox";
    this.#capabilities = options.capabilities;
    this.#secret = options.webhookSecret ?? "sandbox-secret";
    this.unreachable = options.unreachable ?? false;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly ConnectorCapability[] {
    return this.#capabilities;
  }

  async initiate(intent: PaymentIntent): Promise<InitiateResult> {
    this.#calls += 1;
    if (this.unreachable) {
      this.#failures += 1;
      throw new ConnectorUnavailableError(this.id);
    }

    // Idempotency: a repeated key returns the original payment, never a new charge.
    const existingRef = this.#byIdempotencyKey.get(intent.idempotencyKey);
    if (existingRef) return this.#toInitiateResult(this.#mustGet(existingRef));

    const outcome = intent.metadata?.["sandbox_outcome"] ?? "SUCCEED";
    const payment: SandboxPayment = {
      providerRef: `sbx_${randomUUID()}`,
      intent,
      state: "SUCCEEDED",
      refunded: 0n,
      refunds: new Map(),
    };
    if (outcome === "SUCCEED") payment.settledAt = this.#now();
    else if (outcome === "ASYNC_SUCCEED") payment.state = "PENDING_CUSTOMER_ACTION";
    else if ((PAYMENT_REASON_CODES as readonly string[]).includes(outcome)) {
      payment.state = "FAILED";
      payment.reasonCode = outcome as PaymentReasonCode;
      if (outcome === "PROVIDER_UNAVAILABLE" || outcome === "TIMEOUT") this.#failures += 1;
    } else {
      throw new TypeError(`Unknown sandbox_outcome "${outcome}"`);
    }

    this.#payments.set(payment.providerRef, payment);
    this.#byIdempotencyKey.set(intent.idempotencyKey, payment.providerRef);
    return this.#toInitiateResult(payment);
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const p = this.#mustGet(providerRef);
    return { providerRef, state: p.state, ...(p.reasonCode ? { reasonCode: p.reasonCode, providerCode: `SBX_${p.reasonCode}` } : {}) };
  }

  async refund(providerRef: string, amount: MoneyJSON, idempotencyKey: string): Promise<RefundResult> {
    const p = this.#mustGet(providerRef);
    const previous = p.refunds.get(idempotencyKey);
    if (previous) return { refundRef: previous.refundRef, state: previous.state };

    const paid = Money.fromJSON(p.intent.amount);
    const requested = Money.fromJSON(amount);
    const refundable = paid.minor - p.refunded;
    let result: RefundResult;
    if (!(p.state === "SUCCEEDED" || p.state === "PARTIALLY_REFUNDED")) {
      result = { refundRef: `sbr_${randomUUID()}`, state: "FAILED", reasonCode: "UNKNOWN" };
    } else if (requested.currency !== paid.currency) {
      result = { refundRef: `sbr_${randomUUID()}`, state: "FAILED", reasonCode: "CURRENCY_NOT_SUPPORTED" };
    } else if (requested.minor <= 0n || requested.minor > refundable) {
      result = { refundRef: `sbr_${randomUUID()}`, state: "FAILED", reasonCode: "LIMIT_EXCEEDED" };
    } else {
      p.refunded += requested.minor;
      p.state = p.refunded === paid.minor ? "REFUNDED" : "PARTIALLY_REFUNDED";
      result = { refundRef: `sbr_${randomUUID()}`, state: "SUCCEEDED" };
    }
    p.refunds.set(idempotencyKey, { ...result, amount });
    return result;
  }

  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): boolean {
    const given = headers[SIGNATURE_HEADER];
    if (!given) return false;
    const expected = this.#sign(body);
    const a = Buffer.from(given, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(headers: Readonly<Record<string, string>>, body: string): NormalisedWebhookEvent {
    if (!this.verifyWebhook(headers, body)) throw new Error("Invalid webhook signature");
    const raw = JSON.parse(body) as { event_id: string; provider_ref: string; state: PaymentState; reason?: PaymentReasonCode; at: string };
    return {
      eventId: raw.event_id,
      providerRef: raw.provider_ref,
      state: raw.state,
      ...(raw.reason ? { reasonCode: raw.reason } : {}),
      occurredAt: new Date(raw.at),
    };
  }

  async fetchStatement(date: string): Promise<readonly StatementLine[]> {
    const lines: StatementLine[] = [];
    for (const p of this.#payments.values()) {
      if (!p.settledAt || p.settledAt.toISOString().slice(0, 10) !== date) continue;
      const fee = feeFor(p.intent.amount, this.#capabilityFor(p.intent)?.fees.percentBps ?? 0);
      lines.push({ providerRef: p.providerRef, amount: p.intent.amount, fee, kind: "COLLECTION", settledAt: p.settledAt });
    }
    return lines;
  }

  health(): ConnectorHealth {
    const errorRate = this.#calls === 0 ? 0 : this.#failures / this.#calls;
    return { latencyMsP95: 50, errorRate, successRate: 1 - errorRate };
  }

  // --- Sandbox controls (not part of the port) -----------------------------

  /** Completes an async payment as the customer would, and returns the signed webhook the provider would send. */
  completeAsync(providerRef: string, outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED", reason?: PaymentReasonCode) {
    const p = this.#mustGet(providerRef);
    p.state = outcome;
    if (outcome === "SUCCEEDED") p.settledAt = this.#now();
    if (reason) p.reasonCode = reason;
    return this.signedWebhook({ event_id: `evt_${randomUUID()}`, provider_ref: providerRef, state: outcome, ...(reason ? { reason } : {}), at: this.#now().toISOString() });
  }

  signedWebhook(payload: Record<string, unknown>): { headers: Record<string, string>; body: string } {
    const body = JSON.stringify(payload);
    return { headers: { [SIGNATURE_HEADER]: this.#sign(body) }, body };
  }

  #sign(body: string): string {
    return createHmac("sha256", this.#secret).update(body).digest("hex");
  }

  #capabilityFor(intent: PaymentIntent): ConnectorCapability | undefined {
    return this.#capabilities.find((c) => c.methodType === intent.methodType && c.currencies.includes(intent.amount.currency));
  }

  #mustGet(providerRef: string): SandboxPayment {
    const p = this.#payments.get(providerRef);
    if (!p) throw new Error(`Unknown provider reference ${providerRef}`);
    return p;
  }

  #toInitiateResult(p: SandboxPayment): InitiateResult {
    const msisdn = p.intent.payer.msisdn ?? "";
    return {
      providerRef: p.providerRef,
      state: p.state,
      nextAction: p.state === "PENDING_CUSTOMER_ACTION" ? { type: "PUSH_SENT", msisdn } : { type: "NONE" },
      ...(p.state === "PENDING_CUSTOMER_ACTION" ? { expiresAt: new Date(this.#now().getTime() + 5 * 60_000) } : {}),
      ...(p.reasonCode ? { reasonCode: p.reasonCode } : {}),
    };
  }
}

function feeFor(amount: MoneyJSON, percentBps: number): MoneyJSON {
  return Money.fromJSON(amount).multiply({ numerator: BigInt(percentBps), denominator: 10_000n }, "half-up").toJSON();
}
