/**
 * Live order tracking over Server-Sent Events — the pure, I/O-free core so it is unit-tested on its own.
 *
 * Order tracking is one-way: the server tells the customer the order's state and the rider's position as
 * they change. SSE fits that exactly (a plain HTTP stream the browser's EventSource consumes, no extra
 * dependency and no bidirectional handshake to keep alive), where a full WebSocket would only add an
 * upstream channel this flow never uses. The controller holds the socket open and calls these helpers to
 * decide what to send; here we just shape the payload, detect a real change, and know when to stop.
 */

export interface RiderView {
  readonly name: string | null;
  readonly position?: { readonly lat: number; readonly lng: number; readonly updated_at: string };
  readonly meters_to_you?: number;
}

export interface TrackSnapshot {
  readonly state: string;
  readonly rider: RiderView | null;
}

/** States at which the order is finished: the stream sends a final event and closes. */
export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "DELIVERED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED_DELIVERY",
]);

export const isTerminal = (state: string): boolean => TERMINAL_STATES.has(state);

/** True when something a customer would see has changed, so we only push on real movement. */
export function snapshotChanged(prev: TrackSnapshot | null, next: TrackSnapshot): boolean {
  if (!prev) return true;
  if (prev.state !== next.state) return true;
  if ((prev.rider?.name ?? null) !== (next.rider?.name ?? null)) return true;
  if ((prev.rider?.meters_to_you ?? null) !== (next.rider?.meters_to_you ?? null)) return true;
  const a = prev.rider?.position;
  const b = next.rider?.position;
  if (Boolean(a) !== Boolean(b)) return true;
  if (a && b && (a.lat !== b.lat || a.lng !== b.lng || a.updated_at !== b.updated_at)) return true;
  return false;
}

/** Format one SSE frame: `event: <name>\n` then one `data:` line of JSON, ended by a blank line. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An SSE comment line, used as a keep-alive heartbeat (ignored by EventSource). */
export const SSE_HEARTBEAT = ": ping\n\n";
