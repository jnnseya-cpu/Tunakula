/**
 * Pure decisions of the communication dispatch engine (no I/O), so they can be unit-tested on their
 * own: resolve an event from the shared catalogue, render its subject, and decide which channels a
 * dispatch should use given the recipient's opt-outs. Mandatory events ignore opt-outs.
 */
import { COMMS_EVENTS, type CommsChannel, type CommsEvent } from "@tunakula/ts-contracts/comms";

export type { CommsChannel, CommsEvent };

/** Looks an event up by key; throws if the key is not in the catalogue (a programming error). */
export function resolveEvent(key: string): CommsEvent {
  const event = COMMS_EVENTS.get(key);
  if (!event) throw new Error(`Unknown communication event: ${key}`);
  return event;
}

/** Fills {{token}} placeholders from data; unknown tokens are left intact so a gap is visible. */
export function renderSubject(template: string, data: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => (key in data ? String(data[key]) : `{{${key}}}`));
}

export interface ChannelPlan {
  readonly channel: CommsChannel;
  /** True when the recipient opted out of this channel and the event is not mandatory. */
  readonly suppressed: boolean;
}

/** The channels an event dispatches on, each marked suppressed when the recipient opted out. */
export function planChannels(event: CommsEvent, optedOut: ReadonlySet<CommsChannel>): ChannelPlan[] {
  return event.channels.map((channel) => ({ channel, suppressed: !event.mandatory && optedOut.has(channel) }));
}
