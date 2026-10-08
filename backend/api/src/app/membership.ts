/**
 * Paid customer membership — the "Plus" subscription (the big-4's DashPass / Uber One /
 * Deliveroo Plus). Admins define plans per market; customers subscribe for a recurring fee and
 * get benefits applied at quote time: free delivery over a minimum subtotal and/or a discount on
 * the service charge. The benefit is FUNDED from subscription revenue at settlement, so the
 * merchant and rider are still paid in full (commerce.ts posts the funding entry).
 *
 * This layer is additive: it owns plans, subscriptions and membership billing, and exposes
 * `activeBenefit` to commerce. It never touches the order engine directly.
 */
import { Money, ratio } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { createJournal } from "../modules/money/journal.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { postJournal } from "../persistence/ledger.ts";
import { audit } from "../persistence/identity.ts";
import {
  expireSubscription,
  insertPlan,
  insertSubscription,
  listPlans,
  liveSubscription,
  planById,
  renewSubscription,
  setAutoRenew,
  subscriptionsToSettle,
  updatePlan,
  type PlanInput,
  type PlanRow,
  type SubscriptionRow,
} from "../persistence/membership.ts";
import { badRequest, conflict, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

/** The benefit a member's order is entitled to, resolved from their live subscription's plan. */
export interface MembershipBenefit {
  readonly planId: string;
  readonly planName: string;
  readonly freeDelivery: boolean;
  readonly minSubtotalMinor: bigint;
  readonly serviceChargeOffBps: number;
}

/** What commerce needs from this service: the live member benefit, if any, for a customer. */
export interface MembershipLookup {
  activeBenefit(sql: Sql, country: string, userId: string): Promise<MembershipBenefit | undefined>;
}

/**
 * The discount a member earns on one order, given the fees the order would otherwise charge.
 * Pure and currency-safe: returns zero when the subtotal is below the plan's minimum.
 */
export function membershipDiscount(
  benefit: MembershipBenefit,
  fees: { goods: Money; customerDeliveryFee: Money; serviceCharge: Money },
): { discount: Money; freeDelivery: boolean; serviceChargeOff: Money } {
  const ccy = fees.goods.currency;
  const zero = Money.zero(ccy);
  const meetsMin = fees.goods.compare(Money.ofMinor(benefit.minSubtotalMinor, ccy)) >= 0;
  if (!meetsMin) return { discount: zero, freeDelivery: false, serviceChargeOff: zero };
  const freeDelivery = benefit.freeDelivery && !fees.customerDeliveryFee.isZero();
  const deliveryOff = freeDelivery ? fees.customerDeliveryFee : zero;
  const serviceChargeOff =
    benefit.serviceChargeOffBps > 0 ? fees.serviceCharge.multiply(ratio(BigInt(benefit.serviceChargeOffBps), 10_000n)) : zero;
  return { discount: deliveryOff.add(serviceChargeOff), freeDelivery, serviceChargeOff };
}

/** Advances a period end by the plan's interval. */
function nextPeriodEnd(from: Date, period: "MONTH" | "YEAR"): Date {
  const d = new Date(from);
  if (period === "YEAR") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export class MembershipService implements MembershipLookup {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** Public: the plans a customer in this market can subscribe to. */
  async plans(country: string) {
    const rows = await this.db.tx({ country }, (sql) => listPlans(sql, country, { activeOnly: true }));
    return rows.map(publicPlan);
  }

  /** Admin: every plan, including inactive ones. */
  async allPlans(country: string, principal: Principal) {
    const profile = this.profile(country);
    require(principal, "membership:manage", { type: "membership_plan", country }, { activeCountry: country, profile });
    const rows = await this.db.tx({ country }, (sql) => listPlans(sql, country));
    return rows.map(adminPlan);
  }

  /** Admin: create or update a plan. */
  async savePlan(country: string, principal: Principal, planId: string | undefined, body: Record<string, unknown>) {
    const profile = this.profile(country);
    require(principal, "membership:manage", { type: "membership_plan", country }, { activeCountry: country, profile });
    const input = parsePlan(body, profile.money.settlement_currency);
    return this.db.tx({ country }, async (sql) => {
      let row: PlanRow;
      if (planId) {
        const existing = await planById(sql, planId);
        if (!existing || existing.country_iso2 !== country) throw notFound("Plan");
        row = await updatePlan(sql, planId, input);
      } else {
        row = await insertPlan(sql, country, input);
      }
      await audit(sql, {
        actor: principal.userId,
        action: planId ? "membership.plan_updated" : "membership.plan_created",
        target: `membership_plan:${row.id}`,
        country,
        detail: { name: row.name, price_minor: row.price_minor, active: row.active },
      });
      return adminPlan(row);
    });
  }

  /** Customer: subscribe to a plan. Charges the fee to the ledger and starts a period. */
  async subscribe(country: string, principal: Principal, planId: string, idempotencyKey: string) {
    const profile = this.profile(country);
    require(principal, "membership:subscribe", { type: "membership", country, ownerUserId: principal.userId }, { activeCountry: country, profile });
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const plan = await planById(sql, planId);
      if (!plan || plan.country_iso2 !== country) throw notFound("Plan");
      if (!plan.active) throw unprocessable("PLAN_INACTIVE", "This membership plan is no longer available");
      const existing = await liveSubscription(sql, country, principal.userId, now);
      if (existing) throw conflict("ALREADY_SUBSCRIBED", "You already have an active membership in this market");
      const sub = await insertSubscription(sql, country, { userId: principal.userId, planId, periodEnd: nextPeriodEnd(now, plan.period) });
      await this.#billPeriod(sql, country, plan, sub.id, `subscribe:${sub.id}`, now);
      await audit(sql, { actor: principal.userId, action: "membership.subscribed", target: `membership:${sub.id}`, country, detail: { plan: plan.name } });
      return { membership: this.#view(sub, plan) };
    });
  }

  /** Customer: the caller's live membership (or null). */
  async mine(country: string, principal: Principal) {
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const sub = await liveSubscription(sql, country, principal.userId, now);
      if (!sub) return { membership: null };
      const plan = await planById(sql, sub.plan_id);
      return { membership: plan ? this.#view(sub, plan) : null };
    });
  }

  /** Customer: cancel — stops auto-renewal but keeps benefits until the period ends. */
  async cancel(country: string, principal: Principal) {
    const profile = this.profile(country);
    require(principal, "membership:subscribe", { type: "membership", country, ownerUserId: principal.userId }, { activeCountry: country, profile });
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const sub = await liveSubscription(sql, country, principal.userId, now);
      if (!sub) throw notFound("Membership");
      const updated = (await setAutoRenew(sql, sub.id, false, now)) ?? sub;
      const plan = await planById(sql, sub.plan_id);
      await audit(sql, { actor: principal.userId, action: "membership.cancelled", target: `membership:${sub.id}`, country });
      return { membership: plan ? this.#view(updated, plan) : null };
    });
  }

  /** The live member benefit for a customer, used by commerce when it prices an order. */
  async activeBenefit(sql: Sql, country: string, userId: string): Promise<MembershipBenefit | undefined> {
    const sub = await liveSubscription(sql, country, userId, this.now());
    if (!sub) return undefined;
    const plan = await planById(sql, sub.plan_id);
    if (!plan) return undefined;
    return {
      planId: plan.id,
      planName: plan.name,
      freeDelivery: plan.free_delivery,
      minSubtotalMinor: BigInt(plan.min_subtotal_minor),
      serviceChargeOffBps: plan.service_charge_off_bps,
    };
  }

  /**
   * Renews auto-renewing memberships that have reached their period end, and expires the rest.
   * Billing is idempotent on the subscription id and the period end, so a re-run never double-charges.
   */
  async renewalSweep(country: string, now: () => Date = this.now): Promise<{ renewed: number; expired: number }> {
    const at = now();
    const due = await this.db.tx({ country }, (sql) => subscriptionsToSettle(sql, at));
    let renewed = 0;
    let expired = 0;
    for (const sub of due) {
      await this.db.tx({ country }, async (sql) => {
        const plan = await planById(sql, sub.plan_id);
        if (sub.auto_renew && sub.status === "ACTIVE" && plan && plan.active) {
          const periodEnd = nextPeriodEnd(new Date(sub.current_period_end), plan.period);
          await this.#billPeriod(sql, country, plan, sub.id, `renew:${sub.id}:${new Date(sub.current_period_end).toISOString()}`, at);
          await renewSubscription(sql, sub.id, periodEnd);
          renewed++;
        } else {
          await expireSubscription(sql, sub.id);
          expired++;
        }
      });
    }
    return { renewed, expired };
  }

  /** Posts the membership fee for one period: the customer owes it, the platform earns subscription revenue. */
  async #billPeriod(sql: Sql, country: string, plan: PlanRow, subscriptionId: string, key: string, at: Date): Promise<void> {
    const fee = Money.ofMinor(BigInt(plan.price_minor), plan.currency);
    if (fee.isZero()) return; // a free plan needs no journal
    await postJournal(
      sql,
      createJournal({
        id: `membership:${key}`,
        idempotencyKey: `membership:${key}`,
        description: `Membership ${plan.name} — ${subscriptionId}`,
        entries: [
          { account: "customer_receivable", country, amount: fee },
          { account: "subscription_revenue", country, amount: fee.negate() },
        ],
        postedAt: at,
      }),
    );
  }

  #view(sub: SubscriptionRow, plan: PlanRow) {
    return {
      id: sub.id,
      status: sub.status,
      auto_renew: sub.auto_renew,
      started_at: new Date(sub.started_at).toISOString(),
      current_period_end: new Date(sub.current_period_end).toISOString(),
      plan: adminPlan(plan),
    };
  }
}

