/**
 * The wire shapes the customer app exchanges with the Tunakula API. These mirror the API's v1 responses
 * (the same ones the web storefront reads); kept local so the app's Metro bundler needs no cross-workspace
 * TypeScript project references.
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

export interface NearbyBranch {
  readonly id: string;
  readonly name: string;
  readonly store_type: string;
  readonly commune: string | null;
  readonly distance_km: number | null;
  readonly open: boolean;
  readonly logo_image_id?: string | null;
  readonly cover_image_id?: string | null;
  readonly rating?: { average: number | null; count: number } | null;
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly price: MoneyWire;
  readonly image_id?: string | null;
  readonly available: boolean;
  readonly options?: ReadonlyArray<{ id: string; name: string; choices: ReadonlyArray<{ id: string; name: string; price?: MoneyWire }> }>;
  readonly addons?: ReadonlyArray<{ id: string; name: string; price: MoneyWire }>;
}

export interface MenuSection {
  readonly id: string;
  readonly name: string;
  readonly items: ReadonlyArray<MenuItem>;
}

export interface Menu {
  readonly branch: { id: string; name: string; store_type: string; open: boolean; delivery_lead_days?: number };
  readonly sections: ReadonlyArray<MenuSection>;
}

export interface QuoteLine {
  readonly code: string;
  readonly amount: MoneyWire;
}

export interface Quote {
  readonly total: MoneyWire;
  readonly payable?: MoneyWire;
  readonly price_lines: ReadonlyArray<QuoteLine>;
  readonly delivery_mode?: string;
  readonly lead_time_required?: boolean;
}

export type OrderType = "DELIVERY" | "PICKUP";
export type PaymentMode = "PREPAID" | "CASH_ON_DELIVERY" | "WALLET" | "MOBILE_MONEY_PUSH";

export interface PlacedOrder {
  readonly order_id: string;
  readonly recipient_code: string;
  readonly state: string;
}

export interface RiderPosition {
  readonly lat: number;
  readonly lng: number;
  readonly updated_at: string;
}

export interface OrderView {
  readonly order_id: string;
  readonly state: string;
  readonly branch: { id: string; name: string };
  readonly total: MoneyWire;
  readonly type: OrderType;
  readonly recipient_code?: string;
  // The server returns the rider's live position and distance only while the order is on the way.
  readonly rider?: { name: string | null; position?: RiderPosition; meters_to_you?: number } | null;
  readonly placed_at?: string;
}

export interface OrderRow {
  readonly order_id: string;
  readonly state: string;
  readonly branch_name: string;
  readonly total: MoneyWire;
  readonly placed_at: string;
}

export interface PaymentIntentResult {
  readonly status: "SUCCEEDED" | "PENDING" | "FAILED" | string;
  readonly reason_code?: string;
  readonly next_action?: { type?: string; url?: string; payload?: string } | null;
}
