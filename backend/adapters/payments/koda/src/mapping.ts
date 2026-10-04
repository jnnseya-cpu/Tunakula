/**
 * Everything KODA-specific about names and codes lives here.
 *
 * Source: KODA developer documentation as provided on 2026-10-04. Items marked
 * VERIFY are not spelled out there and must be checked against
 * https://kodajnn.com/v1/openapi.json before go-live (the host was not
 * reachable from the build environment).
 */
import type { PaymentReasonCode, PaymentState } from "@tunakula/ts-contracts";

export const KODA_BASE_URL = "https://kodajnn.com/v1";

export const PATHS = {
  ping: "/ping",
  intents: "/intents",
  intent: (id: string) => `/intents/${encodeURIComponent(id)}`,
  verify: (id: string) => `/intents/${encodeURIComponent(id)}/verify`,
  cancel: (id: string) => `/intents/${encodeURIComponent(id)}/cancel`,
  receipts: "/receipts",
} as const;

/** HMAC-SHA256 of the raw body (documented). */
export const SIGNATURE_HEADER = "x-koda-signature";

/** Operators accepted per payer country (documented examples: orange_cd, mpesa_cd). */
export const DEFAULT_OPERATORS: Readonly<Record<string, readonly string[]>> = {
  CD: ["orange_cd", "mpesa_cd"],
};

/** VERIFY: intent status values. "Cancel an awaiting intent" documents `awaiting`. */
export function mapIntentStatus(status: string): PaymentState {
  switch (status.toLowerCase()) {
    case "awaiting":
    case "awaiting_payment":
    case "requires_verification":
    case "challenge":
      return "PENDING_CUSTOMER_ACTION";
    case "verifying":
    case "processing":
      return "PROCESSING";
    case "verified":
    case "verified_late":
    case "succeeded":
      return "SUCCEEDED";
    case "cancelled":
    case "canceled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    case "rejected":
    case "failed":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/** Documented verification errors. */
export function mapVerifyError(code: string | undefined): { state: PaymentState; reason?: PaymentReasonCode } {
  switch (code) {
    case "code_already_used":
      // A replayed SMS code: the intent stays open for the right code.
      return { state: "PENDING_CUSTOMER_ACTION", reason: "DUPLICATE" };
    case "msisdn_suffix_mismatch":
      // Challenge flow: the customer confirms the paying number.
      return { state: "PENDING_CUSTOMER_ACTION", reason: "AUTHENTICATION_FAILED" };
    case "intent_expired":
      return { state: "EXPIRED", reason: "TIMEOUT" };
    case "amount_mismatch":
      return { state: "PENDING_CUSTOMER_ACTION", reason: "LIMIT_EXCEEDED" };
    default:
      return { state: "PENDING_CUSTOMER_ACTION", reason: "UNKNOWN" };
  }
}

/** Documented webhook events: payment.verified and payment.verified.late (late success → §20.4 rule). */
export function mapEventType(type: string): PaymentState | undefined {
  switch (type) {
    case "payment.verified":
    case "payment.verified.late":
      return "SUCCEEDED";
    case "payment.cancelled":
    case "intent.cancelled":
      return "CANCELLED";
    case "intent.expired":
      return "EXPIRED";
    default:
      return undefined;
  }
}