/** HTTP wire shape for money (§25.1): minor units as a string, matching the rest of the API. */
function money(minor: string, currency: string) {
  return { amount_minor: minor, currency };
}

function publicPlan(p: PlanRow) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: money(p.price_minor, p.currency),
    period: p.period,
    benefits: {
      free_delivery: p.free_delivery,
      min_subtotal: money(p.min_subtotal_minor, p.currency),
      service_charge_off_bps: p.service_charge_off_bps,
    },
  };
}

function adminPlan(p: PlanRow) {
  return { ...publicPlan(p), active: p.active, created_at: new Date(p.created_at).toISOString(), updated_at: new Date(p.updated_at).toISOString() };
}

function parsePlan(body: Record<string, unknown>, settlementCurrency: string): PlanInput {
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 80) throw badRequest("NAME_REQUIRED", "A plan needs a name of 1–80 characters");
  const period = body.period === "YEAR" ? "YEAR" : "MONTH";
  const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : settlementCurrency;
  const priceMinor = minor(body.price_minor ?? body.priceMinor, "price_minor");
  if (priceMinor < 0n) throw badRequest("PRICE_INVALID", "Price cannot be negative");
  const minSubtotalMinor = minor(body.min_subtotal_minor ?? body.minSubtotalMinor ?? "0", "min_subtotal_minor");
  if (minSubtotalMinor < 0n) throw badRequest("MIN_SUBTOTAL_INVALID", "Minimum subtotal cannot be negative");
  const bps = Number(body.service_charge_off_bps ?? body.serviceChargeOffBps ?? 0);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw badRequest("SERVICE_CHARGE_OFF_INVALID", "service_charge_off_bps is 0–10000");
  const freeDelivery = body.free_delivery ?? body.freeDelivery;
  return {
    name,
    description: String(body.description ?? "").slice(0, 280),
    priceMinor,
    currency,
    period,
    freeDelivery: freeDelivery === undefined ? true : Boolean(freeDelivery),
    minSubtotalMinor,
    serviceChargeOffBps: bps,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

function minor(value: unknown, field: string): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw badRequest("AMOUNT_INVALID", `${field} must be an integer number of minor units`);
  }
}
