/**
 * Event-sourced order aggregate (PRD §9.1, §10, §11).
 *
 *   decide(state, command) → events   — validates, never mutates
 *   evolve(state, event)   → state    — pure fold used for replay
 *
 * The chain-of-custody gates (§11) are enforced here, in the core, so an
 * unverified handover cannot be recorded by any client — app, web or agent.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { Money } from "@tunakula/ts-money";
import {
  FAILED_DELIVERY_REASONS,
  RIDER_ORDER_TYPES,
  TRANSITIONS,
  type Actor,
  type Evidence,
  type FailedDeliveryReason,
  type GeoPoint,
  type IntegrityException,
  type OrderEvent,
  type OrderSnapshot,
  type OrderState,
  type RecipientVerification,
} from "./order-types.ts";

export class OrderRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderRuleError";
    this.code = code;
  }
}

export interface OrderAggregate {
  readonly snapshot: OrderSnapshot;
  readonly state: OrderState;
  readonly version: number;
  readonly riderId?: string;
  readonly packageCount?: number;
  readonly labelIds: readonly string[];
  readonly sealIds: readonly string[];
  readonly cancellationAcknowledged: boolean;
  readonly flaggedForReview: boolean;
  readonly exceptions: readonly IntegrityException[];
}

export type OrderCommand =
  | { readonly type: "CREATE_DRAFT"; readonly snapshot: OrderSnapshot }
  | { readonly type: "START_CHECKOUT" }
  | { readonly type: "CONFIRM_PAYMENT"; readonly paymentIntentId: string }
  | { readonly type: "FAIL_PAYMENT"; readonly reasonCode: string }
  | { readonly type: "PLACE_CASH_ORDER" }
  | { readonly type: "EXPIRE" }
  | { readonly type: "ASSIGN_RIDER"; readonly riderId: string }
  | { readonly type: "ACCEPT" }
  | { readonly type: "REJECT"; readonly reasonCode: string }
  | { readonly type: "CANCEL"; readonly reasonCode: string }
  | { readonly type: "ACKNOWLEDGE_CANCELLATION" }
  | { readonly type: "START_PREPARING" }
  | { readonly type: "PACK"; readonly confirmedLineIds: readonly string[]; readonly packageCount: number; readonly allergenAcknowledged: boolean }
  | {
      readonly type: "MARK_READY";
      readonly packages: readonly { readonly labelId: string; readonly sealId?: string }[];
      readonly missingSealReason?: string;
      readonly packPhotoRef: string;
    }
  | {
      readonly type: "PICK_UP";
      readonly scannedLabelIds: readonly string[];
      readonly restaurantConfirmed: boolean;
      readonly sealsIntact: boolean;
      readonly brokenSealNote?: string;
      readonly shortfallReason?: string;
      readonly location: GeoPoint;
    }
  | {
      readonly type: "DELIVER";
      /** Required for rider orders: the per-drop scan (§11.5). */
      readonly scannedLabelId?: string;
      readonly location?: GeoPoint;
      readonly outsideGeofenceReason?: string;
      readonly verification: RecipientVerification;
      readonly proofPhotoRef?: string;
      readonly sealIntact: boolean;
    }
  | { readonly type: "FAIL_DELIVERY"; readonly reason: FailedDeliveryReason; readonly evidenceRefs: readonly string[] }
  | { readonly type: "REQUEST_REFUND"; readonly reasonCode: string }
  | { readonly type: "DECLINE_REFUND"; readonly reasonCode: string }
  | { readonly type: "REFUND"; readonly reasonCode: string };

export interface CommandEnvelope {
  readonly commandId: string;
  readonly orderId: string;
  readonly actor: Actor;
  readonly at: Date;
  readonly command: OrderCommand;
}

function fail(code: string, message: string): never {
  throw new OrderRuleError(code, message);
}
const nonEmpty = (s: string | undefined): s is string => typeof s === "string" && s.trim().length > 0;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isRiderOrder(snapshot: OrderSnapshot): boolean {
  return RIDER_ORDER_TYPES.includes(snapshot.type);
}

