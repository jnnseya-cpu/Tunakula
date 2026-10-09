import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  InMemoryOrderStore,
  ConcurrencyError,
  ORDER_STATES,
  OrderRuleError,
  TRANSITIONS,
  decide,
  evidenceBundle,
  replay,
  sha256Hex,
  type Actor,
  type OrderCommand,
  type OrderEvent,
  type OrderSnapshot,
  type OrderState,
} from "../src/index.ts";

const t0 = new Date("2026-10-04T12:00:00Z");
const DROP = { lat: -4.3217, lng: 15.3126 }; // Gombe, Kinshasa
const NEAR = { lat: -4.3218, lng: 15.3127 }; // ~15 m away
const FAR = { lat: -4.33, lng: 15.32 }; // ~1.2 km away
const CODE = "4821";

const customer: Actor = { kind: "CUSTOMER", id: "c1" };
const kitchen: Actor = { kind: "RESTAURANT", id: "br-1:staff-7" };
const rider: Actor = { kind: "RIDER", id: "r1" };
const otherRider: Actor = { kind: "RIDER", id: "r2" };
const support: Actor = { kind: "SUPPORT", id: "s1" };

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    orderId: "o1",
    type: "DELIVERY",
    channel: "ONLINE",
    country: "CD",
    brandId: "tunakula",
    branchId: "br-1",
    customerId: "c1",
    gifted: false,
    lines: [
      { id: "l1", itemId: "poulet-mayo", name: "Poulet mayo", quantity: 1, options: ["frites"], allergenFlags: [] },
      { id: "l2", itemId: "pondu", name: "Pondu", quantity: 2, options: [], allergenFlags: [] },
    ],
    total: { currency: "USD", minor: "2050" },
    currencies: { price: "USD", order: "USD", settlement: "USD", reporting: "GBP" },
    paymentMode: "PREPAID",
    configuredConfirmationModel: "RESTAURANT_FIRST",
    confirmationModel: "RESTAURANT_FIRST",
    highValue: false,
    contactlessRequested: false,
    recipientCodeHash: sha256Hex(CODE),
    dropLocation: DROP,
    geofenceRadiusM: 150,
    ...overrides,
  };
}

let seq = 0;
/** Drives one order through a store; `run` returns the store result or throws OrderRuleError. */
function harness(snap: OrderSnapshot = snapshot()) {
  const store = new InMemoryOrderStore();
  const run = (command: OrderCommand, actor: Actor = support, commandId = `cmd-${++seq}`) =>
    store.handle({ commandId, orderId: snap.orderId, actor, at: new Date(t0.getTime() + seq * 1000), command });
  run({ type: "CREATE_DRAFT", snapshot: snap }, customer);
  return { store, run, state: () => replay(store.load(snap.orderId)) };
}
const rejects = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof OrderRuleError && e.code === code, `expected ${code}`);

const PACK: OrderCommand = { type: "PACK", confirmedLineIds: ["l1", "l2"], packageCount: 2, allergenAcknowledged: false };
const READY: OrderCommand = {
  type: "MARK_READY",
  packages: [{ labelId: "L-1", sealId: "S-1" }, { labelId: "L-2", sealId: "S-2" }],
  packPhotoRef: "photo://pack",
};
const PICKUP: OrderCommand = { type: "PICK_UP", scannedLabelIds: ["L-1", "L-2"], restaurantConfirmed: true, sealsIntact: true, location: DROP };
const DELIVER: OrderCommand = { type: "DELIVER", scannedLabelId: "L-1", location: NEAR, verification: { method: "CODE", code: CODE }, sealIntact: true, proofPhotoRef: "photo://door" };

/** Advances a fresh order to `READY` with a rider assigned. */
function toReady(snap?: OrderSnapshot) {
  const h = harness(snap);
  h.run({ type: "START_CHECKOUT" }, customer);
  h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi_1" });
  h.run({ type: "ASSIGN_RIDER", riderId: "r1" });
  h.run({ type: "ACCEPT" }, kitchen);
  h.run({ type: "START_PREPARING" }, kitchen);
  h.run(PACK, kitchen);
  h.run(READY, kitchen);
  return h;
}

