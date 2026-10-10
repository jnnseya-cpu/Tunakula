/**
 * The growth agent service (§AI). Two jobs, both grounded in real data:
 *  - Recommendations: it resolves candidate dishes from the customer's own order history ("order again"),
 *    what the kitchen recommends, and what is popular in the market, then the brain ranks them. It invents no
 *    dish — every pick is an available catalogue item with a truthful reason.
 *  - Re-engagement: it reads each customer's lifecycle from recency/frequency and lets an operator win back
 *    those who have lapsed, with an optional goodwill wallet credit. The credit is capped, idempotent, issued
 *    through the ledger (promotion_expense → wallet), recorded, and audited. It never credits an active
 *    customer, and the win-back message honours the customer's comms opt-outs.
 */
import type { GrowthBrain, GrowthSignals, RecommendationCandidate } from "@tunakula/ts-contracts";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { NotificationService } from "./comms.ts";
import type { WalletService } from "./wallet.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden } from "./errors.ts";

/** States that count as a real order for history/popularity (exclude drafts, failures, cancellations). */
const COUNTED_STATES = "('PLACED','ACCEPTED','PREPARING','PACKED','READY','PICKED_UP','DELIVERED','REFUND_REQUESTED','REFUNDED')";
/** A goodwill win-back credit never exceeds this, whatever an operator requests. */
const WIN_BACK_CAP_MINOR = 10_000n;
const AT_RISK_AFTER = 14, LAPSED_AFTER = 30, DORMANT_AFTER = 90;

interface MenuRow { id: string; names: Record<string, string>; prices: Record<string, string>; branch_id: string; branch_name: string }

