/**
 * Payment Orchestration contracts (PRD §20). Business logic never talks to a
 * provider directly: it talks to this port, and every provider — BitriPay or
 * a direct connector — implements it.
 */
import type { MoneyJSON } from "@tunakula/ts-money";

/** PRD §20.1 payment method taxonomy. */
export const PAYMENT_METHOD_TYPES = [
  "MOBILE_MONEY_PUSH",
  "MOBILE_MONEY_REDIRECT",
  "QR",
  "USSD",
  "BANK_TRANSFER",
  "CARD",
  "WALLET_TOKEN",
  "VOUCHER",
  "TUNAKULA_WALLET",
  "CASH_ON_DELIVERY",
  "AGENT_CASH_IN",
  "EMPLOYER_ALLOWANCE",
] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/** PRD §20.3 normalised payment states. */
export const PAYMENT_STATES = [
  "CREATED",
  "PENDING_CUSTOMER_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "REVERSED",
  "DISPUTED",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** States from which a payment can still succeed without a new attempt. */
export const IN_FLIGHT_STATES: readonly PaymentState[] = ["CREATED", "PENDING_CUSTOMER_ACTION", "PROCESSING"];
/** Terminal failures: safe to fall back to another route. */
export const FAILED_STATES: readonly PaymentState[] = ["FAILED", "EXPIRED", "CANCELLED"];

/**
 * Common reason-code catalogue (PRD §20.3). Provider codes are mapped into
 * these so apps, agents and analytics behave the same in every market.
 */
export const PAYMENT_REASON_CODES = [
  "INSUFFICIENT_FUNDS",
  "CUSTOMER_DECLINED",
  "TIMEOUT",
  "LIMIT_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_ACCOUNT",
  "AUTHENTICATION_FAILED",
  "FRAUD_SUSPECTED",
  "CURRENCY_NOT_SUPPORTED",
  "DUPLICATE",
  "UNKNOWN",
] as const;
export type PaymentReasonCode = (typeof PAYMENT_REASON_CODES)[number];

/**
 * Reasons that say nothing about the customer — the route failed, not the
 * payer — so orchestration may try the next eligible connector (§20.4).
 */
export const ROUTE_FAILURE_REASONS: readonly PaymentReasonCode[] = ["PROVIDER_UNAVAILABLE", "TIMEOUT", "CURRENCY_NOT_SUPPORTED"];

export type NextAction =
  | { readonly type: "REDIRECT"; readonly url: string }
  | { readonly type: "PUSH_SENT"; readonly msisdn: string }
  | { readonly type: "USSD_CODE"; readonly code: string }
  | { readonly type: "BANK_DETAILS"; readonly accountNumber: string; readonly bankName: string; readonly reference: string }
  | { readonly type: "QR"; readonly payload: string }
  | { readonly type: "NONE" };

export interface AmountLimit {
  /** Major-unit decimal strings, interpreted in `currency`. */
  readonly currency: string;
  readonly min?: string;
  readonly max?: string;
}

/** One line of `capabilities()` (PRD §20.2). */
export interface ConnectorCapability {
  readonly methodType: PaymentMethodType;
  /** ISO 3166-1 alpha-2 codes of payer markets served. */
  readonly countries: readonly string[];
  readonly currencies: readonly string[];
  readonly limits: readonly AmountLimit[];
  readonly flow: "SYNC" | "ASYNC";
  readonly refund: "FULL" | "PARTIAL" | "NONE";
  readonly payout: boolean;
  readonly settlement: { readonly currency: string; readonly delayDays: number };
  /** Indicative cost, used for ranking. */
  readonly fees: { readonly percentBps: number; readonly fixed?: MoneyJSON };
}

export interface PaymentIntent {
  readonly id: string;
  /** Unique per logical payment; the same key must never charge twice. */
  readonly idempotencyKey: string;
  readonly amount: MoneyJSON;
  readonly methodType: PaymentMethodType;
  /** Payer's market. May differ from the order's market (cross-border). */
  readonly payerCountry: string;
  /** Order's market — the Country Profile that governs routing. */
  readonly marketCountry: string;
  readonly payer: { readonly msisdn?: string; readonly email?: string; readonly token?: string };
  readonly description: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface InitiateResult {
  readonly providerRef: string;
  readonly state: PaymentState;
  readonly nextAction: NextAction;
  readonly expiresAt?: Date;
  readonly reasonCode?: PaymentReasonCode;
}

export interface StatusResult {
  readonly providerRef: string;
  readonly state: PaymentState;
  readonly reasonCode?: PaymentReasonCode;
  /** Provider's own code, kept for audit next to the normalised one. */
  readonly providerCode?: string;
}

export interface RefundResult {
  readonly refundRef: string;
  readonly state: "PENDING" | "SUCCEEDED" | "FAILED";
  readonly reasonCode?: PaymentReasonCode;
}

export interface NormalisedWebhookEvent {
  readonly eventId: string;
  readonly providerRef: string;
  readonly state: PaymentState;
  readonly reasonCode?: PaymentReasonCode;
  readonly occurredAt: Date;
}

export interface StatementLine {
  readonly providerRef: string;
  readonly amount: MoneyJSON;
  readonly fee: MoneyJSON;
  readonly kind: "COLLECTION" | "REFUND" | "PAYOUT" | "REVERSAL";
  readonly settledAt: Date;
}

export interface ConnectorHealth {
  readonly latencyMsP95: number;
  /** 0–1, rolling window. */
  readonly errorRate: number;
  /** 0–1, rolling window. */
  readonly successRate: number;
}

/** The PaymentConnector port (PRD §7.3, §20.2). */
export interface PaymentConnector {
  readonly id: string;
  readonly version: string;
  capabilities(): readonly ConnectorCapability[];
  initiate(intent: PaymentIntent): Promise<InitiateResult>;
  getStatus(providerRef: string): Promise<StatusResult>;
  refund(providerRef: string, amount: MoneyJSON, idempotencyKey: string): Promise<RefundResult>;
  verifyWebhook(headers: Readonly<Record<string, string>>, body: string): boolean;
  parseWebhook(headers: Readonly<Record<string, string>>, body: string): NormalisedWebhookEvent;
  fetchStatement(date: string): Promise<readonly StatementLine[]>;
  health(): ConnectorHealth;
}

export interface Beneficiary {
  readonly id: string;
  readonly kind: "RESTAURANT" | "RIDER" | "FLEET";
  readonly rail: string;
  readonly account: string;
  readonly country: string;
}

/** The PayoutConnector port (PRD §20.8). */
export interface PayoutConnector {
  readonly id: string;
  payout(beneficiary: Beneficiary, amount: MoneyJSON, idempotencyKey: string): Promise<{ payoutRef: string; state: "PENDING" | "SENT" | "FAILED"; reasonCode?: PaymentReasonCode }>;
}
