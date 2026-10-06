/**
 * MessagingChannel port (PRD §7.3): the one way the platform sends a person an SMS or a WhatsApp
 * message — sign-in codes and, through the dispatch engine, any communication event on those channels.
 *
 * A send reports one of four outcomes, so callers never mistake "it failed" for "it might have gone"
 * (ADR 0003, the same rule the payment transport follows):
 *  - sent        the provider accepted it; `ref` is the provider's message id.
 *  - failed      the provider rejected it for good (bad number, blocked, 4xx) — do not retry as-is.
 *  - unavailable it never left (DNS, connection refused, 429 before acceptance) — safe to retry / reroute.
 *  - unknown     it may have gone (timeout after sending, 5xx) — never assume either way.
 */
export type MessageKind = "SMS" | "WHATSAPP";

export interface OutboundMessage {
  readonly to: string; // E.164, e.g. +243810000001
  readonly kind: MessageKind;
  readonly text: string;
  readonly locale?: string;
}

export type MessagingResult =
  | { readonly status: "sent"; readonly ref: string }
  | { readonly status: "failed"; readonly failure: string }
  | { readonly status: "unavailable"; readonly failure: string }
  | { readonly status: "unknown"; readonly failure: string };

export interface MessagingChannel {
  send(message: OutboundMessage): Promise<MessagingResult>;
}

/** Development channel: logs instead of sending. Never used in production. */
export function logMessaging(log: (m: { kind: MessageKind; to: string; text: string }) => void = () => undefined): MessagingChannel {
  return {
    async send(m) {
      log({ kind: m.kind, to: m.to, text: m.text });
      return { status: "sent", ref: `log-${Date.now().toString(36)}` };
    },
  };
}

// ── HTTP transport: separates "never sent" from "maybe sent" for the provider adapters ──

export interface HttpRequest {
  readonly method: "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
export interface HttpReply { readonly status: number; readonly body: string }

/** Thrown by a transport when the request provably never left (network error). */
export class NeverSentError extends Error {
  readonly neverSent = true as const;
}
/** Thrown when the request went out but the outcome is unknown (timeout). */
export class OutcomeUnknownError extends Error {
  readonly outcomeUnknown = true as const;
}

export type HttpSend = (request: HttpRequest) => Promise<HttpReply>;

/** Real transport over fetch. A connection error is "never sent"; a timeout is "unknown". */
export function fetchSend(timeoutMs = 8000): HttpSend {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(request.url, { method: request.method, headers: { ...request.headers }, body: request.body, signal: controller.signal });
      return { status: res.status, body: await res.text() };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new OutcomeUnknownError("request timed out");
      throw new NeverSentError((error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  };
}
