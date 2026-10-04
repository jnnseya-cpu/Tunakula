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
    let res: Response;
    try {
      res = await doFetch(url, {
        method: req.method,
        headers: { Accept: "application/json", ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}), ...req.headers },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
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

/** Applies the sent / not-sent rule to an HTTP status from a money-moving call. */
export function classifyStatus(connectorId: string, response: HttpResponse): void {
  if (response.status === 429) throw new ConnectorUnavailableError(connectorId, "rate limited (HTTP 429)");
  if (response.status >= 500) throw new ConnectorOutcomeUnknownError(connectorId, `HTTP ${response.status}`);
}

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string }; name?: string };
  return e?.cause?.code ?? e?.code ?? (e?.name === "TimeoutError" ? undefined : undefined);
}