test("happy path: placed, packed, sealed, picked up and delivered with every handover verified", () => {
  const h = toReady();
  h.run(PICKUP, rider);
  const { order } = h.run(DELIVER, rider);
  assert.equal(order.state, "DELIVERED");
  assert.equal(order.flaggedForReview, false);

  const bundle = evidenceBundle(h.store.load("o1"));
  assert.deepEqual(bundle.timeline.map((t) => t.to), ["PENDING_PAYMENT", "PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY", "PICKED_UP", "DELIVERED"]);
  assert.deepEqual(bundle.pack?.confirmedLineIds, ["l1", "l2"]);
  assert.deepEqual(bundle.ready?.sealIds, ["S-1", "S-2"]);
  assert.equal(bundle.pickup?.riderId, "r1");
  assert.equal(bundle.drop?.verificationMethod, "CODE");
  assert.ok((bundle.drop?.distanceM ?? 999) < 150);
  assert.equal(bundle.exceptions.length, 0);
});

test("every transition is an event with actor, timestamp and reason; events replay to the same state", () => {
  const h = toReady();
  h.run({ ...PICKUP, sealsIntact: false, brokenSealNote: "seal S-2 torn" } as OrderCommand, rider);
  const events = h.store.load("o1");
  events.forEach((e, i) => assert.equal(e.seq, i + 1));
  for (const e of events) assert.ok(e.actor.id && e.at instanceof Date);
  assert.deepEqual(replay(events), h.state());
});

test("Gate 1: snapshot rules and idempotent commands (§11.2)", () => {
  const store = new InMemoryOrderStore();
  const env = (snap: OrderSnapshot, commandId = "c") => ({ commandId, orderId: snap.orderId, actor: customer, at: t0, command: { type: "CREATE_DRAFT", snapshot: snap } as OrderCommand });
  rejects(() => store.handle(env(snapshot({ lines: [] }))), "EMPTY_ORDER");
  rejects(() => store.handle(env(snapshot({ total: { currency: "CDF", minor: "100" } }))), "CURRENCY_MISMATCH");
  rejects(() => store.handle(env(snapshot({ type: "XBO" }))), "RECIPIENT_REQUIRED");
  rejects(() => store.handle(env(snapshot({ confirmationModel: "RIDER_FIRST" }))), "CONFIRMATION_MODEL");
  rejects(() => store.handle(env(snapshot({ channel: "POS", type: "TAKEAWAY", deviceId: "till-1" }))), "STAFF_REQUIRED");

  const first = store.handle(env(snapshot(), "place-1"));
  const again = store.handle(env(snapshot(), "place-1"));
  assert.deepEqual(again.events, first.events, "repeated submission returns the same order");
  assert.equal(store.load("o1").length, 1);
  rejects(() => store.handle(env(snapshot(), "place-2")), "ORDER_EXISTS");
});

test("optimistic concurrency: a stale writer cannot append", () => {
  const h = harness();
  const current = h.state();
  const events = decide(current, { commandId: "x", orderId: "o1", actor: customer, at: t0, command: { type: "START_CHECKOUT" } });
  h.run({ type: "EXPIRE" }, { kind: "SYSTEM", id: "timer" });
  assert.throws(() => h.store.append("o1", current?.version ?? 0, events), ConcurrencyError);
});

test("cash on delivery skips PENDING_PAYMENT; prepaid cannot", () => {
  const cod = harness(snapshot({ paymentMode: "CASH_ON_DELIVERY" }));
  rejects(() => cod.run({ type: "START_CHECKOUT" }), "NOT_PREPAID");
  assert.equal(cod.run({ type: "PLACE_CASH_ORDER" }).order.state, "PLACED");
  rejects(() => harness().run({ type: "PLACE_CASH_ORDER" }), "NOT_COD");
});

