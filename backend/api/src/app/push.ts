/**
 * Web push: customers turn on notifications in the browser, their Push API subscription is stored, and the comms
 * dispatch engine's `push` channel delivers to it over VAPID / Web Push. This completes the notification adapters —
 * SMS and WhatsApp via the messaging provider, in-app in the inbox, and push to the device. Without VAPID keys the
 * push channel simply logs (like SMS without a provider), so the flow stays testable. Additive to the comms engine.
 */
import webpush from "web-push";
import type { Db } from "../db/db.ts";
import { type Principal } from "../modules/identity/policy.ts";
import type { ChannelMessage, ChannelResult, ChannelSender } from "./comms.ts";
import { badRequest } from "./errors.ts";

export interface VapidConfig { readonly publicKey: string; readonly privateKey: string; readonly subject: string }
interface SubInput { endpoint?: string; keys?: { p256dh?: string; auth?: string }; user_agent?: string }

/** Customer-facing: register / remove this browser's push subscription, and report whether push is on. */
export class PushService {
  private readonly db: Db;
  private readonly vapid: VapidConfig | undefined;
  constructor(db: Db, vapid?: VapidConfig) {
    this.db = db;
    this.vapid = vapid;
  }

  publicKey(): string { return this.vapid?.publicKey ?? ""; }

  async subscribe(country: string, principal: Principal, input: SubInput) {
    const endpoint = String(input.endpoint ?? "").trim();
    const p256dh = String(input.keys?.p256dh ?? "").trim();
    const auth = String(input.keys?.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) throw badRequest("SUBSCRIPTION_INVALID", "A push subscription needs an endpoint and keys");
    await this.db.tx({ country }, (sql) => sql.query(
      `INSERT INTO comms.push_subscription (country_iso2, user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, country_iso2 = EXCLUDED.country_iso2`,
      [country, principal.userId, endpoint, p256dh, auth, input.user_agent ? String(input.user_agent).slice(0, 200) : null],
    ));
    return { enabled: true };
  }

  async unsubscribe(country: string, principal: Principal, endpoint: string) {
    await this.db.tx({ country }, (sql) => sql.query("DELETE FROM comms.push_subscription WHERE user_id = $1 AND endpoint = $2", [principal.userId, String(endpoint ?? "")]));
    return { enabled: false };
  }

  async status(country: string, principal: Principal) {
    const [row] = await this.db.tx({ country }, (sql) => sql.query<{ n: number }>("SELECT count(*)::int AS n FROM comms.push_subscription WHERE user_id = $1", [principal.userId]));
    return { enabled: (row?.n ?? 0) > 0, configured: Boolean(this.vapid), public_key: this.publicKey() };
  }
}

/** The dispatch engine's `push` channel adapter: delivers to the recipient's stored subscriptions over Web Push. */
export function webPushSender(db: Db, vapid: VapidConfig): ChannelSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(message: ChannelMessage): Promise<ChannelResult> {
      if (message.channel !== "push") return { status: "logged" };
      const subs = await db.tx({ country: message.country }, (sql) => sql.query<{ endpoint: string; p256dh: string; auth: string }>(
        "SELECT endpoint, p256dh, auth FROM comms.push_subscription WHERE user_id = $1", [message.to.userId],
      ));
      if (subs.length === 0) return { status: "logged" }; // no device registered — nothing to push to
      const payload = JSON.stringify({ title: message.event.title, body: message.subject, data: { event: message.event.key, ...message.data } });
      let sent = 0;
      const dead: string[] = [];
      for (const s of subs) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; }
        catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(s.endpoint); }
      }
      // Prune subscriptions the browser has expired, so we stop pushing to them.
      if (dead.length) await db.tx({ country: message.country }, (sql) => sql.query("DELETE FROM comms.push_subscription WHERE endpoint = ANY($1::text[])", [dead]));
      return sent > 0 ? { status: "sent", ref: `push:${sent}` } : { status: "failed", failure: "no push delivered" };
    },
  };
}

/** Routes each channel to the first sender that actually handles it; the rest just log. */
export function composeSenders(...parts: ChannelSender[]): ChannelSender {
  return {
    async send(message: ChannelMessage): Promise<ChannelResult> {
      let last: ChannelResult = { status: "logged" };
      for (const part of parts) {
        const r = await part.send(message);
        if (r.status !== "logged") return r;
        last = r;
      }
      return last;
    },
  };
}
