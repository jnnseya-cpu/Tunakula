# ADR 0004 — Event-sourced order aggregate with chain-of-custody gates in the core

- Status: Accepted (open questions below need product sign-off)
- Date: 2026-10-04

## Context
PRD §10.1 defines the order state machine; §11 requires that every handover be verified by the system
and that an unverifiable step be an exception with a reason, never a skip. §9.1 makes orders event-sourced.

## Decision
- The order is an event-sourced aggregate: `decide(state, command) → events` validates without mutating;
  `evolve(state, event) → state` folds events. Every transition is a `STATE_CHANGED` event carrying actor,
  timestamp, reason code and the evidence captured at that gate.
- The §11 gates are enforced inside `decide`, not in the apps: pick-list completeness and allergen
  acknowledgement (PACKED), labels, seals and pack photo (READY), assigned-rider and package-scan binding
  (PICKED_UP), per-drop scan, recipient verification and geofence (DELIVERED). Allowed exceptions (missing
  seal, short count, broken seal, outside geofence) require a reason and are recorded; geofence and seal
  exceptions flag the order for review.
- Recipient codes are stored only as SHA-256 hashes and compared in constant time.
- The §11.9 evidence bundle is a projection over the order's events.
- Orders carry `channel` (ONLINE/POS/HUB), device, staff and table (§12.2, OMN-002); in-store orders
  skip rider states.
- The store enforces optimistic concurrency per stream and command idempotency (INT-002).

## Interpretations of §10.1 (to confirm with product)
| Addition / reading | Why |
| --- | --- |
| `DRAFT → PLACED` for cash on delivery | §10.1: PENDING_PAYMENT is "not for COD" |
| `PAYMENT_FAILED → PENDING_PAYMENT` | §20.4: offer another method without re-entering the order |
| `READY → DELIVERED` for takeaway/dine-in | §10.1: in-store types skip rider states |
| `REFUND_REQUESTED → REFUNDED \| DELIVERED` | The table gives no exit; a request is granted or declined |
| `PREPARING` cannot be cancelled | Followed the table literally. §11.2 INT-004 ("blocks packing") suggests cancellation during PREPARING may be wanted — **open question** |
| AGENT_OPTIMISED is resolved to RESTAURANT_FIRST or RIDER_FIRST at placement | §10.2: the Dispatch Optimiser chooses per order |

## Not yet covered
Order versions for change-after-acceptance (INT-003), substitutions (INT-014), age verification (INT-015),
signed label tokens and offline verification (INT-006, INT-012), batching rules (§11.10), dine-in course
and table states (§12.2), PostgreSQL/Kafka persistence.
