/**
 * Everything Stripe-specific about names and codes lives here.
 *
 * Source: Stripe API reference (PaymentIntents, Refunds, webhook events, the
 * Stripe-Signature scheme) as of 2026-10. Items marked VERIFY are wire details
 * to confirm against https://stripe.com/docs/api before go-live — above all the
 * request encoding: Stripe accepts application/x-www-form-urlencoded, while this
 * adapter speaks JSON through the shared transport, so a thin form-encoding shim
 * (or Stripe's own SDK) is the one change needed to point it at the real API.
 * They are isolated here so that correction is a one-line change.
 */
import type { PaymentReasonCode, PaymentState } from "@tunakula/ts-contracts";

export const STRIPE_BASE_URL = "https://api.stripe.com/v1";

export const PATHS = {
  paymentIntents: "/payment_intents",
  paymentIntent: (id: string) => `/payment_intents/${encodeURIComponent(id)}`,
  refunds: "/refunds",
  balanceTransactions: "/balance_transactions",
} as const;

export const HEADERS = {
  idempotency: "Idempotency-Key",
  /** HMAC-SHA256 of "<t>.<raw body>" with the endpoint signing secret (whsec_…). */
  signature: "stripe-signature",
} as const;

/**
 * Stripe PaymentIntent status → Tunakula normalised state (PRD §20.3). A card
 * intent waiting on 3-D Secure is `requires_action`; a declined one lands back
 * at `requires_payment_method` with a `last_payment_error`.
 */
export function mapIntentStatus(status: string, lastErrorCode?: string): PaymentState {
  switch (status.toLowerCase()) {
    case "requires_payment_method":
      return lastErrorCode ? "FAILED" : "PENDING_CUSTOMER_ACTION";
    case "requires_confirmation":
    case "requires_action":
      return "PENDING_CUSTOMER_ACTION";
    case "processing":
      return "PROCESSING";
    case "succeeded":
      return "SUCCEEDED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "refunded":
      return "REFUNDED";
    case "canceled":
    case "cancelled":
      return "CANCELLED";
    case "disputed":
      return "DISPUTED";
    default:
      // Unknown statuses stay in flight: never assume failure (which would allow a re-route).
      return "PROCESSING";
  }
}

/** Stripe decline/error codes → reason catalogue (PRD §20.3). */
export function mapErrorCode(code: string | undefined): PaymentReasonCode {
  switch (code) {
    case "card_declined":
    case "generic_decline":
      return "CUSTOMER_DECLINED";
    case "insufficient_funds":
      return "INSUFFICIENT_FUNDS";
    case "expired_card":
    case "incorrect_number":
    case "invalid_account":
    case "incorrect_cvc":
      return "INVALID_ACCOUNT";
    case "authentication_required":
    case "authentication_failure":
      return "AUTHENTICATION_FAILED";
    case "fraudulent":
      return "FRAUD_SUSPECTED";
    case "card_velocity_exceeded":
    case "amount_too_large":
    case "charge_exceeds_source_limit":
    case "amount_exceeds_refundable":
      return "LIMIT_EXCEEDED";
    case "processing_error":
    case "api_connection_error":
      return "PROVIDER_UNAVAILABLE";
    case "timeout":
      return "TIMEOUT";
    case "idempotency_error":
    case "duplicate":
      return "DUPLICATE";
    case "currency_not_supported":
      return "CURRENCY_NOT_SUPPORTED";
    default:
      return "UNKNOWN";
  }
}

/** Webhook event type → state (Stripe's documented events). */
export function mapEventType(type: string): PaymentState | undefined {
  switch (type) {
    case "payment_intent.succeeded":
      return "SUCCEEDED";
    case "payment_intent.processing":
      return "PROCESSING";
    case "payment_intent.payment_failed":
      return "FAILED";
    case "payment_intent.canceled":
      return "CANCELLED";
    case "charge.refunded":
      // Stripe fires one charge.refunded for both partial and full; the object's amount_refunded decides which.
      return undefined;
    case "charge.dispute.created":
      return "DISPUTED";
    default:
      return undefined;
  }
}

export function mapRefundStatus(status: string): "PENDING" | "SUCCEEDED" | "FAILED" {
  switch (status.toLowerCase()) {
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
    case "canceled":
    case "cancelled":
      return "FAILED";
    default:
      return "PENDING";
  }
}