/** §11.5: gifted, cross-border and high-value orders cannot waive the recipient code. */
export function recipientCodeMandatory(snapshot: OrderSnapshot): boolean {
  return snapshot.gifted || snapshot.type === "XBO" || snapshot.highValue;
}

/** Great-circle distance in metres (geofence only — never money). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function decide(current: OrderAggregate | undefined, env: CommandEnvelope): OrderEvent[] {
  const { command } = env;
  const base = { orderId: env.orderId, commandId: env.commandId, at: env.at, actor: env.actor };
  const seq = (current?.version ?? 0) + 1;

  if (command.type === "CREATE_DRAFT") {
    if (current) fail("ORDER_EXISTS", `Order ${env.orderId} already exists`);
    validateSnapshot(command.snapshot, env.orderId);
    return [{ ...base, seq, type: "ORDER_DRAFTED", snapshot: command.snapshot }];
  }
  if (!current) return fail("ORDER_NOT_FOUND", `Order ${env.orderId} does not exist`);

  const o = current;
  const s = o.snapshot;
  const change = (to: OrderState, evidence: Evidence = {}, reasonCode?: string): OrderEvent[] => {
    if (!TRANSITIONS[o.state].includes(to)) fail("INVALID_TRANSITION", `${o.state} → ${to} is not allowed`);
    return [{ ...base, seq, type: "STATE_CHANGED", from: o.state, to, evidence, ...(reasonCode ? { reasonCode } : {}) }];
  };

  switch (command.type) {
    case "START_CHECKOUT":
      if (s.paymentMode !== "PREPAID") fail("NOT_PREPAID", "Cash-on-delivery orders do not go through PENDING_PAYMENT");
      return change("PENDING_PAYMENT");
    case "CONFIRM_PAYMENT":
      if (!nonEmpty(command.paymentIntentId)) fail("PAYMENT_REFERENCE_REQUIRED", "A payment intent is required");
      return change("PLACED", { paymentIntentId: command.paymentIntentId });
    case "FAIL_PAYMENT":
      return change("PAYMENT_FAILED", {}, command.reasonCode);
    case "PLACE_CASH_ORDER":
      if (s.paymentMode !== "CASH_ON_DELIVERY") fail("NOT_COD", "Prepaid orders are placed by payment confirmation");
      return change("PLACED");
    case "EXPIRE":
      return change("EXPIRED", {}, "QUOTE_EXPIRED");

    case "ASSIGN_RIDER": {
      if (!isRiderOrder(s)) fail("NO_RIDER_FOR_TYPE", `${s.type} orders are not delivered by a rider`);
      const assignable: OrderState[] = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY"];
      if (!assignable.includes(o.state)) fail("INVALID_STATE", `Cannot assign a rider in ${o.state}`);
      if (!nonEmpty(command.riderId)) fail("RIDER_REQUIRED", "riderId is required");
      return [{ ...base, seq, type: "RIDER_ASSIGNED", riderId: command.riderId }];
    }

    case "ACCEPT":
      // §10.2 RIDER_FIRST: the rider is secured before the restaurant is asked.
      if (s.confirmationModel === "RIDER_FIRST" && isRiderOrder(s) && !o.riderId) {
        fail("RIDER_FIRST", "This order is RIDER_FIRST: assign a rider before the restaurant accepts");
      }
      return change("ACCEPTED");
    case "REJECT":
      return change("REJECTED", {}, command.reasonCode);
    case "CANCEL":
      if (!nonEmpty(command.reasonCode)) fail("REASON_REQUIRED", "Cancellation needs a reason code");
      return change("CANCELLED", {}, command.reasonCode);
    case "ACKNOWLEDGE_CANCELLATION":
      if (o.state !== "CANCELLED") fail("INVALID_STATE", "Only a cancelled order can be acknowledged");
      if (o.cancellationAcknowledged) return [];
      return [{ ...base, seq, type: "CANCELLATION_ACKNOWLEDGED" }];

    case "START_PREPARING":
      return change("PREPARING");

    case "PACK": {
      // Gate 2 (§11.3): every pick-list line confirmed, package count, allergen acknowledgement.
      const confirmed = new Set(command.confirmedLineIds);
      const missing = s.lines.filter((l) => !confirmed.has(l.id)).map((l) => l.id);
      if (missing.length > 0) fail("PICK_LIST_INCOMPLETE", `Unconfirmed lines: ${missing.join(", ")}`);
      const unknown = [...confirmed].filter((id) => !s.lines.some((l) => l.id === id));
      if (unknown.length > 0) fail("PICK_LIST_UNKNOWN_LINE", `Lines not on this order: ${unknown.join(", ")}`);
      if (!Number.isInteger(command.packageCount) || command.packageCount < 1) fail("PACKAGE_COUNT_REQUIRED", "At least one package");
      const flagged = s.lines.some((l) => l.allergenFlags.length > 0);
      if (flagged && !command.allergenAcknowledged) fail("ALLERGEN_ACK_REQUIRED", "Allergen requirements must be acknowledged before packing");
      return change("PACKED", {
        confirmedLineIds: [...confirmed],
        packageCount: command.packageCount,
        ...(flagged ? { allergenAcknowledged: true } : {}),
      });
    }

    case "MARK_READY": {
      const count = o.packageCount ?? 0;
      if (command.packages.length !== count) fail("LABEL_COUNT_MISMATCH", `Expected ${count} labelled packages, got ${command.packages.length}`);
      const labels = command.packages.map((p) => p.labelId);
      if (labels.some((l) => !nonEmpty(l)) || new Set(labels).size !== labels.length) fail("LABELS_INVALID", "Every package needs its own label");
      const seals = command.packages.flatMap((p) => (nonEmpty(p.sealId) ? [p.sealId] : []));
      if (new Set(seals).size !== seals.length) fail("SEALS_INVALID", "Seal IDs must be unique");
      const exceptions: IntegrityException[] = [];
      if (seals.length < count) {
        if (!nonEmpty(command.missingSealReason)) fail("SEAL_REQUIRED", "A missing seal must be recorded with a reason");
        exceptions.push({ gate: "PACK", code: "SEAL_MISSING", reason: command.missingSealReason });
      }
      if (!nonEmpty(command.packPhotoRef)) fail("PACK_PHOTO_REQUIRED", "A pack photo is required");
      return change("READY", { labelIds: labels, sealIds: seals, packPhotoRef: command.packPhotoRef, ...(exceptions.length ? { exceptions } : {}) });
    }

    case "PICK_UP": {
      // Gate 3 (§11.4): right rider, right packages, both parties attest.
      if (o.state !== "READY") fail("INVALID_STATE", `Pickup requires READY, order is ${o.state}`);
      if (!isRiderOrder(s)) fail("NO_RIDER_FOR_TYPE", `${s.type} orders are collected, not picked up by a rider`);
      if (env.actor.kind !== "RIDER" || env.actor.id !== o.riderId) fail("NOT_ASSIGNED_RIDER", "This order is not assigned to this rider");
      const foreign = command.scannedLabelIds.filter((l) => !o.labelIds.includes(l));
      if (foreign.length > 0) fail("PACKAGE_NOT_THIS_ORDER", `Package ${foreign[0]} belongs to another order`);
      if (new Set(command.scannedLabelIds).size !== command.scannedLabelIds.length) fail("DUPLICATE_SCAN", "A package was scanned twice");
      const exceptions: IntegrityException[] = [];
      if (command.scannedLabelIds.length < o.labelIds.length) {
        if (!nonEmpty(command.shortfallReason)) fail("PACKAGE_COUNT_SHORT", `Scanned ${command.scannedLabelIds.length} of ${o.labelIds.length} packages`);
        exceptions.push({ gate: "PICKUP", code: "PACKAGE_COUNT_SHORT", reason: command.shortfallReason });
      }
      if (!command.restaurantConfirmed) fail("HANDOVER_UNCONFIRMED", "The restaurant must confirm the handover");
      if (!command.sealsIntact) {
        if (!nonEmpty(command.brokenSealNote)) fail("SEAL_NOTE_REQUIRED", "Describe the broken seal");
        exceptions.push({ gate: "PICKUP", code: "SEAL_BROKEN", reason: command.brokenSealNote });
      }
      return change("PICKED_UP", {
        scannedLabelIds: command.scannedLabelIds,
        packageCount: command.scannedLabelIds.length,
        sealIds: o.sealIds,
        location: command.location,
        ...(exceptions.length ? { exceptions } : {}),
      });
    }

    case "DELIVER": {
      // Gate 4 (§11.5): delivery is the outcome of verification, not a button.
      const rider = isRiderOrder(s);
      if (rider && o.state !== "PICKED_UP") fail("INVALID_STATE", `Delivery requires PICKED_UP, order is ${o.state}`);
      if (!rider && o.state !== "READY") fail("INVALID_STATE", `Collection requires READY, order is ${o.state}`);
      const exceptions: IntegrityException[] = [];
      const evidence: { -readonly [K in keyof Evidence]: Evidence[K] } = { verificationMethod: command.verification.method };

      if (rider) {
        if (env.actor.kind !== "RIDER" || env.actor.id !== o.riderId) fail("NOT_ASSIGNED_RIDER", "Only the assigned rider can complete this drop");
        if (!command.scannedLabelId || !o.labelIds.includes(command.scannedLabelId)) {
          fail("WRONG_PACKAGE", `Package ${command.scannedLabelId ?? "(none)"} is not for this drop`);
        }
        evidence.scannedLabelIds = [command.scannedLabelId as string];
        if (!command.location) return fail("LOCATION_REQUIRED", "Drop location is required");
        evidence.location = command.location;
        if (s.dropLocation) {
          const d = Math.round(distanceMetres(command.location, s.dropLocation));
          evidence.distanceM = d;
          if (d > s.geofenceRadiusM) {
            if (!nonEmpty(command.outsideGeofenceReason)) fail("OUTSIDE_GEOFENCE", `${d} m from the drop point (limit ${s.geofenceRadiusM} m); record a reason`);
            exceptions.push({ gate: "DROP", code: "OUTSIDE_GEOFENCE", reason: command.outsideGeofenceReason as string });
          }
        }
      }

      const v = command.verification;
      const mandatory = recipientCodeMandatory(s);
      if (mandatory && v.method !== "CODE") fail("RECIPIENT_CODE_MANDATORY", "This order requires the recipient's one-time code");
      if (v.method === "CODE" && !codeMatches(v.code, s.recipientCodeHash)) fail("RECIPIENT_CODE_WRONG", "The recipient code does not match");
      if (v.method === "CONTACTLESS_PHOTO" && !s.contactlessRequested) fail("CONTACTLESS_NOT_SELECTED", "The customer did not choose contactless delivery");
      if (v.method === "CONTACTLESS_PHOTO") evidence.proofPhotoRef = v.photoRef;
      if (s.highValue && !nonEmpty(command.proofPhotoRef)) fail("PROOF_PHOTO_REQUIRED", "High-value orders need a proof photo");
      if (nonEmpty(command.proofPhotoRef)) evidence.proofPhotoRef = command.proofPhotoRef;
      if (!command.sealIntact) exceptions.push({ gate: "DROP", code: "SEAL_BROKEN", reason: "Reported at the door" });
      if (exceptions.length) evidence.exceptions = exceptions;
      return change("DELIVERED", evidence);
    }

    case "FAIL_DELIVERY":
      if (!FAILED_DELIVERY_REASONS.includes(command.reason)) fail("REASON_INVALID", `Unknown reason ${command.reason}`);
      if (command.evidenceRefs.length === 0) fail("EVIDENCE_REQUIRED", "A failed delivery needs evidence");
      if (env.actor.kind === "RIDER" && env.actor.id !== o.riderId) fail("NOT_ASSIGNED_RIDER", "Only the assigned rider can fail this drop");
      return change("DELIVERY_FAILED", { evidenceRefs: command.evidenceRefs }, command.reason);
    case "REQUEST_REFUND":
      return change("REFUND_REQUESTED", {}, command.reasonCode);
    case "DECLINE_REFUND":
      if (o.state !== "REFUND_REQUESTED") fail("INVALID_STATE", "No refund request to decline");
      return change("DELIVERED", {}, command.reasonCode);
    case "REFUND": {
      const collected = s.paymentMode === "PREPAID" || o.state === "REFUND_REQUESTED";
      if (!collected) fail("NOTHING_TO_REFUND", "No money was collected for this cash-on-delivery order");
      return change("REFUNDED", {}, command.reasonCode);
    }
  }
}

export function evolve(current: OrderAggregate | undefined, event: OrderEvent): OrderAggregate {
  if (event.type === "ORDER_DRAFTED") {
    return {
      snapshot: event.snapshot,
      state: "DRAFT",
      version: event.seq,
      labelIds: [],
      sealIds: [],
      cancellationAcknowledged: false,
      flaggedForReview: false,
      exceptions: [],
    };
  }
  if (!current) throw new Error(`Event ${event.type} before ORDER_DRAFTED`);
  if (event.seq !== current.version + 1) throw new Error(`Out-of-order event ${event.seq} after ${current.version}`);
  const next = { ...current, version: event.seq };
  switch (event.type) {
    case "RIDER_ASSIGNED":
      return { ...next, riderId: event.riderId };
    case "CANCELLATION_ACKNOWLEDGED":
      return { ...next, cancellationAcknowledged: true };
    case "STATE_CHANGED": {
      const e = event.evidence;
      const exceptions = [...current.exceptions, ...(e.exceptions ?? [])];
      return {
        ...next,
        state: event.to,
        ...(event.to === "PACKED" && e.packageCount !== undefined ? { packageCount: e.packageCount } : {}),
        ...(event.to === "READY" ? { labelIds: e.labelIds ?? [], sealIds: e.sealIds ?? [] } : {}),
        exceptions,
        flaggedForReview: current.flaggedForReview || exceptions.some((x) => x.code === "OUTSIDE_GEOFENCE" || x.code === "SEAL_BROKEN"),
      };
    }
  }
}

export function replay(events: readonly OrderEvent[]): OrderAggregate | undefined {
  return events.reduce<OrderAggregate | undefined>(evolve, undefined);
}

function codeMatches(code: string, expectedHash: string): boolean {
  const a = Buffer.from(sha256Hex(code), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateSnapshot(s: OrderSnapshot, orderId: string): void {
  if (s.orderId !== orderId) fail("SNAPSHOT_MISMATCH", "Snapshot is for a different order");
  if (s.lines.length === 0) fail("EMPTY_ORDER", "An order needs at least one line");
  if (new Set(s.lines.map((l) => l.id)).size !== s.lines.length) fail("DUPLICATE_LINE", "Line ids must be unique");
  if (s.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)) fail("BAD_QUANTITY", "Quantities are positive integers");
  const total = Money.fromJSON(s.total);
  if (total.isNegative()) fail("NEGATIVE_TOTAL", "Order total cannot be negative");
  if (total.currency !== s.currencies.order) fail("CURRENCY_MISMATCH", "Total must be in the order currency");
  if (s.configuredConfirmationModel !== "AGENT_OPTIMISED" && s.configuredConfirmationModel !== s.confirmationModel) {
    fail("CONFIRMATION_MODEL", "Only AGENT_OPTIMISED may resolve to a different confirmation model");
  }
  if (!/^[0-9a-f]{64}$/.test(s.recipientCodeHash)) fail("RECIPIENT_CODE_HASH", "recipientCodeHash must be SHA-256 hex");
  if (isRiderOrder(s) && !s.dropLocation) fail("DROP_LOCATION_REQUIRED", "Rider orders need a drop location");
  if (s.channel !== "ONLINE" && !s.deviceId) fail("DEVICE_REQUIRED", "In-store orders record the device that took them");
  if (s.channel === "POS" && !s.staffId) fail("STAFF_REQUIRED", "POS orders are attributed to a staff member");
  if (s.channel !== "ONLINE" && isRiderOrder(s) && s.type !== "DELIVERY") fail("CHANNEL_TYPE", `${s.type} orders are online only`);
  if (s.type === "XBO" && !s.recipient) fail("RECIPIENT_REQUIRED", "Cross-border orders name a recipient");
  if (!Number.isFinite(s.geofenceRadiusM) || s.geofenceRadiusM <= 0) fail("GEOFENCE_RADIUS", "Geofence radius must be positive");
}
