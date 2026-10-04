/**
 * Everything BitriPay-specific about names and codes lives here.
 *
 * Source: BitriPay developer documentation as provided on 2026-10-04 (base URL,
 * endpoints, scopes, sandbox numbers, webhook event names, error codes). Items
 * marked VERIFY are not spelled out in that documentation and must be checked
 * against https://api.bitripay.com/v1/openapi.json before go-live; they were
 * written this way so that a correction is a one-line change here.
 */
import type { PaymentReasonCode, PaymentState } from "@tunakula/ts-contracts";

export const BITRIPAY_BASE_URL = "https://api.bitripay.com/v1";

export const PATHS = {
  paymentIntents: "/payment_intents",
  paymentIntent: (id: string) => `/payment_intents/${encodeURIComponent(id)}`,
  refunds: "/refunds",
  payouts: "/payouts",
  settlementCycles: "/settlement_cycles",
  settlementStatement: (id: string) => `/settlement_cycles/${encodeURIComponent(id)}/statement`,
  status: "/status",
  keys: "/keys",
} as const;

export const HEADERS = {
  idempotency: "Idempotency-Key",
  account: "BitriPay-Account",
  /** HMAC of the endpoint secret over the raw body. */
  signature: "bitripay-signature",
  /** VERIFY: header carrying the platform Ed25519 signature and key id. */
  platformSignature: "bitripay-platform-signature",
} as const;

/** Mobile-money operators BitriPay accepts per payer country (documented: orange_cd, mpesa_cd, airtel_cd, africell_cd). */
export const DEFAULT_OPERATORS: Readonly<Record<string, readonly string[]>> = {
  CD: ["orange_cd", "mpesa_cd", "airtel_cd", "africell_cd"],
};

/** VERIFY: field carrying the payer's MSISDN on intent creation (the sandbox drives outcomes by MSISDN). */
export const PAYER_MSISDN_FIELD = "payer_msisdn";

/**
 * BitriPay intent status → Tunakula normalised state (PRD §20.3).
 * AMBIGUOUS / MANUAL_REVIEW mean "the provider outcome is unknown": they stay
 * in flight and are never re-routed (ADR 0003).
 */
export function mapIntentStatus(status: string, lastErrorCode?: string): PaymentState {
  switch (status.toUpperCase()) {
    case "REQUIRES_PAYMENT_METHOD":
      // After a failed attempt the intent returns here; without one it is simply waiting.
      return lastErrorCode ? "FAILED" : "PENDING_CUSTOMER_ACTION";
    case "REQUIRES_ACTION":
    case "PENDING":
    case "AWAITING_CONFIRMATION":
      return "PENDING_CUSTOMER_ACTION";
    case "PROCESSING":
    case "AUTHORISED":
    case "AUTHORIZED":
    case "AMBIGUOUS":
    case "MANUAL_REVIEW":
      return "PROCESSING";
    case "SUCCEEDED":
    case "CAPTURED":
    case "SETTLED":
      return "SUCCEEDED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "REFUNDED":
      return "REFUNDED";
    case "CANCELED":
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "DISPUTED":
      return "DISPUTED";
    case "REVERSED":
      return "REVERSED";
    case "FAILED":
      return "FAILED";
    default:
      // Unknown statuses are treated as in flight: never assume failure (which would allow a re-route).
      return "PROCESSING";
  }
}

/** BitriPay error codes → reason catalogue (PRD §20.3). */
export function mapErrorCode(code: string | undefined): PaymentReasonCode {
  switch (code) {
    case "invalid_msisdn":
    case "wallet_not_found":
      return "INVALID_ACCOUNT";
    case "declined":
    case "customer_declined":
      return "CUSTOMER_DECLINED";
    case "provider_unavailable":
      return "PROVIDER_UNAVAILABLE";
    case "timeout":
      return "TIMEOUT";
    case "insufficient_funds":
      return "INSUFFICIENT_FUNDS";
    case "limit_exceeded":
    case "amount_exceeds_refundable":
      return "LIMIT_EXCEEDED";
    case "duplicate":
    case "idempotency_conflict":
      return "DUPLICATE";
    case "unsupported_currency":
      return "CURRENCY_NOT_SUPPORTED";
    default:
      return "UNKNOWN";
  }
}

/** Webhook event type → state. Documented: payment_intent.succeeded, .settled, .ambiguous_hold. */
export function mapEventType(type: string): PaymentState | undefined {
  switch (type) {
    case "payment_intent.succeeded":
    case "payment_intent.settled":
      return "SUCCEEDED";
    case "payment_intent.ambiguous_hold":
      return "PROCESSING";
    case "payment_intent.payment_failed":
      return "FAILED";
    case "payment_intent.canceled":
      return "CANCELLED";
    case "payment_intent.refunded":
      return "REFUNDED";
    case "payment_intent.partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "payment_intent.disputed":
      return "DISPUTED";
    default:
      return undefined;
  }
}

export function mapRefundStatus(status: string): "PENDING" | "SUCCEEDED" | "FAILED" {
  switch (status.toUpperCase()) {
    case "SUCCEEDED":
    case "COMPLETED":
      return "SUCCEEDED";
    case "FAILED":
    case "REJECTED":
    case "CANCELED":
    case "CANCELLED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export function mapPayoutStatus(status: string): "PENDING" | "SENT" | "FAILED" {
  switch (status.toUpperCase()) {
    case "PAID":
    case "SUCCEEDED":
    case "SENT":
      return "SENT";
    case "FAILED":
    case "RETURNED":
    case "CANCELED":
    case "CANCELLED":
      return "FAILED";
    default:
      return "PENDING";
  }
}
