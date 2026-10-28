/**
 * The StackFood (v8.0) → Tunakula field map. StackFood is a Laravel/MySQL product in the 6amMart family,
 * confirmed as the source platform ("new version 8.0"), so these are the table and column names v8.0 uses.
 * They are still worth a 60-second check against the real `mysqldump --no-data` at cutover — a customised
 * install can rename things — but nothing else in the migrator needs editing: the transforms read through
 * this map.
 *
 * Entity model (how StackFood's tables map to Tunakula's):
 *   vendors      → Tunakula MERCHANT (the owner account)        — a vendor owns one or more restaurants
 *   restaurants  → Tunakula BRANCH   (a store with a location)  — restaurants.vendor_id links to its owner
 *   items        → Tunakula menu ITEM                            — items.restaurant_id links to its store
 *   users        → Tunakula customer                            — identity is phone + OTP
 *   orders       → Tunakula order (+ order_details for lines)
 *
 * The default config targets the live DRC (Kinshasa) market. The Congolese franc (CDF) has no minor unit,
 * so fractionDigits is 0; StackFood stores amounts with 2 decimals ("1500.00"), and the money converter
 * rescales from that source precision to the target's. countryCallingCode turns national numbers into
 * E.164 so a migrated customer signs in with the number they already use.
 */
import type { MigratorConfig, Row } from "./transform.ts";
import { str } from "./transform.ts";

/** StackFood v8.0 table names. */
export const SOURCE_TABLES = {
  users: "users",
  merchants: "vendors", // the owner accounts
  branches: "restaurants", // the stores (each has a vendor_id owner + a module_id)
  items: "food", // StackFood/6amMart v8.0 names the menu-item table `food` (not `items`)
  addons: "add_ons", // the per-restaurant paid-extras catalogue; a food's add_ons column lists ids into this
  orders: "orders",
  orderLines: "order_details",
} as const;

/** Map a StackFood v8.0 order status to a Tunakula order state. */
export function stackfoodStateFor(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "pending":
    case "scheduled":
      return "PLACED";
    case "confirmed":
    case "accepted":
      return "ACCEPTED";
    case "processing":
    case "cooking":
      return "PREPARING";
    case "handover":
    case "ready":
    case "ready_for_handover":
      return "READY";
    case "picked_up":
    case "out_for_delivery":
      return "PICKED_UP";
    case "delivered":
    case "refund_requested": // reached the customer, then a refund was asked — fulfilment state stays delivered
    case "refund_request_canceled":
      return "DELIVERED";
    case "canceled":
    case "cancelled":
    case "refunded":
    case "failed":
      return "CANCELLED";
    default:
      return "PLACED";
  }
}

/**
 * Decide a Tunakula store type from a StackFood restaurant row. StackFood tags each store by its module's
 * type (food / grocery / pharmacy / ecommerce / parcel). The restaurants table holds only `module_id`, so
 * the runner LEFT JOINs the `modules` table and exposes its `module_type` on the row as `module_type`;
 * this reads that. Unknown / absent → RESTAURANT (the food default).
 */
export function stackfoodStoreTypeFor(row: Row): string {
  const moduleType = (str(row, "module_type") ?? "").toLowerCase();
  if (moduleType.includes("pharmac")) return "PHARMACY";
  if (moduleType.includes("grocery")) return "GROCERY";
  if (moduleType.includes("ecommerce") || moduleType.includes("shop")) return "CONVENIENCE";
  return "RESTAURANT";
}

/** The default DRC (Kinshasa) configuration. Copy and adjust per market. */
export const DRC_CONFIG: MigratorConfig = {
  countryCallingCode: "243",
  currency: "CDF",
  fractionDigits: 0,
  storeTypeFor: stackfoodStoreTypeFor,
  stateFor: stackfoodStateFor,
  fields: {
    // vendors: the owner account. v8.0 vendors carry f_name/l_name, not a single business name — the brand
    // name lives on the restaurant (the branch). We use the owner's first name as the account label.
    user: { id: "id", phone: "phone", name: "f_name", email: "email", createdAt: "created_at" },
    merchant: { id: "id", name: "f_name", ownerPhone: "phone" },
    branch: { id: "id", merchantId: "vendor_id", name: "name", lat: "latitude", lng: "longitude", commune: "zone_id" },
    // add_ons is a food's id list into the add_ons table; food_variations is v8.0's variation JSON (older
    // installs use `variations`, kept as the fallback). The runner loads the add_ons table and resolves ids.
    item: { id: "id", branchId: "restaurant_id", name: "name", price: "price", available: "status", addOns: "add_ons", foodVariations: "food_variations", variations: "variations" },
    order: { id: "id", branchId: "restaurant_id", customerId: "user_id", total: "order_amount", status: "order_status", placedAt: "created_at" },
  },
};
