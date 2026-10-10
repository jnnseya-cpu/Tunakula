/**
 * The communication dispatch engine.
 *
 * `dispatch` takes an event the platform emitted (its key is in the shared catalogue), decides the
 * channels for the recipient — honouring their opt-outs, except for `mandatory` notices — sends each
 * through the channel adapter, and writes an append-only delivery-log row per channel. In-app
 * deliveries also land in the recipient's inbox. A `dedupeKey` makes an emission idempotent, so the
 * same event never delivers twice (e.g. an approval emitted on a retry).
 *
 * Senders are injected: production wires real email / SMS / WhatsApp / push adapters; by default the
 * sandbox sender records every channel as "logged" so the flow is always exercisable without keys.
 */
import { COMMS_EVENTS, type CommsChannel, type CommsEvent } from "@tunakula/ts-contracts/comms";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { require as requireAction } from "./principal.ts";
import { badRequest, notFound } from "./errors.ts";
import { planChannels, renderSubject, resolveEvent } from "../modules/comms/dispatch-core.ts";
import { userById } from "../persistence/identity.ts";
import {
  getPreferences, insertDelivery, insertNotification, listDeliveries, listInbox,
  markRead, optedOutChannels, setPreference, unreadCount,
} from "../persistence/comms.ts";

export interface ChannelMessage {
  readonly channel: CommsChannel;
  /** The market, so a channel adapter can look up country-scoped data (e.g. push subscriptions). */
  readonly country: string;
  /** The recipient and the contact details a channel adapter needs (phone for SMS/WhatsApp, email). */
  readonly to: { readonly userId: string; readonly phone?: string | null; readonly email?: string | null };
  readonly subject: string;
  readonly event: CommsEvent;
  readonly data: Record<string, string | number>;
}
export interface ChannelResult { readonly status: "sent" | "logged" | "failed"; readonly ref?: string; readonly failure?: string }
export interface ChannelSender { send(message: ChannelMessage): Promise<ChannelResult> }

/** No provider keys: every channel is recorded, not actually sent. The flow stays fully testable. */
export const sandboxSender: ChannelSender = { async send() { return { status: "logged" }; } };

export interface DispatchInput {
  readonly country: string;
  readonly eventKey: string;
  readonly recipientUserId: string;
  readonly audience?: string;
  readonly data?: Record<string, string | number>;
  /** When set, the same key never delivers twice (per channel). */
  readonly dedupeKey?: string;
}

const CHANNELS: readonly CommsChannel[] = ["email", "inapp", "sms", "push", "whatsapp"];
const isChannel = (c: string): c is CommsChannel => (CHANNELS as readonly string[]).includes(c);

export class NotificationService {
  readonly #db: Db;
  readonly #registry: CountryConfigRegistry;
  readonly #sender: ChannelSender;
  readonly #now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, sender: ChannelSender = sandboxSender, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#registry = registry;
    this.#sender = sender;
    this.#now = now;
  }

  /** Emit an event to one recipient. Returns what happened on each channel. Safe to call best-effort. */
  async dispatch(input: DispatchInput): Promise<{ event: string; subject: string; deliveries: { channel: CommsChannel; status: string }[] }> {
    const event = resolveEvent(input.eventKey);
    const data = input.data ?? {};
    const subject = renderSubject(event.subject, data);
    const audience = input.audience ?? event.audience[0]!;
    return this.#db.tx({ country: input.country }, async (sql) => {
      const optedOut = await optedOutChannels(sql, input.country, input.recipientUserId);
      const contact = await userById(sql, input.recipientUserId);
      const to = { userId: input.recipientUserId, phone: contact?.phone_e164 ?? null, email: contact?.email ?? null };
      const deliveries: { channel: CommsChannel; status: string }[] = [];
      for (const { channel, suppressed } of planChannels(event, optedOut)) {
        let status: "sent" | "logged" | "suppressed" | "failed" = "suppressed";
        let ref: string | undefined;
        let failure: string | undefined;
        if (!suppressed) {
          try {
            const r = await this.#sender.send({ country: input.country, channel, to, subject, event, data });
            status = r.status;
            ref = r.ref;
            failure = r.failure;
          } catch (e) {
            status = "failed";
            failure = (e as Error).message;
          }
        }
        const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${channel}` : null;
        const id = await insertDelivery(sql, {
          country: input.country, eventKey: event.key, channel, recipientUserId: input.recipientUserId,
          audience, severity: event.severity, mandatory: event.mandatory, subject, status, providerRef: ref ?? null, failure: failure ?? null, dedupeKey,
        });
        if (id === undefined) continue; // deduped: already delivered on this channel
        if (channel === "inapp" && status !== "suppressed") {
          await insertNotification(sql, { country: input.country, userId: input.recipientUserId, eventKey: event.key, title: event.title, subject, severity: event.severity, data });
        }
        deliveries.push({ channel, status });
      }
      return { event: event.key, subject, deliveries };
    });
  }

  // ── Recipient-facing: the in-app inbox and opt-outs (scoped to the caller) ──

  async inbox(principal: Principal, country: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.#db.tx({ country }, async (sql) => ({
      data: await listInbox(sql, principal.userId, opts),
      unread: await unreadCount(sql, principal.userId),
    }));
  }

  async markRead(principal: Principal, country: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest("BAD_ID", "Invalid notification id");
    const ok = await this.#db.tx({ country }, (sql) => markRead(sql, principal.userId, id, this.#now()));
    if (!ok) throw notFound("Notification");
    return { id, read: true };
  }

  async preferences(principal: Principal, country: string) {
    const prefs = await this.#db.tx({ country }, (sql) => getPreferences(sql, country, principal.userId));
    return { channels: Object.fromEntries(CHANNELS.map((c) => [c, prefs[c] ?? true])) };
  }

  async setPreference(principal: Principal, country: string, channel: string, enabled: boolean) {
    if (!isChannel(channel)) throw badRequest("BAD_CHANNEL", "Unknown channel");
    if (channel === "inapp") throw badRequest("INAPP_REQUIRED", "The in-app channel cannot be turned off");
    await this.#db.tx({ country }, (sql) => setPreference(sql, country, principal.userId, channel, enabled, this.#now()));
    return this.preferences(principal, country);
  }

  // ── Operations: the delivery log and a self-test (requires platform config authority) ──

  #authorise(principal: Principal, country: string) {
    const version = this.#registry.published(country);
    if (!version) throw notFound(`Market ${country}`);
    requireAction(principal, "country_config:write", { type: "scope", country }, { activeCountry: country, profile: version.profile });
  }

  async deliveries(principal: Principal, country: string, limit = 50) {
    this.#authorise(principal, country);
    return { data: await this.#db.tx({ country }, (sql) => listDeliveries(sql, country, limit)) };
  }

  /** Fire any catalogue event to the caller themselves — the console's "send test to me". */
  async sendTest(principal: Principal, country: string, eventKey: string, data: Record<string, string | number> = {}) {
    this.#authorise(principal, country);
    if (!COMMS_EVENTS.has(eventKey)) throw badRequest("UNKNOWN_EVENT", `No such communication event: ${eventKey}`);
    return this.dispatch({ country, eventKey, recipientUserId: principal.userId, audience: "admin", data });
  }
}