export class GrowthService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly brain: GrowthBrain;
  private readonly wallet: WalletService;
  private readonly comms: NotificationService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, brain: GrowthBrain, wallet: WalletService, comms: NotificationService, now: () => Date = () => new Date()) {
    this.db = db; this.registry = registry; this.brain = brain; this.wallet = wallet; this.comms = comms; this.now = now;
  }

  #market(country: string) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    return v;
  }

  #assertOps(principal: Principal, country: string, action: Action = "campaign:write") {
    const v = this.#market(country);
    if (!authorize(principal, action, { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) throw forbidden("Growth tools are managed by a market admin");
    return v;
  }

  /** The signed-in customer's "for you" picks, grounded in their orders, the kitchen's picks and what's popular. */
  async recommendations(country: string, principal: Principal, lang = "fr", limit = 8) {
    const v = this.#market(country);
    const fallbackCcy = v.profile.money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const signals = await readSignals(sql, principal.userId);
      const ccy = (await customerCurrency(sql, principal.userId)) ?? fallbackCcy;
      const candidates = [
        ...await orderAgain(sql, principal.userId, lang, ccy),
        ...await kitchenPicks(sql, principal.userId, lang, ccy),
        ...await popular(sql, lang, ccy),
      ];
      const picks = this.brain.rank(candidates, signals, limit).map((p) => ({
        item_id: p.itemId, name: p.name, branch_id: p.branchId, branch_name: p.branchName ?? null,
        reason: p.reason, rank: p.rank, price: p.price ? { amount_minor: p.price.minor, currency: p.price.currency } : null,
      }));
      return { currency: ccy, recommendations: picks };
    });
  }

  /** The signed-in customer's own lifecycle standing (for a "we miss you" surface). */
  async myStanding(country: string, principal: Principal) {
    this.#market(country);
    return this.db.tx({ country }, async (sql) => {
      const signals = await readSignals(sql, principal.userId);
      return { ...this.brain.assess(signals), signals };
    });
  }

  /** Ops: lifecycle segment counts and the re-engageable customers (AT_RISK / LAPSED / DORMANT). */
  async audience(country: string, principal: Principal, segment?: string, limit = 100) {
    this.#assertOps(principal, country, "campaign:write");
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ customer_id: string; display_name: string; phone: string; last_at: Date; orders: string; spend: string; currency: string; days: string }>(
        `SELECT c.customer_id, u.display_name, u.phone_e164 AS phone, c.last_at, c.orders::text, c.spend::text, c.currency,
                EXTRACT(DAY FROM now() - c.last_at)::int::text AS days
           FROM (SELECT customer_id, MAX(created_at) AS last_at, COUNT(*) AS orders, SUM(total_minor) AS spend,
                        (array_agg(currency ORDER BY created_at DESC))[1] AS currency
                   FROM ordering.order_view WHERE state IN ${COUNTED_STATES} GROUP BY customer_id) c
           JOIN identity.app_user u ON u.id = c.customer_id`,
      );
      const counts: Record<string, number> = { NEW: 0, ACTIVE: 0, AT_RISK: 0, LAPSED: 0, DORMANT: 0 };
      const people: { customer_id: string; display_name: string; phone: string; segment: string; orders: number; spend_minor: string; currency: string; days: number; last_at: Date }[] = [];
      for (const r of rows) {
        const days = Number(r.days); const orders = Number(r.orders);
        const seg = orders <= 1 && days <= AT_RISK_AFTER ? "NEW" : days <= AT_RISK_AFTER ? "ACTIVE" : days <= LAPSED_AFTER ? "AT_RISK" : days <= DORMANT_AFTER ? "LAPSED" : "DORMANT";
        counts[seg] = (counts[seg] ?? 0) + 1;
        if ((seg === "AT_RISK" || seg === "LAPSED" || seg === "DORMANT") && (!segment || segment === seg)) {
          people.push({ customer_id: r.customer_id, display_name: r.display_name, phone: maskPhone(r.phone), segment: seg, orders, spend_minor: r.spend, currency: r.currency, days, last_at: r.last_at });
        }
      }
      people.sort((a, b) => b.days - a.days);
      return { counts, customers: people.slice(0, Math.min(Math.max(limit, 1), 500)) };
    });
  }

  /** Ops: win back one lapsed customer — a message, and (optionally) a capped goodwill wallet credit. */
  async winBack(country: string, principal: Principal, input: { customerId: string; creditMinor?: string; currency?: string }) {
    this.#assertOps(principal, country, "campaign:write");
    const customerId = String(input.customerId ?? "");
    if (!customerId) throw badRequest("CUSTOMER_REQUIRED", "Name the customer to win back");
    return this.db.tx({ country }, async (sql) => {
      const signals = await readSignals(sql, customerId);
      const { segment, action } = this.brain.assess(signals);
      if (segment === "ACTIVE" || segment === "NEW") throw badRequest("NOT_RE_ENGAGEABLE", "This customer is already active — a win-back is only for lapsed customers");

      const period = monthKey(this.now());
      const reference = `winback:${customerId}:${period}`;
      const already = (await sql.query<{ id: string }>("SELECT id FROM growth.nudge WHERE reference = $1", [reference]))[0];
      if (already) throw badRequest("ALREADY_NUDGED", "This customer was already sent a win-back this month");

      // Resolve and cap the goodwill credit. 0 (or none) means message-only.
      let credit: Money | null = null;
      const requested = input.creditMinor ?? action.suggestedCredit?.minor;
      const ccy = input.currency ?? action.suggestedCredit?.currency ?? (await customerCurrency(sql, customerId));
      if (requested && ccy) {
        let minor = BigInt(requested);
        if (minor < 0n) minor = 0n;
        if (minor > WIN_BACK_CAP_MINOR) minor = WIN_BACK_CAP_MINOR;
        if (minor > 0n) credit = Money.ofMinor(minor, ccy);
      }

      if (credit) await this.wallet.creditFromPromotion(sql, country, customerId, credit, "WINBACK", reference);

      const offer = credit ? creditPhrase(credit) : "nous aimerions vous revoir";
      await this.comms.dispatch({ country, eventKey: "promo.winback", recipientUserId: customerId, audience: "customer", data: { offer }, dedupeKey: reference }).catch(() => undefined);

      await sql.query(
        "INSERT INTO growth.nudge (country_iso2, customer_id, kind, segment, credit_minor, currency, reference, sent_by) VALUES ($1,$2,'WIN_BACK',$3,$4,$5,$6,$7)",
        [country, customerId, segment, credit ? credit.minor.toString() : null, credit ? credit.currency : null, reference, principal.userId],
      );
      await audit(sql, { actor: principal.userId, action: "growth.winback", target: `customer:${customerId}`, country, detail: { segment, credit: credit ? wire(credit) : null } });

      return { ok: true, segment, credited: credit ? wire(credit) : null };
    });
  }
}

