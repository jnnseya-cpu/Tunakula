/**
 * One-click broadcasts. An admin sends an offer or announcement to a whole audience — every customer,
 * rider or merchant active in the market, a lifecycle segment, or a hand-picked selection — over the
 * channels they choose (in-app, push, SMS, WhatsApp, email). Each recipient is delivered through the
 * notification service, so opt-outs and per-channel dedupe are honoured and every send is recorded.
 * Audiences are resolved from the market's own tenant data (orders, branches), so RLS keeps them
 * country-scoped.
 */
import type { CommsChannel } from "@tunakula/ts-contracts/comms";
import { COMMS_CHANNELS } from "@tunakula/ts-contracts/comms";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import type { NotificationService } from "./comms.ts";
import { badRequest, forbidden } from "./errors.ts";
import { require } from "./principal.ts";

export type BroadcastAudience = "all" | "customer" | "rider" | "restaurant";

const COUNTED = "('PLACED','ACCEPTED','PREPARING','PACKED','READY','PICKED_UP','DELIVERED','REFUND_REQUESTED','REFUNDED')";
const AT_RISK_AFTER = 14, LAPSED_AFTER = 30, DORMANT_AFTER = 90;
const MAX_RECIPIENTS = 5000;
const isChannel = (c: string): c is CommsChannel => (COMMS_CHANNELS as readonly string[]).includes(c);
const segOf = (orders: number, days: number) =>
  orders <= 1 && days <= AT_RISK_AFTER ? "NEW" : days <= AT_RISK_AFTER ? "ACTIVE" : days <= LAPSED_AFTER ? "AT_RISK" : days <= DORMANT_AFTER ? "LAPSED" : "DORMANT";

interface Target { audience: BroadcastAudience; segment?: string; userIds?: string[] }

async function customerIds(sql: Sql, segment?: string): Promise<string[]> {
  const rows = await sql.query<{ id: string; days: string; orders: string }>(
    `SELECT customer_id AS id, EXTRACT(DAY FROM now() - max(created_at))::int::text AS days, count(*)::text AS orders
       FROM ordering.order_view WHERE state IN ${COUNTED} GROUP BY customer_id`,
  );
  const picked = segment ? rows.filter((r) => segOf(Number(r.orders), Number(r.days)) === segment) : rows;
  return picked.map((r) => r.id);
}
async function riderIds(sql: Sql): Promise<string[]> {
  const rows = await sql.query<{ id: string }>(`SELECT DISTINCT rider_id AS id FROM ordering.order_view WHERE rider_id IS NOT NULL`);
  return rows.map((r) => r.id);
}
async function merchantIds(sql: Sql): Promise<string[]> {
  const rows = await sql.query<{ id: string }>(
    `SELECT DISTINCT rg.created_by AS id FROM catalogue.restaurant_group rg
        JOIN catalogue.branch b ON b.restaurant_group_id = rg.id WHERE rg.created_by IS NOT NULL`,
  );
  return rows.map((r) => r.id);
}

async function resolveRecipients(sql: Sql, t: Target): Promise<string[]> {
  if (t.userIds && t.userIds.length > 0) return [...new Set(t.userIds)];
  if (t.audience === "customer") return customerIds(sql, t.segment);
  if (t.audience === "rider") return riderIds(sql);
  if (t.audience === "restaurant") return merchantIds(sql);
  // "all": everyone active in the market, deduped.
  const [c, r, m] = await Promise.all([customerIds(sql), riderIds(sql), merchantIds(sql)]);
  return [...new Set([...c, ...r, ...m])];
}

export class BroadcastService {
  constructor(
    private readonly db: Db,
    private readonly registry: CountryConfigRegistry,
    private readonly comms: NotificationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  #assert(country: string, principal: Principal) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    require(principal, "campaign:write", { type: "campaign", country }, { activeCountry: country, profile: v.profile });
    return v;
  }

  /** How many recipients a target resolves to, so the admin can confirm before sending. */
  async preview(country: string, principal: Principal, target: Target) {
    this.#assert(country, principal);
    const count = await this.db.tx({ country }, (sql) => resolveRecipients(sql, target));
    return { audience: target.audience, segment: target.segment ?? null, count: count.length };
  }

  /** Send the message to the resolved audience over the chosen channels. One click, many recipients. */
  async send(country: string, principal: Principal, input: Target & { channels: string[]; message: string }) {
    this.#assert(country, principal);
    const message = String(input.message ?? "").trim().slice(0, 480);
    if (!message) throw badRequest("MESSAGE_REQUIRED", "A message is required");
    const channels = [...new Set((input.channels ?? []).filter(isChannel))];
    if (channels.length === 0) throw badRequest("CHANNEL_REQUIRED", "Choose at least one channel");

    const ids = await this.db.tx({ country }, (sql) => resolveRecipients(sql, input));
    const recipients = ids.slice(0, MAX_RECIPIENTS);
    const campaignId = `bcast:${this.now().getTime()}`;
    const tally: Record<string, number> = { sent: 0, logged: 0, suppressed: 0, failed: 0 };
    for (const id of recipients) {
      const r = await this.comms.dispatch({
        country, eventKey: "promo.broadcast", recipientUserId: id, audience: input.audience,
        data: { message }, channels, dedupeKey: `${campaignId}:${id}`,
      }).catch(() => ({ deliveries: [] as { status: string }[] }));
      for (const d of r.deliveries) tally[d.status] = (tally[d.status] ?? 0) + 1;
    }
    await this.db.tx({ country }, (sql) => audit(sql, {
      actor: principal.userId, action: "broadcast.sent", target: campaignId, country,
      detail: { audience: input.audience, segment: input.segment ?? null, channels, recipients: recipients.length, message: message.slice(0, 80) },
    }));
    return { campaignId, recipients: recipients.length, truncated: ids.length > recipients.length, ...tally };
  }
}
