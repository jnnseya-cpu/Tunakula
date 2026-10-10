/**
 * Minimal HTTP transport for provider connectors. Connectors depend on the
 * `HttpTransport` function type, so tests swap in an in-memory fake server and
 * production uses `fetchTransport`.
 *
 * The one thing this layer must get right is the difference between
 *  - "never sent" (connection refused, DNS failure, HTTP 429 rejected before
 *    acceptance) → `ConnectorUnavailableError`, safe to try another route; and
 *  - "maybe sent" (timeout after the request went out, 5xx) →
 *    `ConnectorOutcomeUnknownError`, resolve by status first (ADR 0003).
 */
import { ConnectorOutcomeUnknownError, ConnectorUnavailableError } from "@tunakula/ts-contracts";

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path relative to the base URL, starting with "/". */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /**
   * Encode the body as `application/x-www-form-urlencoded` with PHP/Rails bracket
   * notation (`a[b]=c`, `a[0]=x`) instead of JSON. Stripe's API speaks only this
   * form encoding, so its connector sets it; providers with JSON APIs leave it off.
   */
  readonly form?: boolean;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET_BEFORE_SEND", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"]);

export function fetchTransport(options: { connectorId: string; baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch }): HttpTransport {
  const doFetch = options.fetchImpl ?? fetch;
  return async (req) => {
    const url = new URL(options.baseUrl.replace(/\/$/, "") + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
    const encoded = req.body !== undefined ? (req.form ? formEncode(req.body) : JSON.stringify(req.body)) : undefined;
    const contentType = req.form ? "application/x-www-form-urlencoded" : "application/json";
    let res: Response;
    try {
      res = await doFetch(url, {
        method: req.method,
        headers: { Accept: "application/json", ...(encoded !== undefined ? { "Content-Type": contentType } : {}), ...req.headers },
        ...(encoded !== undefined ? { body: encoded } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      const code = errorCode(error);
      if (code && NOT_SENT_CODES.has(code)) throw new ConnectorUnavailableError(options.connectorId, code);
      throw new ConnectorOutcomeUnknownError(options.connectorId, code ?? (error as Error).message);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON bodies are passed through as text.
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { status: res.status, headers, body };
  };
}

/**
 * Form-encodes a value the way Stripe (and other Rails/PHP-style APIs) expect:
 * nested objects as `parent[child]`, arrays as `parent[0]`, booleans as
 * `true`/`false`, and `undefined`/`null` omitted. Keys that already carry
 * bracket notation (e.g. `metadata[intent_id]`) pass straight through.
 */
export function formEncode(body: unknown): string {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(prefix ? `${prefix}[${i}]` : String(i), v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, v);
    } else {
      params.append(prefix, typeof value === "boolean" ? String(value) : String(value));
    }
  };
  walk("", body);
  return params.toString();
}

/** Applies the sent / not-sent rule to an HTTP status from a money-moving call. */
export function classifyStatus(connectorId: string, response: HttpResponse): void {
  if (response.status === 429) throw new ConnectorUnavailableError(connectorId, "rate limited (HTTP 429)");
  if (response.status >= 500) throw new ConnectorOutcomeUnknownError(connectorId, `HTTP ${response.status}`);
}

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string }; name?: string };
  return e?.cause?.code ?? e?.code ?? (e?.name === "TimeoutError" ? undefined : undefined);
}
