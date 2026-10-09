/**
 * The customer's connection to the Tunakula API: session (phone sign-in), requests with the market
 * header and Idempotency-Key on writes, problem+json errors, and money in minor units.
 */
import { API_URL } from "./geo";

export const COUNTRY = "CD";
const SESSION_KEY = "tk-session";

export interface Session { readonly token: string; readonly userId: string; readonly phone: string }
export interface MoneyWire { readonly amount_minor: string; readonly currency: string }

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const live = () => Boolean(API_URL);

export function getSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return s && typeof s.token === "string" ? s : null;
  } catch { return null; }
}
export function setSession(s: Session | null) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("tk-session"));
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; key?: string } = {}): Promise<T> {
  if (!API_URL) throw new ApiError(0, "OFFLINE", "Ordering opens at launch.");
  const headers: Record<string, string> = { "x-country": COUNTRY };
  const method = opts.method ?? "GET";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = opts.key ?? crypto.randomUUID();
  const session = getSession();
  if (opts.auth !== false && session) headers.authorization = `Bearer ${session.token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  } catch {
    throw new ApiError(0, "NETWORK", "No connection. Check your data or Wi-Fi and try again.");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) setSession(null);
    throw new ApiError(res.status, body?.code ?? "ERROR", body?.detail ?? body?.title ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** The public URL of a food photo, for an <img src>. Country is in the query so no header is needed. */
export const foodPhotoUrl = (imageId: string) => `${API_URL}/v1/menu-images/${imageId}?c=${COUNTRY}`;

/** "18,00 $US" / "16 000 FC": minor units shifted by the currency's own decimals, never via floats. */
export function money(m: MoneyWire, locale = "fr-FR"): string {
  const digits = new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const neg = m.amount_minor.startsWith("-");
  const raw = (neg ? m.amount_minor.slice(1) : m.amount_minor).padStart(digits + 1, "0");
  const whole = raw.slice(0, raw.length - digits) || "0";
  const frac = digits ? raw.slice(-digits) : "";
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency: m.currency, minimumFractionDigits: digits }).formatToParts(0);
  const grouped = BigInt(whole).toLocaleString(locale);
  return parts.map((p) => (p.type === "integer" ? grouped : p.type === "fraction" ? frac : p.type === "minusSign" ? "" : p.value)).join("").replace(/^/, neg ? "−" : "");
}

export const addMinor = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
export const mulMinor = (a: string, n: number) => (BigInt(a) * BigInt(n)).toString();

// ── Cart, one per storefront, kept in this browser ──
export interface CartLineOption { readonly group: string; readonly choices: string[] }
export interface CartLine {
  /** Unique per line: the same dish with different options is a separate line. */
  readonly key: string;
  readonly item_id: string;
  readonly name: string;
  /** Per-unit price including the chosen options (a client estimate; the quote is authoritative). */
  readonly unit: MoneyWire;
  qty: number;
  readonly options?: CartLineOption[];
  readonly addons?: string[];
  /** Human-readable chosen options, e.g. ["Taille: Grande", "+ Fromage"]. */
  readonly descriptors?: string[];
}
export interface Cart { readonly branch_id: string; readonly branch_name: string; lines: CartLine[] }
/** Canonical signature of a line's options, to merge identical selections. */
export const lineSig = (l: { item_id: string; options?: CartLineOption[]; addons?: string[] }) =>
  JSON.stringify([l.item_id, (l.options ?? []).map((o) => [o.group, [...o.choices].sort()]).sort(), [...(l.addons ?? [])].sort()]);
const cartKey = (branchId: string) => `tk-cart:${branchId}`;
export function loadCart(branchId: string): Cart | null {
  try { return JSON.parse(localStorage.getItem(cartKey(branchId)) ?? "null"); } catch { return null; }
}
export function saveCart(cart: Cart) {
  try {
    if (cart.lines.length) localStorage.setItem(cartKey(cart.branch_id), JSON.stringify(cart));
    else localStorage.removeItem(cartKey(cart.branch_id));
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("tk-cart"));
}

// ── Recipient codes are shown once when the order is placed; keep them for the tracking page ──
export function rememberCode(orderId: string, code: string) {
  try { localStorage.setItem(`tk-code:${orderId}`, code); } catch { /* storage blocked */ }
}
export function recallCode(orderId: string): string | null {
  try { return localStorage.getItem(`tk-code:${orderId}`); } catch { return null; }
}

// ── Membership (the "Plus" subscription) ──
export interface MembershipPlan {
  id: string;
  name: string;
  description: string;
  price: MoneyWire;
  period: "MONTH" | "YEAR";
  benefits: { free_delivery: boolean; min_subtotal: MoneyWire; service_charge_off_bps: number };
}
export interface MyMembership {
  id: string;
  status: "ACTIVE" | "CANCELLED" | "EXPIRED";
  auto_renew: boolean;
  started_at: string;
  current_period_end: string;
  plan: MembershipPlan & { active: boolean };
}
export const listPlans = () => api<{ data: MembershipPlan[] }>("/v1/membership/plans", { auth: false }).then((r) => r.data);
export const myMembership = () => api<{ membership: MyMembership | null }>("/v1/me/membership").then((r) => r.membership);
export const subscribePlan = (planId: string) => api<{ membership: MyMembership }>("/v1/me/membership", { method: "POST", body: { plan_id: planId } }).then((r) => r.membership);
export const cancelMembership = () => api<{ membership: MyMembership | null }>("/v1/me/membership", { method: "DELETE" }).then((r) => r.membership);

// ── Favourites ──
export interface FavRestaurant { branch_id: string; name: string; commune: string | null; rating: number | null }
export const listFavourites = () => api<{ data: FavRestaurant[] }>("/v1/me/favourites").then((r) => r.data);
export const toggleFavourite = (branchId: string) => api<{ branch_id: string; favourite: boolean }>(`/v1/me/favourites/${branchId}`, { method: "POST" });

// ── Saved addresses ──
export interface SavedAddress { id: string; label: string; lat: number; lng: number; landmark: string | null; contact_phone: string | null; is_default: boolean }
export const listAddresses = () => api<{ data: SavedAddress[] }>("/v1/me/addresses").then((r) => r.data);
export const saveAddress = (a: { label: string; lat: number; lng: number; landmark?: string; is_default?: boolean }) => api<SavedAddress>("/v1/me/addresses", { method: "POST", body: a });
export const setDefaultAddress = (id: string) => api(`/v1/me/addresses/${id}/default`, { method: "POST" });
export const deleteAddress = (id: string) => api(`/v1/me/addresses/${id}`, { method: "DELETE" });

// ── Table bookings (dine-in reservations) ──
export type BookingStatus = "REQUESTED" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export interface Booking { id: string; status: BookingStatus; party_size: number; seating_at: string; duration_min: number; created_at: string; branch?: { id: string; name: string | null } }
export const bookTable = (b: { branch_id: string; party_size: number; at: string; name?: string; phone?: string; note?: string }) =>
  api<{ id: string; status: BookingStatus; party_size: number; seating_at: string }>("/v1/reservations", { method: "POST", body: b });
export const myBookings = () => api<{ bookings: Booking[] }>("/v1/me/reservations").then((r) => r.bookings);
export const cancelBooking = (id: string) => api<{ id: string; status: BookingStatus }>(`/v1/reservations/${id}/cancel`, { method: "POST" });

// ── Wallet ──
export interface WalletTxn { id: string; kind: "TOPUP" | "ORDER_PAYMENT" | "REFUND" | "ADJUSTMENT"; amount: MoneyWire; balance_after: MoneyWire; order_id: string | null; reference: string | null; created_at: string }
export const walletBalance = () => api<{ balances: MoneyWire[] }>("/v1/me/wallet").then((r) => r.balances);
export const walletHistory = () => api<{ transactions: WalletTxn[] }>("/v1/me/wallet/transactions").then((r) => r.transactions);
export const walletTopup = (amountMinor: string, currency: string, methodType: string, msisdn?: string) =>
  api<{ status: string; balance?: MoneyWire; reason_code?: string }>("/v1/me/wallet/topup", { method: "POST", body: { amount_minor: amountMinor, currency, method_type: methodType, ...(msisdn ? { payer: { msisdn } } : {}) } });

// ── Referrals ──
export interface ReferralSummary { code: string; reward: MoneyWire; spend_threshold: MoneyWire; friend_discount_pct: number; invited: number; rewarded: number; earned: MoneyWire }
export interface ReferralClaim { first_order_discount_pct: number; discount_available: boolean; discount_used: boolean }
export const myReferral = () => api<ReferralSummary>("/v1/me/referral");
export const myReferralClaim = () => api<{ claim: ReferralClaim | null }>("/v1/me/referral/claim").then((r) => r.claim);
export const claimReferral = (code: string) => api<{ id: string; first_order_discount_pct: number }>("/v1/referrals/claim", { method: "POST", body: { code } });

// ── Refund requests ──
export type RefundStatus = "PENDING" | "APPROVED" | "DECLINED";
export interface RefundRequestView { id: string; order_id: string; reason_code: string; comment: string | null; status: RefundStatus; amount: MoneyWire; resolution_note: string | null; resolved_at: string | null; created_at: string }
export const REFUND_REASONS: [string, string][] = [["ITEM_MISSING", "Something was missing"], ["WRONG_ORDER", "Wrong order"], ["FOOD_QUALITY", "Food quality"], ["DAMAGED", "Arrived damaged"], ["LATE", "Arrived too late"], ["NEVER_ARRIVED", "Never arrived"], ["OTHER", "Something else"]];
export const refundStatus = (orderId: string) => api<{ refundable: boolean; request: RefundRequestView | null }>(`/v1/orders/${orderId}/refund-request`);
export const requestRefund = (orderId: string, reasonCode: string, comment?: string) =>
  api<{ id: string; status: RefundStatus; reason_code: string }>(`/v1/orders/${orderId}/refund-request`, { method: "POST", body: { reason_code: reasonCode, ...(comment ? { comment } : {}) } });

// ── Group ordering (shared cart) ──
export interface GroupMember { user_id: string; name: string; is_host: boolean }
export interface GroupLine { id: string; member_user_id: string; item_id: string; name: string; quantity: number; options?: CartLineOption[]; addons?: string[]; line_total: MoneyWire }
export interface GroupCart {
  id: string; code: string; status: "OPEN" | "LOCKED" | "PLACED" | "CANCELLED";
  order_type: "DELIVERY" | "TAKEAWAY"; split_mode: "HOST_PAYS" | "EACH_PAYS"; host_user_id: string;
  branch: { id: string; name: string }; deadline: string | null; placed_order_id: string | null;
  members: GroupMember[]; lines: GroupLine[];
}
export interface GroupSplit { user_id: string; name: string; items_minor: string; share_minor: string; currency: string }
export interface GroupQuote { order_type: string; breakdown: { goods: MoneyWire; service_charge: MoneyWire; delivery_fee: MoneyWire; tip: MoneyWire; total: MoneyWire }; split_mode: string; split: GroupSplit[] }

export const groupCreate = (branchId: string, orderType: "DELIVERY" | "TAKEAWAY" = "DELIVERY") =>
  api<GroupCart>("/v1/group-carts", { method: "POST", body: { branch_id: branchId, order_type: orderType } });
export const groupJoin = (code: string) => api<GroupCart>("/v1/group-carts/join", { method: "POST", body: { code } });
export const groupGet = (id: string) => api<GroupCart>(`/v1/group-carts/${id}`);
export const groupAddItem = (id: string, line: { item_id: string; quantity: number; options?: CartLineOption[]; addons?: string[] }) =>
  api<GroupCart>(`/v1/group-carts/${id}/lines`, { method: "POST", body: line });
export const groupRemoveItem = (id: string, lineId: string) => api<GroupCart>(`/v1/group-carts/${id}/lines/${lineId}`, { method: "DELETE" });
export const groupLock = (id: string, locked: boolean) => api<GroupCart>(`/v1/group-carts/${id}/lock`, { method: "POST", body: { locked } });
export const groupQuote = (id: string, body: { delivery?: { lat: number; lng: number }; tip?: string }) =>
  api<GroupQuote>(`/v1/group-carts/${id}/quote`, { method: "POST", body });
export const groupPlace = (id: string, body: { payment_mode: "PREPAID" | "CASH_ON_DELIVERY"; expected_total: MoneyWire; delivery?: { lat: number; lng: number }; tip?: string; address?: { landmark?: string } }) =>
  api<{ order_id: string; state: string; recipient_code: string }>(`/v1/group-carts/${id}/place`, { method: "POST", body });

export const STATE_LABEL: Record<string, string> = {
  DRAFT: "Order created", PENDING_PAYMENT: "Waiting for payment", PAYMENT_FAILED: "Payment failed", PLACED: "Sent to the kitchen",
  ACCEPTED: "Kitchen accepted", PREPARING: "Being prepared", PACKED: "Packed and sealed", READY: "Ready for pickup",
  PICKED_UP: "On the way", DELIVERED: "Delivered", REJECTED: "Kitchen could not take it", CANCELLED: "Cancelled",
  DELIVERY_FAILED: "Delivery failed", REFUND_REQUESTED: "Refund requested", REFUNDED: "Refunded", EXPIRED: "Expired",
};
