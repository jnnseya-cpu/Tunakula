import { api } from "./client";
import type { Menu, NearbyBranch, OrderRow, OrderView, PaymentMode, PlacedOrder, Quote } from "./types";

/** Named calls to the Tunakula API, grouped by the customer journey. Each mirrors a v1 route. */

// ── Auth (phone + OTP) ──
export const requestOtp = (phone: string, channel: "sms" | "whatsapp", locale = "fr") =>
  api<void>("/v1/auth/otp/request", { method: "POST", auth: false, body: { phone, channel, locale } });

export const verifyOtp = (phone: string, code: string, displayName?: string, locale = "fr") =>
  api<{ token: string; user_id: string }>("/v1/auth/otp/verify", {
    method: "POST",
    auth: false,
    body: { phone, code, locale, ...(displayName ? { display_name: displayName } : {}) },
  });

// ── Discovery ──
export const nearbyBranches = (lat: number, lng: number, radiusKm = 50, limit = 100) =>
  api<{ data: NearbyBranch[] }>(`/v1/branches/nearby?lat=${lat}&lng=${lng}&radius_km=${radiusKm}&limit=${limit}`, { auth: false }).then((r) => r.data);

export const branchMenu = (branchId: string) => api<Menu>(`/v1/branches/${branchId}/menu`, { auth: false });

// ── Cart → quote → order ──
export interface CartItemInput {
  item_id: string;
  quantity: number;
  options?: string[];
  addons?: string[];
}
export interface QuoteInput {
  branch_id: string;
  items: CartItemInput[];
  order_type: "DELIVERY" | "PICKUP";
  delivery?: { lat: number; lng: number };
  tip?: string;
  coupon_code?: string;
}
export const quoteCart = (input: QuoteInput) => api<Quote>("/v1/carts/quote", { method: "POST", body: input });

export interface PlaceInput extends QuoteInput {
  payment_mode: PaymentMode;
  expected_total: { amount_minor: string; currency: string };
  kitchen_note?: string;
  scheduled_for?: string;
}
export const placeOrder = (input: PlaceInput, idempotencyKey: string) =>
  api<PlacedOrder>("/v1/orders", { method: "POST", key: idempotencyKey, body: input });

// ── Order tracking ──
export const getOrder = (orderId: string) => api<OrderView>(`/v1/orders/${orderId}`);
export const myOrders = (limit = 50) => api<{ data: OrderRow[] }>(`/v1/me/orders?limit=${limit}`).then((r) => r.data);

// ── Native push registration ──
export const registerPushDevice = (token: string, platform: "ios" | "android", deviceLabel?: string) =>
  api<{ enabled: boolean }>("/v1/me/push-devices", {
    method: "POST",
    body: { token, app: "customer", platform, ...(deviceLabel ? { device_label: deviceLabel } : {}) },
  });

export const removePushDevice = (token: string) =>
  api<{ enabled: boolean }>("/v1/me/push-devices/remove", { method: "POST", body: { token } });
