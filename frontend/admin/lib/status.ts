/** Status pills: colour + label, never colour alone (good / warning / critical / info). */
export const stateTone = (s: string) =>
  ["DELIVERED", "REFUND_REQUESTED", "SUCCEEDED"].includes(s) ? "good"
    : ["CANCELLED", "REJECTED", "DELIVERY_FAILED", "EXPIRED", "PAYMENT_FAILED", "FAILED"].includes(s) ? "critical"
    : ["DRAFT", "PENDING_PAYMENT", "PENDING_CUSTOMER_ACTION", "PROCESSING"].includes(s) ? "warning" : "info";
