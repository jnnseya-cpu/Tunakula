import { randomUUID } from "expo-crypto";
import { API_URL, COUNTRY } from "../config";

/**
 * The one way the app talks to the Tunakula API. Mirrors the web storefront's `api()`:
 *  - every request carries `x-country` (the market; RLS enforces isolation server-side);
 *  - a signed-in caller carries `Authorization: Bearer <token>`;
 *  - a non-GET carries an `Idempotency-Key` so a retried order/payment never double-charges;
 *  - a 401 clears the session via the registered handler so the UI returns to sign-in.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  key?: string;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "x-country": COUNTRY, accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = opts.key ?? randomUUID();
  if (opts.auth !== false && authToken) headers.authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    throw new ApiError(0, "OFFLINE", (e as Error).message || "No connection. Check your network and try again.");
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "UNAUTHORIZED", "Please sign in again.");
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; error?: string };
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? err.error ?? "Something went wrong.");
  }
  return data as T;
}

/** Full URL for a menu / branch image stored on the API, scoped to the market. */
export const imageUrl = (imageId: string): string => `${API_URL}/v1/menu-images/${imageId}?c=${COUNTRY}`;
