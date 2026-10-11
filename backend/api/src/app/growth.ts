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
import type { GrowthBrain, GrowthSignals, RecommendationCandidate, WinBackContext, WinBackCopy, WinBackWriter } from "@tunakula/ts-contracts";
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { NotificationService } from "./comms.ts";
import type { WalletService } from "./wallet.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit, langOf } from "../persistence/identity.ts";
import { badRequest, forbidden } from "./errors.ts";

/** States that count as a real order for history/popularity (exclude drafts, failures, cancellations). */
const COUNTED_STATES = "('PLACED','ACCEPTED','PREPARING','PACKED','READY','PICKED_UP','DELIVERED','REFUND_REQUESTED','REFUNDED')";
/** A goodwill win-back credit never exceeds this, whatever an operator (or an autonomous run) requests. */
const WIN_BACK_CAP_MINOR = 10_000n;
const AT_RISK_AFTER = 14, LAPSED_AFTER = 30, DORMANT_AFTER = 90;
/** The only segments an autonomous sweep may credit — a goodwill credit is for lapsed customers, not at-risk ones. */
const AUTONOMY_SEGMENTS = ["LAPSED", "DORMANT"] as const;
/** The audit actor for a win-back the agent sent on its own (a scheduled sweep with no operator). */
const AGENT_ACTOR = "system:growth-agent";

interface MenuRow { id: string; names: Record<string, string>; prices: Record<string, string>; branch_id: string; branch_name: string }

/** The per-country autonomy policy: whether the agent may run win-back sweeps on its own, and the hard caps. */
interface AutonomyPolicy {
  enabled: boolean;
  segments: string[];
  perCustomerCapMinor: bigint;
  dailyBudgetMinor: bigint;
  maxCustomersPerRun: number;
  currency: string;
  updatedAt?: Date;
}

