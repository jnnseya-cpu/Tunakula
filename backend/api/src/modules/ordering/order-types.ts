/** Order aggregate types (PRD §10, §11, §21 `order`). */
import type { MoneyJSON } from "@tunakula/ts-money";

export const ORDER_STATES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAYMENT_FAILED",
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "PACKED",
  "READY",
  "PICKED_UP",
  "DELIVERED",
  "REFUND_REQUESTED",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "DELIVERY_FAILED",
  "REFUNDED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/**
 * PRD §10.1 transition table. Additions beyond the table, each documented in
 * ADR 0004: PAYMENT_FAILED → PENDING_PAYMENT (retry another method, §20.4),
 * DRAFT → PLACED (cash on delivery skips PENDING_PAYMENT), READY → DELIVERED
 * (takeaway/dine-in skip rider states), REFUND_REQUESTED → REFUNDED | DELIVERED.
 */
export const TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  DRAFT: ["PENDING_PAYMENT", "PLACED", "EXPIRED"],
  PENDING_PAYMENT: ["PLACED", "PAYMENT_FAILED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT"],
  PLACED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["PACKED"],
  PACKED: ["READY"],
  READY: ["PICKED_UP", "DELIVERED"],
  PICKED_UP: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERED: ["REFUND_REQUESTED"],
  REFUND_REQUESTED: ["REFUNDED", "DELIVERED"],
  EXPIRED: [],
  REJECTED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  DELIVERY_FAILED: ["REFUNDED"],
  REFUNDED: [],
};

export type OrderType = "DELIVERY" | "TAKEAWAY" | "DINE_IN" | "SCHEDULED" | "XBO";
/** Order types fulfilled by a rider (go through PICKED_UP). */
export const RIDER_ORDER_TYPES: readonly OrderType[] = ["DELIVERY", "SCHEDULED", "XBO"];

export interface Actor {
  readonly kind: "CUSTOMER" | "RESTAURANT" | "RIDER" | "SUPPORT" | "AGENT" | "SYSTEM";
  readonly id: string;
}

export interface OrderLine {
  readonly id: string;
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly options: readonly string[];
  /** Structured allergen/dietary requirements (§11.7). Notes never carry these. */
  readonly allergenFlags: readonly string[];
  readonly note?: string;
}

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** The confirm-before-pay snapshot (§11.2) that becomes the order record. */
export const ORDER_CHANNELS = ["ONLINE", "POS", "HUB"] as const;
/** §12: channel is an attribute of an order, never a separate system. */
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export interface OrderSnapshot {
  readonly orderId: string;
  readonly type: OrderType;
  readonly channel: OrderChannel;
  /** In-store device that took the order (POS or hub), §12.2. */
  readonly deviceId?: string;
  readonly staffId?: string;
  readonly tableId?: string;
  readonly country: string;
  readonly brandId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly recipient?: { readonly name: string; readonly phone: string };
  readonly gifted: boolean;
  readonly lines: readonly OrderLine[];
  /** Total in the order currency (minor units). */
  readonly total: MoneyJSON;
  /** MR-3: every order records price, order, settlement and reporting currencies. */
  readonly currencies: { readonly price: string; readonly order: string; readonly settlement: string; readonly reporting: string };
  readonly fxQuoteId?: string;
  /** §21 order.money: every priced component, in minor units, as accepted by the customer. */
  readonly money?: {
    readonly goods: MoneyJSON;
    readonly serviceCharge: MoneyJSON;
    readonly deliveryFee: MoneyJSON;
    readonly merchantDeliveryContribution: MoneyJSON;
    readonly riderShare: MoneyJSON;
    readonly platformDeliveryShare: MoneyJSON;
    readonly tip: MoneyJSON;
    readonly merchantReceives: MoneyJSON;
    readonly riderReceives: MoneyJSON;
    readonly platformReceives: MoneyJSON;
  };
  readonly paymentMode: "PREPAID" | "CASH_ON_DELIVERY";
  /** As configured (§10.2); AGENT_OPTIMISED must be resolved at placement. */
  readonly configuredConfirmationModel: "RESTAURANT_FIRST" | "RIDER_FIRST" | "AGENT_OPTIMISED";
  readonly confirmationModel: "RESTAURANT_FIRST" | "RIDER_FIRST";
  readonly highValue: boolean;
  readonly contactlessRequested: boolean;
  /** SHA-256 hex of the recipient's one-time code; the code itself is never stored. */
  readonly recipientCodeHash: string;
  readonly dropLocation?: GeoPoint;
  /** Directions for the rider ("blue gate opposite the pharmacy"). Free text: never allergen or payment data. */
  readonly deliveryNote?: string;
  readonly geofenceRadiusM: number;
}

export type Gate = "PLACEMENT" | "PACK" | "PICKUP" | "DROP";

/** A step that could not be verified, recorded with a reason (§11 governing rule). */
export interface IntegrityException {
  readonly gate: Gate;
  readonly code: "SEAL_MISSING" | "PACKAGE_COUNT_SHORT" | "SEAL_BROKEN" | "OUTSIDE_GEOFENCE" | "DEGRADED_VERIFICATION";
  readonly reason: string;
}

export type RecipientVerification =
  | { readonly method: "CODE"; readonly code: string }
  | { readonly method: "CONFIRM_BUTTON" }
  | { readonly method: "SIGNATURE"; readonly signatureRef: string }
  | { readonly method: "CONTACTLESS_PHOTO"; readonly photoRef: string };

export const FAILED_DELIVERY_REASONS = ["NOBODY_PRESENT", "ADDRESS_WRONG", "REFUSED", "UNSAFE", "WRONG_RECIPIENT"] as const;
export type FailedDeliveryReason = (typeof FAILED_DELIVERY_REASONS)[number];

/** Evidence captured on a transition; the §11.9 bundle is a projection of these. */
export interface Evidence {
  readonly paymentIntentId?: string;
  readonly confirmedLineIds?: readonly string[];
  readonly allergenAcknowledged?: boolean;
  readonly packageCount?: number;
  readonly labelIds?: readonly string[];
  readonly sealIds?: readonly string[];
  readonly packPhotoRef?: string;
  readonly scannedLabelIds?: readonly string[];
  readonly location?: GeoPoint;
  readonly distanceM?: number;
  readonly verificationMethod?: RecipientVerification["method"];
  readonly proofPhotoRef?: string;
  readonly evidenceRefs?: readonly string[];
  readonly exceptions?: readonly IntegrityException[];
}

interface EventBase {
  readonly orderId: string;
  /** 1-based position in the order's stream. */
  readonly seq: number;
  readonly commandId: string;
  readonly at: Date;
  readonly actor: Actor;
}

export type OrderEvent =
  | (EventBase & { readonly type: "ORDER_DRAFTED"; readonly snapshot: OrderSnapshot })
  | (EventBase & {
      readonly type: "STATE_CHANGED";
      readonly from: OrderState;
      readonly to: OrderState;
      readonly reasonCode?: string;
      readonly evidence: Evidence;
    })
  | (EventBase & { readonly type: "RIDER_ASSIGNED"; readonly riderId: string })
  | (EventBase & { readonly type: "CANCELLATION_ACKNOWLEDGED" });
