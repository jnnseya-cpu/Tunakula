/**
 * Expo push delivery — the pure, I/O-free core so it can be unit-tested on its own.
 *
 * The React Native apps (customer / rider / merchant) each register one Expo push token per device.
 * Expo's push service takes those tokens and fans a notification out to APNs (iOS) and FCM (Android)
 * behind a single token, so the platform needs neither Apple certificates nor an FCM key to reach a
 * device — only, in production, an optional Expo access token to raise rate limits and enforce that
 * pushes come from our account. This module builds the request bodies, validates tokens, and reads the
 * delivery receipts to learn which tokens the OS has expired (so the caller can prune them). The actual
 * HTTP POST is injected (the same `HttpSend` the messaging adapters use), keeping this file testable.
 */
import type { HttpSend } from "../messaging/messaging.ts";

/** Expo's single push endpoint; it routes to APNs / FCM behind the token. */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH = 100;

/** A token looks like `ExponentPushToken[xxxxxxxx]` or `ExpoPushToken[xxxxxxxx]`. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

export interface ExpoPushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string | number>;
  readonly sound: "default";
}

/** One push message per token. Unknown/invalid tokens are dropped here, never sent. */
export function buildExpoMessages(
  tokens: readonly string[],
  notification: { title: string; body: string; data: Record<string, string | number> },
): ExpoPushMessage[] {
  return tokens
    .filter(isExpoPushToken)
    .map((to) => ({ to, title: notification.title, body: notification.body, data: notification.data, sound: "default" as const }));
}

/** Split messages into Expo-sized batches (≤100 each). */
export function chunk<T>(items: readonly T[], size = EXPO_PUSH_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ExpoTicket {
  readonly status?: string;
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

/**
 * Reads the tickets Expo returns for a batch (same order as the messages sent) and reports, for that
 * batch: how many were accepted, and which tokens Expo says are no longer registered on a device so the
 * caller can delete them. A malformed body counts as zero accepted and prunes nothing (we retry later).
 */
export function readExpoReceipts(sentTokens: readonly string[], responseBody: string): { accepted: number; dead: string[] } {
  let parsed: { data?: ExpoTicket[] };
  try { parsed = JSON.parse(responseBody) as { data?: ExpoTicket[] }; }
  catch { return { accepted: 0, dead: [] }; }
  const tickets = Array.isArray(parsed.data) ? parsed.data : [];
  let accepted = 0;
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    const token = sentTokens[i];
    if (ticket.status === "ok") accepted++;
    else if (token && ticket.details?.error === "DeviceNotRegistered") dead.push(token);
  });
  return { accepted, dead };
}

/**
 * Deliver one notification to every given token. Returns the number accepted by Expo and the tokens it
 * reported as dead (to prune). A transport error on a batch counts as zero accepted for that batch and
 * leaves its tokens untouched, so a transient outage never wrongly deletes a device.
 */
export async function deliverExpoPush(
  httpSend: HttpSend,
  tokens: readonly string[],
  notification: { title: string; body: string; data: Record<string, string | number> },
  accessToken?: string,
): Promise<{ accepted: number; dead: string[] }> {
  const messages = buildExpoMessages(tokens, notification);
  if (messages.length === 0) return { accepted: 0, dead: [] };
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let accepted = 0;
  const dead: string[] = [];
  for (const batch of chunk(messages)) {
    const sentTokens = batch.map((m) => m.to);
    try {
      const reply = await httpSend({ method: "POST", url: EXPO_PUSH_URL, headers, body: JSON.stringify(batch) });
      if (reply.status >= 200 && reply.status < 300) {
        const r = readExpoReceipts(sentTokens, reply.body);
        accepted += r.accepted;
        dead.push(...r.dead);
      }
    } catch {
      // never-sent / unknown — leave tokens in place; a later event retries them.
    }
  }
  return { accepted, dead };
}