const wire = (m: Money) => ({ amount_minor: m.minor.toString(), currency: m.currency });
const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 4)}…${p.slice(-3)}` : p);
const monthKey = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
function creditPhrase(m: Money): string {
  const whole = m.minor / 100n, cents = (m.minor % 100n).toString().padStart(2, "0");
  return `un crédit de ${whole}.${cents} ${m.currency} vous attend`;
}

async function readSignals(sql: Sql, customerId: string): Promise<GrowthSignals> {
  const r = (await sql.query<{ orders: string; last_at: Date | null; spend: string | null; currency: string | null }>(
    `SELECT COUNT(*)::text AS orders, MAX(created_at) AS last_at, SUM(total_minor)::text AS spend,
            (array_agg(currency ORDER BY created_at DESC))[1] AS currency
       FROM ordering.order_view WHERE customer_id = $1 AND state IN ${COUNTED_STATES}`,
    [customerId],
  ))[0];
  const orders = Number(r?.orders ?? 0);
  const lastOrderDaysAgo = r?.last_at ? Math.floor((Date.now() - new Date(r.last_at).getTime()) / 86_400_000) : null;
  const distinct = (await sql.query<{ n: string }>(
    `SELECT COUNT(DISTINCT line->>'itemId')::text AS n
       FROM ordering.order_view o JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
       CROSS JOIN LATERAL jsonb_array_elements(d.payload->'snapshot'->'lines') AS line
      WHERE o.customer_id = $1 AND o.state IN ${COUNTED_STATES}`,
    [customerId],
  ))[0];
  const avgBasket = orders > 0 && r?.spend && r.currency ? Money.ofMinor(BigInt(Math.round(Number(r.spend) / orders)), r.currency).toJSON() : undefined;
  return { orderCount: orders, lastOrderDaysAgo, distinctItems: Number(distinct?.n ?? 0), ...(avgBasket ? { avgBasket } : {}) };
}

async function customerCurrency(sql: Sql, customerId: string): Promise<string | undefined> {
  const r = (await sql.query<{ currency: string }>("SELECT currency FROM ordering.order_view WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1", [customerId]))[0];
  return r?.currency;
}

const name = (names: Record<string, string>, lang: string) => names[lang] ?? names["fr"] ?? names["en"] ?? Object.values(names)[0] ?? "";
function priceOf(prices: Record<string, string>, ccy: string): MoneyJSON | undefined {
  const minor = prices[ccy] ?? prices["USD"] ?? Object.values(prices)[0];
  const cur = prices[ccy] ? ccy : prices["USD"] ? "USD" : Object.keys(prices)[0];
  return minor && cur ? { currency: cur, minor } : undefined;
}
function toCandidate(row: MenuRow, lang: string, ccy: string, reason: RecommendationCandidate["reason"], weight: number): RecommendationCandidate {
  const price = priceOf(row.prices, ccy);
  return { itemId: row.id, name: name(row.names, lang), branchId: row.branch_id, branchName: row.branch_name, reason, weight, ...(price ? { price } : {}) };
}

async function orderAgain(sql: Sql, customerId: string, lang: string, ccy: string): Promise<RecommendationCandidate[]> {
  const rows = await sql.query<MenuRow & { qty: string } & Record<string, unknown>>(
    `SELECT m.id, m.names, m.prices, m.branch_id, b.name AS branch_name, SUM((line->>'quantity')::int)::text AS qty
       FROM ordering.order_view o
       JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
       CROSS JOIN LATERAL jsonb_array_elements(d.payload->'snapshot'->'lines') AS line
       JOIN catalogue.menu_item m ON m.id = (line->>'itemId')::uuid AND m.available
       JOIN catalogue.branch b ON b.id = m.branch_id
      WHERE o.customer_id = $1 AND o.state IN ${COUNTED_STATES}
      GROUP BY m.id, m.names, m.prices, m.branch_id, b.name ORDER BY qty DESC LIMIT 12`,
    [customerId],
  );
  return rows.map((r) => toCandidate(r, lang, ccy, "ORDER_AGAIN", Number(r.qty)));
}

async function kitchenPicks(sql: Sql, customerId: string, lang: string, ccy: string): Promise<RecommendationCandidate[]> {
  const rows = await sql.query<MenuRow & Record<string, unknown>>(
    `SELECT m.id, m.names, m.prices, m.branch_id, b.name AS branch_name
       FROM catalogue.menu_item m JOIN catalogue.branch b ON b.id = m.branch_id
      WHERE m.recommended AND m.available
        AND (m.branch_id IN (SELECT DISTINCT branch_id FROM ordering.order_view WHERE customer_id = $1 AND state IN ${COUNTED_STATES})
             OR NOT EXISTS (SELECT 1 FROM ordering.order_view WHERE customer_id = $1 AND state IN ${COUNTED_STATES}))
      LIMIT 12`,
    [customerId],
  );
  return rows.map((r) => toCandidate(r, lang, ccy, "KITCHEN_PICK", 1));
}

async function popular(sql: Sql, lang: string, ccy: string): Promise<RecommendationCandidate[]> {
  const rows = await sql.query<MenuRow & { qty: string } & Record<string, unknown>>(
    `SELECT m.id, m.names, m.prices, m.branch_id, b.name AS branch_name, SUM((line->>'quantity')::int)::text AS qty
       FROM ordering.order_view o
       JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
       CROSS JOIN LATERAL jsonb_array_elements(d.payload->'snapshot'->'lines') AS line
       JOIN catalogue.menu_item m ON m.id = (line->>'itemId')::uuid AND m.available
       JOIN catalogue.branch b ON b.id = m.branch_id
      WHERE o.created_at > now() - interval '45 days' AND o.state IN ${COUNTED_STATES}
      GROUP BY m.id, m.names, m.prices, m.branch_id, b.name ORDER BY qty DESC LIMIT 20`,
  );
  return rows.map((r) => toCandidate(r, lang, ccy, "POPULAR", Number(r.qty)));
}