export class GrowthService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly brain: GrowthBrain;
  private readonly wallet: WalletService;
  private readonly comms: NotificationService;
  private readonly writer: WinBackWriter;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, brain: GrowthBrain, wallet: WalletService, comms: NotificationService, writer: WinBackWriter, now: () => Date = () => new Date()) {
    this.db = db; this.registry = registry; this.brain = brain; this.wallet = wallet; this.comms = comms; this.writer = writer; this.now = now;
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

      const copy = await this.#sendWinBack(sql, country, customerId, segment, credit, reference, principal.userId);
      return { ok: true, segment, credited: credit ? wire(credit) : null, message: copy.text, message_source: copy.source };
    });
  }

  /** Issue one win-back: optional capped credit, the written message, the idempotent record, the audit. Shared by
   *  the manual win-back and the autonomous sweep, so both move money on exactly the same, audited rail, and the
   *  message is written by the win-back writer (hosted model, or the deterministic template). Returns the copy. */
  async #sendWinBack(sql: Sql, country: string, customerId: string, segment: string, credit: Money | null, reference: string, actorId: string | null): Promise<WinBackCopy> {
    if (credit) await this.wallet.creditFromPromotion(sql, country, customerId, credit, "WINBACK", reference);
    const copy = await this.writer.write(await this.#winBackContext(sql, customerId, credit));
    await this.comms.dispatch({ country, eventKey: "promo.winback", recipientUserId: customerId, audience: "customer", data: { message: copy.text }, dedupeKey: reference }).catch(() => undefined);
    await sql.query(
      "INSERT INTO growth.nudge (country_iso2, customer_id, kind, segment, credit_minor, currency, reference, sent_by) VALUES ($1,$2,'WIN_BACK',$3,$4,$5,$6,$7)",
      [country, customerId, segment, credit ? credit.minor.toString() : null, credit ? credit.currency : null, reference, actorId],
    );
    await audit(sql, { actor: actorId ?? AGENT_ACTOR, action: "growth.winback", target: `customer:${customerId}`, country, detail: { segment, credit: credit ? wire(credit) : null, message_source: copy.source } });
    return copy;
  }

  /** Resolve the grounded facts a win-back message is written from: the customer's name, a real favourite dish,
   *  and how long they've been away. The credit is set by the service; the writer only phrases it. */
  async #winBackContext(sql: Sql, customerId: string, credit: Money | null): Promise<WinBackContext> {
    const u = (await sql.query<{ display_name: string; days: number | null; locale: string | null } & Record<string, unknown>>(
      `SELECT u.display_name, u.locale,
              (SELECT EXTRACT(DAY FROM now() - MAX(o.created_at))::int FROM ordering.order_view o WHERE o.customer_id = u.id AND o.state IN ${COUNTED_STATES}) AS days
         FROM identity.app_user u WHERE u.id = $1`,
      [customerId],
    ))[0];
    const lang = langOf(u?.locale);
    const dishes = await sql.query<{ nm: string } & Record<string, unknown>>(
      `SELECT COALESCE(m.names->>$2, m.names->>'fr', m.names->>'en') AS nm, SUM((line->>'quantity')::int) AS q
         FROM ordering.order_view o
         JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
         CROSS JOIN LATERAL jsonb_array_elements(d.payload->'snapshot'->'lines') AS line
         JOIN catalogue.menu_item m ON m.id = (line->>'itemId')::uuid
        WHERE o.customer_id = $1 AND o.state IN ${COUNTED_STATES}
        GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 2`,
      [customerId, lang],
    );
    return {
      displayName: u?.display_name ?? "",
      daysSinceLastOrder: u?.days ?? null,
      favouriteDishes: dishes.map((d) => d.nm).filter((n): n is string => Boolean(n)),
      ...(credit ? { credit: credit.toJSON() } : {}),
      lang,
    };
  }

  /** Ops: the autonomy policy (caps that bound an autonomous win-back sweep) plus the agent's recent runs. */
  async autonomy(country: string, principal: Principal) {
    const v = this.#assertOps(principal, country, "campaign:write");
    return this.db.tx({ country }, async (sql) => {
      const policy = await loadPolicy(sql, country, v.profile.money.settlement_currency);
      const canManage = authorize(principal, "agent_autonomy:set", { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed;
      const runs = (await sql.query<SweepRunRow & Record<string, unknown>>(
        "SELECT id, dry_run, reached, credited_minor, planned, would_spend_minor, currency, capped_by, ran_at FROM growth.sweep_run ORDER BY ran_at DESC LIMIT 12",
      )).map(wireRun);
      return { policy: wirePolicy(policy), can_manage: canManage, cap_minor: WIN_BACK_CAP_MINOR.toString(), eligible_segments: [...AUTONOMY_SEGMENTS], runs };
    });
  }

  /** Ops: set the autonomy policy. Requires the agent_autonomy:set capability. Every cap is validated and clamped. */
  async setAutonomy(country: string, principal: Principal, input: { enabled?: boolean; segments?: string[]; per_customer_cap_minor?: string; daily_budget_minor?: string; max_customers_per_run?: number; currency?: string }) {
    const v = this.#assertOps(principal, country, "agent_autonomy:set");
    const fallbackCcy = v.profile.money.settlement_currency;
    const segments = Array.isArray(input.segments) ? input.segments.filter((s) => (AUTONOMY_SEGMENTS as readonly string[]).includes(s)) : [...AUTONOMY_SEGMENTS];
    if (segments.length === 0) throw badRequest("SEGMENTS_REQUIRED", "Choose at least one lapsed segment to re-engage (LAPSED or DORMANT)");
    const clampMinor = (raw: string | undefined, dflt: bigint) => {
      let n = raw !== undefined ? BigInt(raw) : dflt;
      if (n < 0n) n = 0n;
      return n;
    };
    const perCustomer = clampMinor(input.per_customer_cap_minor, 2000n);
    const policy: AutonomyPolicy = {
      enabled: Boolean(input.enabled),
      segments,
      perCustomerCapMinor: perCustomer > WIN_BACK_CAP_MINOR ? WIN_BACK_CAP_MINOR : perCustomer,
      dailyBudgetMinor: clampMinor(input.daily_budget_minor, 50_000n),
      maxCustomersPerRun: Math.max(0, Math.min(Number(input.max_customers_per_run ?? 50), 1000)),
      currency: (input.currency ?? fallbackCcy).toUpperCase().slice(0, 3),
    };
    return this.db.tx({ country }, async (sql) => {
      await sql.query(
        `INSERT INTO growth.autonomy (country_iso2, enabled, segments, per_customer_cap_minor, daily_budget_minor, max_customers_per_run, currency, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (country_iso2) DO UPDATE SET enabled = EXCLUDED.enabled, segments = EXCLUDED.segments, per_customer_cap_minor = EXCLUDED.per_customer_cap_minor,
           daily_budget_minor = EXCLUDED.daily_budget_minor, max_customers_per_run = EXCLUDED.max_customers_per_run, currency = EXCLUDED.currency, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [country, policy.enabled, policy.segments, policy.perCustomerCapMinor.toString(), policy.dailyBudgetMinor.toString(), policy.maxCustomersPerRun, policy.currency, principal.userId],
      );
      await audit(sql, { actor: principal.userId, action: "growth.autonomy_set", target: `country:${country}`, country, detail: { enabled: policy.enabled, segments: policy.segments, per_customer_cap_minor: policy.perCustomerCapMinor.toString(), daily_budget_minor: policy.dailyBudgetMinor.toString(), max_customers_per_run: policy.maxCustomersPerRun, currency: policy.currency } });
      return { policy: wirePolicy({ ...policy, updatedAt: new Date() }) };
    });
  }

  /** Run an autonomous win-back sweep. A dry run previews who would be reached and the spend, changing nothing; a
   *  live run issues the capped credits and records the run. Live runs require agent_autonomy:set and an enabled
   *  policy. The sweep never exceeds the per-customer cap, the per-run budget, or the per-run customer count, and
   *  it reuses the monthly idempotency guard so no customer is ever nudged twice in a window. `principal` is null
   *  when a scheduler fires the sweep headless. */
  async runSweep(country: string, principal: Principal | null, opts: { dryRun: boolean }) {
    const v = this.#market(country);
    if (principal) {
      const action: Action = opts.dryRun ? "campaign:write" : "agent_autonomy:set";
      if (!authorize(principal, action, { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed) {
        throw forbidden(opts.dryRun ? "Growth tools are managed by a market admin" : "Running the agent needs the autonomy capability");
      }
    }
    const fallbackCcy = v.profile.money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const policy = await loadPolicy(sql, country, fallbackCcy);
      if (!opts.dryRun && !policy.enabled) throw badRequest("AUTONOMY_DISABLED", "Enable autonomous win-backs before running a live sweep");
      if (!opts.dryRun && !principal) throw forbidden("A live sweep needs an operator or an authorised scheduler");

      const period = monthKey(this.now());
      const candidates = await sql.query<{ customer_id: string; display_name: string; phone: string; orders: string; spend: string; days: string } & Record<string, unknown>>(
        `SELECT c.customer_id, u.display_name, u.phone_e164 AS phone, c.orders::text, c.spend::text,
                EXTRACT(DAY FROM now() - c.last_at)::int::text AS days
           FROM (SELECT customer_id, MAX(created_at) AS last_at, COUNT(*) AS orders, SUM(total_minor) AS spend,
                        (array_agg(currency ORDER BY created_at DESC))[1] AS currency
                   FROM ordering.order_view WHERE state IN ${COUNTED_STATES} GROUP BY customer_id) c
           JOIN identity.app_user u ON u.id = c.customer_id
          WHERE c.currency = $1
            AND EXTRACT(DAY FROM now() - c.last_at) > ${LAPSED_AFTER}
            AND NOT EXISTS (SELECT 1 FROM growth.nudge n WHERE n.customer_id = c.customer_id AND n.reference = 'winback:' || c.customer_id::text || ':' || $2)
          ORDER BY EXTRACT(DAY FROM now() - c.last_at) DESC`,
        [policy.currency, period],
      );

      // Plan within the caps, most-lapsed first. A credit that would overrun the budget stops the run.
      const budget = policy.dailyBudgetMinor;
      let spend = 0n;
      let cappedBy: "BUDGET" | "COUNT" | null = null;
      const chosen: { customerId: string; display_name: string; phone: string; segment: string; credit: Money | null }[] = [];
      for (const c of candidates) {
        if (chosen.length >= policy.maxCustomersPerRun) { cappedBy = "COUNT"; break; }
        const days = Number(c.days), orders = Number(c.orders), totalSpend = Number(c.spend);
        const segment = days <= DORMANT_AFTER ? "LAPSED" : "DORMANT";
        if (!policy.segments.includes(segment)) continue;
        const credit = this.#plannedCredit(policy, orders, days, totalSpend);
        const cost = credit ? credit.minor : 0n;
        if (spend + cost > budget) { cappedBy = "BUDGET"; break; }
        spend += cost;
        chosen.push({ customerId: c.customer_id, display_name: c.display_name, phone: maskPhone(c.phone), segment, credit });
      }

      let reached = 0, credited = 0n;
      // A dry run writes one sample message (for the first customer) so the operator sees the agent's voice before
      // committing; a live run writes a message per customer as it sends.
      let sample: WinBackCopy | null = null;
      if (opts.dryRun) {
        if (chosen[0]) sample = await this.writer.write(await this.#winBackContext(sql, chosen[0].customerId, chosen[0].credit));
      } else {
        for (const ch of chosen) {
          const reference = `winback:${ch.customerId}:${period}`;
          await this.#sendWinBack(sql, country, ch.customerId, ch.segment, ch.credit, reference, principal?.userId ?? null);
          reached += 1;
          credited += ch.credit ? ch.credit.minor : 0n;
        }
      }

      const [run] = await sql.query<{ id: string; ran_at: Date }>(
        `INSERT INTO growth.sweep_run (country_iso2, dry_run, reached, credited_minor, planned, would_spend_minor, currency, capped_by, triggered_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, ran_at`,
        [country, opts.dryRun, reached, credited.toString(), chosen.length, spend.toString(), policy.currency, cappedBy, principal?.userId ?? null],
      );
      await audit(sql, { actor: principal?.userId ?? AGENT_ACTOR, action: opts.dryRun ? "growth.sweep_preview" : "growth.sweep", target: `country:${country}`, country, detail: { planned: chosen.length, reached, credited_minor: credited.toString(), would_spend_minor: spend.toString(), currency: policy.currency, capped_by: cappedBy } });

      return {
        id: run?.id, dry_run: opts.dryRun, ran_at: run?.ran_at,
        planned: chosen.length, reached, currency: policy.currency,
        would_spend: { amount_minor: spend.toString(), currency: policy.currency },
        credited: { amount_minor: credited.toString(), currency: policy.currency },
        capped_by: cappedBy, eligible: candidates.length,
        preview: opts.dryRun ? chosen.map((c) => ({ display_name: c.display_name, phone: c.phone, segment: c.segment, credit: c.credit ? wire(c.credit) : null })) : [],
        ...(sample ? { sample_message: sample.text, sample_source: sample.source } : {}),
      };
    });
  }

  /** The capped goodwill credit for one autonomous candidate: the brain's suggestion, clamped to the policy cap. */
  #plannedCredit(policy: AutonomyPolicy, orders: number, days: number, totalSpend: number): Money | null {
    const avgBasket = orders > 0 ? Money.ofMinor(BigInt(Math.round(totalSpend / orders)), policy.currency).toJSON() : undefined;
    const { action } = this.brain.assess({ orderCount: orders, lastOrderDaysAgo: days, distinctItems: 0, ...(avgBasket ? { avgBasket } : {}) });
    let minor = action.suggestedCredit ? BigInt(action.suggestedCredit.minor) : 0n;
    if (minor < 0n) minor = 0n;
    const cap = policy.perCustomerCapMinor < WIN_BACK_CAP_MINOR ? policy.perCustomerCapMinor : WIN_BACK_CAP_MINOR;
    if (minor > cap) minor = cap;
    return minor > 0n ? Money.ofMinor(minor, policy.currency) : null;
  }
}

interface SweepRunRow { id: string; dry_run: boolean; reached: number; credited_minor: string; planned: number; would_spend_minor: string; currency: string; capped_by: string | null; ran_at: Date }
const wireRun = (r: SweepRunRow) => ({ id: r.id, dry_run: r.dry_run, reached: r.reached, planned: r.planned, credited: { amount_minor: r.credited_minor, currency: r.currency }, would_spend: { amount_minor: r.would_spend_minor, currency: r.currency }, capped_by: r.capped_by, ran_at: r.ran_at });
const wirePolicy = (p: AutonomyPolicy) => ({ enabled: p.enabled, segments: p.segments, per_customer_cap: { amount_minor: p.perCustomerCapMinor.toString(), currency: p.currency }, daily_budget: { amount_minor: p.dailyBudgetMinor.toString(), currency: p.currency }, max_customers_per_run: p.maxCustomersPerRun, currency: p.currency, ...(p.updatedAt ? { updated_at: p.updatedAt } : {}) });

async function loadPolicy(sql: Sql, country: string, fallbackCcy: string): Promise<AutonomyPolicy> {
  const r = (await sql.query<{ enabled: boolean; segments: string[]; per_customer_cap_minor: string; daily_budget_minor: string; max_customers_per_run: number; currency: string; updated_at: Date } & Record<string, unknown>>(
    "SELECT enabled, segments, per_customer_cap_minor, daily_budget_minor, max_customers_per_run, currency, updated_at FROM growth.autonomy WHERE country_iso2 = $1",
    [country],
  ))[0];
  if (!r) return { enabled: false, segments: [...AUTONOMY_SEGMENTS], perCustomerCapMinor: 2000n, dailyBudgetMinor: 50_000n, maxCustomersPerRun: 50, currency: fallbackCcy };
  return { enabled: r.enabled, segments: r.segments, perCustomerCapMinor: BigInt(r.per_customer_cap_minor), dailyBudgetMinor: BigInt(r.daily_budget_minor), maxCustomersPerRun: r.max_customers_per_run, currency: r.currency, updatedAt: r.updated_at };
}

const wire = (m: Money) => ({ amount_minor: m.minor.toString(), currency: m.currency });
const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 4)}…${p.slice(-3)}` : p);
const monthKey = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

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
