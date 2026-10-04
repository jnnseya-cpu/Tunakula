/** §11.9 evidence bundle: a projection of the order's events, for support and the A4 agent. */
import type { Evidence, IntegrityException, OrderEvent, OrderState } from "./order-types.ts";

export interface EvidenceBundle {
  readonly orderId: string;
  readonly finalState: OrderState | "DRAFT";
  readonly timeline: readonly { readonly at: Date; readonly to: OrderState; readonly actor: string; readonly reasonCode?: string }[];
  readonly pack?: Pick<Evidence, "confirmedLineIds" | "packageCount" | "allergenAcknowledged">;
  readonly ready?: Pick<Evidence, "labelIds" | "sealIds" | "packPhotoRef">;
  readonly pickup?: Pick<Evidence, "scannedLabelIds" | "packageCount" | "location"> & { readonly at: Date; readonly riderId: string };
  readonly drop?: Pick<Evidence, "scannedLabelIds" | "location" | "distanceM" | "verificationMethod" | "proofPhotoRef"> & { readonly at: Date };
  readonly exceptions: readonly IntegrityException[];
}

export function evidenceBundle(events: readonly OrderEvent[]): EvidenceBundle {
  const first = events[0];
  if (!first) throw new Error("No events");
  let bundle: { -readonly [K in keyof EvidenceBundle]: EvidenceBundle[K] } = {
    orderId: first.orderId,
    finalState: "DRAFT",
    timeline: [],
    exceptions: [],
  };
  for (const e of events) {
    if (e.type !== "STATE_CHANGED") continue;
    const ev = e.evidence;
    bundle = {
      ...bundle,
      finalState: e.to,
      timeline: [...bundle.timeline, { at: e.at, to: e.to, actor: `${e.actor.kind}:${e.actor.id}`, ...(e.reasonCode ? { reasonCode: e.reasonCode } : {}) }],
      exceptions: [...bundle.exceptions, ...(ev.exceptions ?? [])],
    };
    if (e.to === "PACKED") bundle.pack = { confirmedLineIds: ev.confirmedLineIds ?? [], packageCount: ev.packageCount ?? 0, ...(ev.allergenAcknowledged ? { allergenAcknowledged: true } : {}) };
    if (e.to === "READY") bundle.ready = { labelIds: ev.labelIds ?? [], sealIds: ev.sealIds ?? [], ...(ev.packPhotoRef ? { packPhotoRef: ev.packPhotoRef } : {}) };
    if (e.to === "PICKED_UP") {
      bundle.pickup = { at: e.at, riderId: e.actor.id, scannedLabelIds: ev.scannedLabelIds ?? [], packageCount: ev.packageCount ?? 0, ...(ev.location ? { location: ev.location } : {}) };
    }
    if (e.to === "DELIVERED" && ev.verificationMethod) {
      bundle.drop = {
        at: e.at,
        ...(ev.scannedLabelIds ? { scannedLabelIds: ev.scannedLabelIds } : {}),
        ...(ev.location ? { location: ev.location } : {}),
        ...(ev.distanceM !== undefined ? { distanceM: ev.distanceM } : {}),
        verificationMethod: ev.verificationMethod,
        ...(ev.proofPhotoRef ? { proofPhotoRef: ev.proofPhotoRef } : {}),
      };
    }
  }
  return bundle;
}
