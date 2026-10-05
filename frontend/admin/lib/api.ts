/**
 * Talks to the NZELA-OS API (backend/api). The console is a pure client: it holds the person's token
 * in this browser only and sends `X-Country` and an `Idempotency-Key` exactly as every other client does.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

const TOKEN_KEY = "tk-admin-token";
const COUNTRY_KEY = "tk-admin-country";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the session lasts until the tab closes */
  }
};

export const session = {
  token: () => read(TOKEN_KEY),
  setToken: (t: string | null) => write(TOKEN_KEY, t),
  country: () => read(COUNTRY_KEY) ?? "CD",
  setCountry: (c: string) => write(COUNTRY_KEY, c),
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, opts: { method?: "GET" | "POST" | "DELETE"; body?: unknown; country?: string | null } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  const token = session.token();
  if (token) headers["authorization"] = `Bearer ${token}`;
  const country = opts.country === undefined ? session.country() : opts.country;
  if (country) headers["x-country"] = country;
  if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  } catch {
    throw new ApiError(0, "NETWORK", `The API at ${API_BASE} cannot be reached`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401) session.setToken(null);
    throw new ApiError(res.status, data?.code ?? `HTTP_${res.status}`, data?.detail ?? res.statusText);
  }
  return data as T;
}

// ---------- response types (mirror backend/api/src/app/admin.ts) ----------

export interface Money { amount_minor: string; currency: string }
export type Scope = { type: string; id?: string };

export interface Me {
  user: { id: string; display_name: string; phone: string | null };
  bindings: { id: string; role: string; scope: Scope }[];
  markets: { iso2: string; name: string; status: string }[];
  capabilities: Partial<Record<"overview" | "orders" | "kitchen" | "dispatch" | "riders" | "catalogue" | "markets" | "team" | "finance" | "payments" | "audit" | "customers", boolean>>;
}

export interface Kpis { orders: number; delivered: number; gmv_minor: string; aov_minor: string; delivered_rate: number; lost_rate: number; customers: number }

export interface Analytics {
  period: { days: number; from: string; to: string; timezone: string; currency: string };
  scope: { kind: "market"; country: string } | { kind: "branches"; branches: { id: string; name: string }[] };
  kpis: { current: Kpis; previous: Kpis };
  daily: { day: string; orders: number; delivered: number; lost: number; gmv_minor: string; new_customers: number; returning_customers: number }[];
  states: Record<string, number>;
  funnel: { stage: string; orders: number }[];
  heatmap: { weekday: number; hour: number; orders: number }[];
  delivery_minutes: { median: number | null; p90: number | null; buckets: { label: string; orders: number }[] };
  mix: {
    order_type: { key: string; orders: number }[];
    payment_mode: { key: string; orders: number }[];
    payment_method: { key: string; payments: number }[];
    payment_status: { key: string; payments: number }[];
  };
  top_branches: { id: string; name: string; orders: number; gmv_minor: string }[];
  top_dishes: { name: string; quantity: number }[];
  riders: { rider_id: string; name: string; deliveries: number }[];
  finance: null | { balances: { account: string; currency: string; balance_minor: string }[]; daily_credits: { day: string; account: string; amount_minor: string }[] };
  audit: null | { by_day: { day: string; action: string; count: number }[]; chain: { ok: boolean; brokenAt?: number } };
}

export interface OrderRow {
  order_id: string; state: string; type: string; payment_mode: string; total_minor: string; currency: string;
  created_at: string; updated_at: string; rider_id: string | null; branch_name: string; branch_id: string; customer_name: string | null;
}
