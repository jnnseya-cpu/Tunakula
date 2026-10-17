/**
 * Wire shapes for the rider app, mirroring the API's v1 rider routes (the same the web rider console uses).
 * Kept local so Metro needs no cross-workspace project references.
 */
export interface MoneyWire {
  readonly amount_minor: string;
  readonly currency: string;
}

export interface Session {
  readonly token: string;
  readonly userId: string;
  readonly phone: string;
}

export interface Job {
  readonly order_id: string;
  readonly ref: string;
  readonly state: string;
  readonly type: string;
  readonly items: number;
  readonly labels: string[];
  readonly age_restricted?: boolean;
  readonly pickup: { branch_id: string; name: string; commune: string | null; lat: number; lng: number };
  readonly drop: { lat: number; lng: number; note: string | null; customer: string | null } | null;
  readonly collect: MoneyWire | null;
  readonly earnings: MoneyWire | null;
}

export interface Offer {
  readonly id: string;
  readonly seconds_left: number;
  readonly expires_at: string;
  readonly pickup_km: string;
  readonly drop_km: string;
  readonly earnings: MoneyWire;
  readonly job: Job;
}

export interface Jobs {
  readonly presence: { online: boolean; lat: number | null; lng: number | null; online_since: string | null };
  readonly offer: Offer | null;
  readonly active: Job[];
  readonly today: { deliveries: number; earnings: MoneyWire };
  readonly cash_in_hand: MoneyWire;
}

export interface Earnings {
  readonly balance: MoneyWire;
  readonly today: { deliveries: number; earnings: MoneyWire };
  readonly week?: { deliveries: number; earnings: MoneyWire };
  readonly recent?: ReadonlyArray<{ order_ref: string; at: string; amount: MoneyWire }>;
}

// The order state-machine commands the rider issues (POST /v1/orders/{id}/transitions).
export type RiderCommand =
  | { type: "PICK_UP"; scannedLabelIds: string[]; restaurantConfirmed: true; sealsIntact: true; location: { lat: number; lng: number } }
  | { type: "DELIVER"; scannedLabelId?: string; location: { lat: number; lng: number }; verification: { method: "CODE"; code: string }; sealIntact: true }
  | { type: "FAIL_DELIVERY"; reason: string };