test("failed payment can retry with another method (§20.4)", () => {
  const h = harness();
  h.run({ type: "START_CHECKOUT" });
  h.run({ type: "FAIL_PAYMENT", reasonCode: "INSUFFICIENT_FUNDS" });
  h.run({ type: "START_CHECKOUT" });
  assert.equal(h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi_2" }).order.state, "PLACED");
});

test("§10.2 RIDER_FIRST: restaurant cannot accept before a rider is secured", () => {
  const h = harness(snapshot({ configuredConfirmationModel: "AGENT_OPTIMISED", confirmationModel: "RIDER_FIRST" }));
  h.run({ type: "START_CHECKOUT" });
  h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi" });
  rejects(() => h.run({ type: "ACCEPT" }, kitchen), "RIDER_FIRST");
  h.run({ type: "ASSIGN_RIDER", riderId: "r1" });
  assert.equal(h.run({ type: "ACCEPT" }, kitchen).order.state, "ACCEPTED");
});

test("Gate 2: pick list, package count and allergen acknowledgement (§11.3, §11.7)", () => {
  const allergic = snapshot({ lines: [{ id: "l1", itemId: "x", name: "Satay", quantity: 1, options: [], allergenFlags: ["peanut"] }] });
  const h = harness(allergic);
  h.run({ type: "START_CHECKOUT" });
  h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi" });
  h.run({ type: "ACCEPT" }, kitchen);
  h.run({ type: "START_PREPARING" }, kitchen);
  rejects(() => h.run({ type: "PACK", confirmedLineIds: [], packageCount: 1, allergenAcknowledged: true }, kitchen), "PICK_LIST_INCOMPLETE");
  rejects(() => h.run({ type: "PACK", confirmedLineIds: ["l1", "zz"], packageCount: 1, allergenAcknowledged: true }, kitchen), "PICK_LIST_UNKNOWN_LINE");
  rejects(() => h.run({ type: "PACK", confirmedLineIds: ["l1"], packageCount: 0, allergenAcknowledged: true }, kitchen), "PACKAGE_COUNT_REQUIRED");
  rejects(() => h.run({ type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: false }, kitchen), "ALLERGEN_ACK_REQUIRED");
  assert.equal(h.run({ type: "PACK", confirmedLineIds: ["l1"], packageCount: 1, allergenAcknowledged: true }, kitchen).order.state, "PACKED");
});

test("Gate 2: labels, seals and pack photo before READY", () => {
  const h = harness();
  for (const c of [{ type: "START_CHECKOUT" }, { type: "CONFIRM_PAYMENT", paymentIntentId: "pi" }, { type: "ACCEPT" }, { type: "START_PREPARING" }, PACK] as OrderCommand[]) h.run(c, kitchen);
  rejects(() => h.run({ ...READY, packages: [{ labelId: "L-1", sealId: "S-1" }] } as OrderCommand, kitchen), "LABEL_COUNT_MISMATCH");
  rejects(() => h.run({ ...READY, packages: [{ labelId: "L-1", sealId: "S-1" }, { labelId: "L-1", sealId: "S-2" }] } as OrderCommand, kitchen), "LABELS_INVALID");
  rejects(() => h.run({ ...READY, packPhotoRef: "" } as OrderCommand, kitchen), "PACK_PHOTO_REQUIRED");
  const unsealed = { ...READY, packages: [{ labelId: "L-1", sealId: "S-1" }, { labelId: "L-2" }] } as OrderCommand;
  rejects(() => h.run(unsealed, kitchen), "SEAL_REQUIRED");
  const { order } = h.run({ ...unsealed, missingSealReason: "ran out of seals" } as OrderCommand, kitchen);
  assert.equal(order.state, "READY");
  assert.deepEqual(order.exceptions.map((e) => e.code), ["SEAL_MISSING"]);
});

test("Gate 3: pickup binds package, order and assigned rider (§11.4, INT-008)", () => {
  const h = toReady();
  rejects(() => h.run(PICKUP, otherRider), "NOT_ASSIGNED_RIDER");
  const foreign = () => h.run({ ...PICKUP, scannedLabelIds: ["L-1", "L-99"] } as OrderCommand, rider);
  assert.throws(foreign, /L-99 belongs to another order/);
  rejects(() => h.run({ ...PICKUP, scannedLabelIds: ["L-1", "L-1"] } as OrderCommand, rider), "DUPLICATE_SCAN");
  rejects(() => h.run({ ...PICKUP, scannedLabelIds: ["L-1"] } as OrderCommand, rider), "PACKAGE_COUNT_SHORT");
  rejects(() => h.run({ ...PICKUP, restaurantConfirmed: false } as OrderCommand, rider), "HANDOVER_UNCONFIRMED");
  rejects(() => h.run({ ...PICKUP, sealsIntact: false } as OrderCommand, rider), "SEAL_NOTE_REQUIRED");
  const { order } = h.run({ ...PICKUP, scannedLabelIds: ["L-1"], shortfallReason: "drink handed separately" } as OrderCommand, rider);
  assert.equal(order.state, "PICKED_UP");
  assert.deepEqual(order.exceptions.map((e) => e.code), ["PACKAGE_COUNT_SHORT"]);
});

test("Gate 4: per-drop scan, recipient code and geofence (§11.5)", () => {
  const h = toReady();
  h.run(PICKUP, rider);
  rejects(() => h.run({ ...DELIVER, scannedLabelId: "L-other" } as OrderCommand, rider), "WRONG_PACKAGE");
  rejects(() => h.run(DELIVER, otherRider), "NOT_ASSIGNED_RIDER");
  rejects(() => h.run({ ...DELIVER, verification: { method: "CODE", code: "0000" } } as OrderCommand, rider), "RECIPIENT_CODE_WRONG");
  rejects(() => h.run({ ...DELIVER, verification: { method: "CONTACTLESS_PHOTO", photoRef: "p" } } as OrderCommand, rider), "CONTACTLESS_NOT_SELECTED");
  // A rider drop must be photographed at the door.
  rejects(() => h.run({ type: "DELIVER", scannedLabelId: "L-1", location: NEAR, verification: { method: "CODE", code: CODE }, sealIntact: true } as OrderCommand, rider), "PROOF_PHOTO_REQUIRED");
  rejects(() => h.run({ ...DELIVER, location: FAR } as OrderCommand, rider), "OUTSIDE_GEOFENCE");
  const { order } = h.run({ ...DELIVER, location: FAR, outsideGeofenceReason: "gate closed, met at corner" } as OrderCommand, rider);
  assert.equal(order.state, "DELIVERED");
  assert.equal(order.flaggedForReview, true, "out-of-radius completion is flagged for review");
});

test("INT-010: the code cannot be waived for gifted, cross-border or high-value orders", () => {
  for (const snap of [
    snapshot({ gifted: true, contactlessRequested: true }),
    snapshot({ type: "XBO", recipient: { name: "Maman Thérèse", phone: "+243810000001" }, contactlessRequested: true }),
  ]) {
    const h = toReady(snap);
    h.run(PICKUP, rider);
    rejects(() => h.run({ ...DELIVER, verification: { method: "CONTACTLESS_PHOTO", photoRef: "p" } } as OrderCommand, rider), "RECIPIENT_CODE_MANDATORY");
    rejects(() => h.run({ ...DELIVER, verification: { method: "CONFIRM_BUTTON" } } as OrderCommand, rider), "RECIPIENT_CODE_MANDATORY");
    assert.equal(h.run(DELIVER, rider).order.state, "DELIVERED");
  }
  const hv = toReady(snapshot({ highValue: true }));
  hv.run(PICKUP, rider);
  const { proofPhotoRef: _noPhoto, ...deliverNoPhoto } = DELIVER as Extract<OrderCommand, { type: "DELIVER" }>;
  rejects(() => hv.run(deliverNoPhoto as OrderCommand, rider), "PROOF_PHOTO_REQUIRED");
  assert.equal(hv.run({ ...DELIVER, proofPhotoRef: "photo://door" } as OrderCommand, rider).order.state, "DELIVERED");
});

test("contactless is allowed only when the customer chose it, with a photo", () => {
  const h = toReady(snapshot({ contactlessRequested: true }));
  h.run(PICKUP, rider);
  const { order, events } = h.run({ ...DELIVER, verification: { method: "CONTACTLESS_PHOTO", photoRef: "photo://doorstep" } } as OrderCommand, rider);
  assert.equal(order.state, "DELIVERED");
  const e = events[0] as Extract<OrderEvent, { type: "STATE_CHANGED" }>;
  assert.equal(e.evidence.proofPhotoRef, "photo://doorstep");
});

test("failed delivery needs a structured reason and evidence, then refunds", () => {
  const h = toReady();
  h.run(PICKUP, rider);
  rejects(() => h.run({ type: "FAIL_DELIVERY", reason: "NOBODY_PRESENT", evidenceRefs: [] }, rider), "EVIDENCE_REQUIRED");
  rejects(() => h.run({ type: "FAIL_DELIVERY", reason: "LOST" as never, evidenceRefs: ["x"] }, rider), "REASON_INVALID");
  h.run({ type: "FAIL_DELIVERY", reason: "WRONG_RECIPIENT", evidenceRefs: ["call-log://1"] }, rider);
  assert.equal(h.run({ type: "REFUND", reasonCode: "DELIVERY_FAILED" }).order.state, "REFUNDED");
});

test("takeaway and dine-in skip rider states (§10.1, §12)", () => {
  const { dropLocation: _none, ...base } = snapshot({ type: "TAKEAWAY", channel: "POS", deviceId: "till-1", staffId: "staff-7" });
  const h = harness(base);
  rejects(() => h.run({ type: "ASSIGN_RIDER", riderId: "r1" }), "NO_RIDER_FOR_TYPE");
  for (const c of [{ type: "PLACE_CASH_ORDER" }] as OrderCommand[]) rejects(() => h.run(c), "NOT_COD");
  h.run({ type: "START_CHECKOUT" });
  h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi" });
  h.run({ type: "ACCEPT" }, kitchen);
  h.run({ type: "START_PREPARING" }, kitchen);
  h.run(PACK, kitchen);
  h.run(READY, kitchen);
  rejects(() => h.run(PICKUP, rider), "NO_RIDER_FOR_TYPE");
  const { order } = h.run({ type: "DELIVER", verification: { method: "CODE", code: CODE }, sealIntact: true }, kitchen);
  assert.equal(order.state, "DELIVERED");
});

test("cancellation: needs a reason, is acknowledged once, and blocks packing", () => {
  const h = harness();
  h.run({ type: "START_CHECKOUT" });
  h.run({ type: "CONFIRM_PAYMENT", paymentIntentId: "pi" });
  h.run({ type: "ACCEPT" }, kitchen);
  rejects(() => h.run({ type: "CANCEL", reasonCode: "" }, customer), "REASON_REQUIRED");
  h.run({ type: "CANCEL", reasonCode: "CUSTOMER_CHANGED_MIND" }, customer);
  h.run({ type: "ACKNOWLEDGE_CANCELLATION" }, kitchen);
  assert.equal(h.run({ type: "ACKNOWLEDGE_CANCELLATION" }, kitchen).events.length, 0);
  assert.equal(h.state()?.cancellationAcknowledged, true);
  rejects(() => h.run({ type: "START_PREPARING" }, kitchen), "INVALID_TRANSITION");
  rejects(() => h.run(PACK, kitchen), "INVALID_TRANSITION");
});

test("refund requests after delivery can be granted or declined; COD with nothing collected cannot refund", () => {
  const h = toReady();
  h.run(PICKUP, rider);
  h.run(DELIVER, rider);
  h.run({ type: "REQUEST_REFUND", reasonCode: "MISSING_ITEM" }, customer);
  assert.equal(h.run({ type: "DECLINE_REFUND", reasonCode: "EVIDENCE_SHOWS_COMPLETE" }).order.state, "DELIVERED");
  h.run({ type: "REQUEST_REFUND", reasonCode: "MISSING_ITEM" }, customer);
  assert.equal(h.run({ type: "REFUND", reasonCode: "GOODWILL" }).order.state, "REFUNDED");

  const cod = harness(snapshot({ paymentMode: "CASH_ON_DELIVERY" }));
  cod.run({ type: "PLACE_CASH_ORDER" });
  cod.run({ type: "REJECT", reasonCode: "CLOSED" }, kitchen);
  rejects(() => cod.run({ type: "REFUND", reasonCode: "x" }), "NOTHING_TO_REFUND");
});

test("§33: the transition table is closed — every target is a known state and terminal states go nowhere", () => {
  for (const [from, tos] of Object.entries(TRANSITIONS)) {
    for (const to of tos) assert.ok(ORDER_STATES.includes(to), `${from} → ${to}`);
  }
  assert.deepEqual(TRANSITIONS.EXPIRED, []);
  assert.deepEqual(TRANSITIONS.REFUNDED, []);
  // Delivery can only be reached from verified custody.
  const intoDelivered = ORDER_STATES.filter((s) => TRANSITIONS[s].includes("DELIVERED"));
  assert.deepEqual(intoDelivered.sort(), ["PICKED_UP", "READY", "REFUND_REQUESTED"]);
});

test("property: random command sequences never produce a transition outside the table", () => {
  const ALL: OrderCommand[] = [
    { type: "START_CHECKOUT" },
    { type: "CONFIRM_PAYMENT", paymentIntentId: "pi" },
    { type: "FAIL_PAYMENT", reasonCode: "TIMEOUT" },
    { type: "PLACE_CASH_ORDER" },
    { type: "EXPIRE" },
    { type: "ASSIGN_RIDER", riderId: "r1" },
    { type: "ACCEPT" },
    { type: "REJECT", reasonCode: "CLOSED" },
    { type: "CANCEL", reasonCode: "X" },
    { type: "ACKNOWLEDGE_CANCELLATION" },
    { type: "START_PREPARING" },
    PACK,
    READY,
    PICKUP,
    DELIVER,
    { type: "FAIL_DELIVERY", reason: "UNSAFE", evidenceRefs: ["e"] },
    { type: "REQUEST_REFUND", reasonCode: "X" },
    { type: "DECLINE_REFUND", reasonCode: "X" },
    { type: "REFUND", reasonCode: "X" },
  ];
  const actors = [customer, kitchen, rider, support];
  fc.assert(
    fc.property(
      fc.constantFrom<"PREPAID" | "CASH_ON_DELIVERY">("PREPAID", "CASH_ON_DELIVERY"),
      fc.array(fc.tuple(fc.integer({ min: 0, max: ALL.length - 1 }), fc.integer({ min: 0, max: actors.length - 1 })), { maxLength: 40 }),
      (paymentMode, steps) => {
        const h = harness(snapshot({ paymentMode }));
        let previous: OrderState = "DRAFT";
        for (const [c, a] of steps) {
          try {
            h.run(ALL[c] as OrderCommand, actors[a]);
          } catch (e) {
            if (!(e instanceof OrderRuleError)) throw e;
          }
          const now = h.state()?.state as OrderState;
          if (now !== previous) assert.ok(TRANSITIONS[previous].includes(now), `${previous} → ${now}`);
          previous = now;
        }
        // Delivery is never reached without a READY with labels.
        if (previous === "DELIVERED") assert.ok((h.state()?.labelIds.length ?? 0) > 0);
      },
    ),
    { numRuns: 300 },
  );
});
