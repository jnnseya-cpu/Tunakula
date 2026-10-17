/**
 * Wire shapes for the restaurant app, mirroring the API's kitchen board (GET /v1/kitchen/orders) and the
 * order state machine (POST /v1/orders/:id/transitions). Kept local so Metro needs no cross-workspace refs.
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

export interface OrderLine {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly options: string[];
  readonly allergens: string[];
  readonly note?: string;
}

export interface KitchenOrder {
  readonly order_id: string;
  readonly ref: string;
  readonly state: string;
  readonly type: string;
  readonly payment_mode: string;
  readonly total: MoneyWire;
  readonly branch_id: string;
  readonly customer: string | null;
  readonly rider: { id: string; name: string } | null;
  readonly lines: OrderLine[];
  readonly kitchen_note?: string;
  readonly scheduled_for?: string;
  readonly confirmation_model: string;
  readonly packages: number | null;
  readonly labels: string[];
  readonly times?: Record<string, string>;
}

export interface KitchenBranch {
  readonly id: string;
  readonly name: string;
  readonly commune: string | null;
  readonly status: string; // OPEN | PAUSED | ...
  readonly can_pause: boolean;
}

export interface KitchenBoard {
  readonly now: string;
  readonly branches: KitchenBranch[];
  readonly orders: KitchenOrder[];
}

// The kitchen's order-state commands. MARK_READY also needs a pack photo + seal labels (camera flow),
// which is the next increment; the app covers accept → prepare → pack here.
export type KitchenCommand =
  | { type: "ACCEPT" }
  | { type: "REJECT"; reasonCode: string }
  | { type: "START_PREPARING" }
  | { type: "PACK"; confirmedLineIds: string[]; packageCount: number; allergenAcknowledged: true };
