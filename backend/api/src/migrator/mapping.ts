/**
 * The StackFood → Tunakula field map. StackFood is a Laravel/MySQL product, so these are the table and
 * column names its schema normally uses — but THEY ARE A STARTING POINT, not gospel. Before a real run,
 * open the schema dump (`mysqldump --no-data`) and correct every table/column name below to match it.
 * Nothing else in the migrator needs editing: the transforms read through this map.
 *
 * The default config targets the live DRC (Kinshasa) market. The Congolese franc (CDF) has no minor unit,
 * so fractionDigits is 0; a market billed in USD would use 2. countryCallingCode turns national numbers
 * into E.164 so a migrated customer signs in with the number they already use.
 */
import type { MigratorConfig, Row } from "./transform.ts";
import { str } from "./transform.ts";

/** StackFood table names (verify against the dump). */
export const SOURCE_TABLES = {
  users: "users",
  merchants: "restaurants",
  branches: "restaurants", // StackFood often models a single restaurant as its own branch; a multi-branch dump may use `branches`
  items: "items",
  orders: "orders",
  orderLines: "order_details",
} as const;

/** Map a StackFood order status to a Tunakula order state. Extend as the dump reveals real status values. */
export function stackfoodStateFor(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "pending":
      return "PLACED";
    case "confirmed":
    case "accepted":
      return "ACCEPTED";
    case "processing":
    case "cooking":
      return "PREPARING";
    case "handover":
    case "ready":
      return "READY";
    case "picked_up":
    case "out_for_delivery":
      return "PICKED_UP";
    case "delivered":
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
 * Decide a Tunakula store type from a StackFood row. StackFood tags a store by "module" (food, grocery,
 * pharmacy, shop…); map that to Tunakula's store types, defaulting to RESTAURANT. Tune the column name and
 * the values once the dump is in hand.
 */
export function stackfoodStoreTypeFor(row: Row): string {
  const moduleName = (str(row, "module_type") ?? str(row, "module") ?? "").toLowerCase();
  if (moduleName.includes("pharmac")) return "PHARMACY";
  if (moduleName.includes("grocery")) return "GROCERY";
  if (moduleName.includes("shop") || moduleName.includes("ecommerce")) return "CONVENIENCE";
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
    user: { id: "id", phone: "phone", name: "f_name", email: "email", createdAt: "created_at" },
    merchant: { id: "id", name: "name", ownerPhone: "phone" },
    branch: { id: "id", merchantId: "restaurant_id", name: "name", lat: "latitude", lng: "longitude", commune: "zone_id" },
    item: { id: "id", branchId: "restaurant_id", name: "name", price: "price", available: "status" },
    order: { id: "id", branchId: "restaurant_id", customerId: "user_id", total: "order_amount", status: "order_status", placedAt: "created_at" },
  },
};
