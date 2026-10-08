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

export const STATE_LABEL: Record<string, string> = {
  DRAFT: "Order created", PENDING_PAYMENT: "Waiting for payment", PAYMENT_FAILED: "Payment failed", PLACED: "Sent to the kitchen",
  ACCEPTED: "Kitchen accepted", PREPARING: "Being prepared", PACKED: "Packed and sealed", READY: "Ready for pickup",
  PICKED_UP: "On the way", DELIVERED: "Delivered", REJECTED: "Kitchen could not take it", CANCELLED: "Cancelled",
  DELIVERY_FAILED: "Delivery failed", REFUND_REQUESTED: "Refund requested", REFUNDED: "Refunded", EXPIRED: "Expired",
};
