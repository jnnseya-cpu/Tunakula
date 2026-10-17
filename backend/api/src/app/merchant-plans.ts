/**
 * Optional merchant subscription plans. Tunakula charges every merchant 0% commission; a merchant may additionally
 * be put on a paid plan (billed monthly, netted from their payout to subscription_revenue) that unlocks perks such as
 * featured placement. The default is the implicit FREE plan — no fee, no perks — so a merchant is unaffected unless
 * moved onto a paid one. Additive: it never deducts a commission from a sale. The StackFood merchant-subscription peer.
 */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { type Principal } from "../modules/identity/policy.ts";
import { require } from "./principal.ts";
import { audit } from "../persistence/identity.ts";
import { createJournal } from "../modules/money/journal.ts";
import { postJournal } from "../persistence/ledger.ts";
import { badRequest, notFound } from "./errors.ts";

interface PlanInput { code?: string; name?: string; monthly_fee?: string | number; featured?: boolean; active?: boolean; sort?: number; perks?: Record<string, unknown> }
type PlanRow = { id: string; code: string; name: string; monthly_fee_minor: string; currency: string; featured: boolean; perks: Record<string, unknown>; active: boolean; sort: number };

const CODE = /^[A-Z][A-Z0-9_]{1,23}$/;

export class MerchantPlanService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  #profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }
  #gate(country: string, principal: Principal) {
    require(principal, "commission:write", { type: "scope", country }, { activeCountry: country, profile: this.#profile(country) });
  }
  #view(r: PlanRow) {
    return { id: r.id, code: r.code, name: r.name, monthly_fee: { amount_minor: r.monthly_fee_minor, currency: r.currency }, featured: r.featured, perks: r.perks ?? {}, active: r.active, sort: r.sort };
  }

  /** GET /v1/admin/merchant-plans — the plan catalogue and every group's current plan. */
  async overview(country: string, principal: Principal) {
    this.#gate(country, principal);
    return this.db.tx({ country }, async (sql) => {
      const plans = await sql.query<PlanRow & Record<string, unknown>>(
        "SELECT id, code, name, monthly_fee_minor::text AS monthly_fee_minor, currency, featured, perks, active, sort FROM catalogue.merchant_plan ORDER BY sort, monthly_fee_minor",
      );
      const merchants = await sql.query<{ group_id: string; name: string; plan_code: string; plan_name: string | null; branches: number }>(
        `SELECT g.id AS group_id, g.name, g.plan_code,
                (SELECT p.name FROM catalogue.merchant_plan p WHERE p.code = g.plan_code AND p.country_iso2 = g.country_iso2) AS plan_name,
                (SELECT count(*) FROM catalogue.branch b WHERE b.restaurant_group_id = g.id)::int AS branches
           FROM catalogue.restaurant_group g ORDER BY g.name`,
      );
      return {
        plans: plans.map((p) => this.#view(p)),
        merchants: merchants.map((m) => ({ group_id: m.group_id, name: m.name, plan_code: m.plan_code, plan_name: m.plan_name ?? (m.plan_code === "FREE" ? "Free" : m.plan_code), branches: m.branches })),
      };
    });
  }

  /** POST /v1/admin/merchant-plans — create or update a plan (by code). */
  async savePlan(country: string, principal: Principal, input: PlanInput) {
    this.#gate(country, principal);
    const profile = this.#profile(country);
    const code = String(input.code ?? "").trim().toUpperCase();
    if (!CODE.test(code)) throw badRequest("CODE_INVALID", "A plan code is 2–24 chars: A–Z, 0–9, underscore");
    if (code === "FREE" && Number(input.monthly_fee ?? 0) > 0) throw badRequest("FREE_IS_FREE", "The FREE plan cannot carry a fee");
    const name = String(input.name ?? "").trim();
    if (!name) throw badRequest("NAME_REQUIRED", "A plan needs a name");
    const ccy = profile.money.settlement_currency;
    let feeMinor = "0";
    try { feeMinor = Money.of(String(input.monthly_fee ?? "0"), ccy).minor.toString(); } catch (e) { throw badRequest("FEE_INVALID", (e as Error).message); }
    if (BigInt(feeMinor) < 0n) throw badRequest("FEE_INVALID", "The monthly fee cannot be negative");
    const featured = input.featured === true;
    const active = input.active !== false;
    const sort = Number.isFinite(Number(input.sort)) ? Math.trunc(Number(input.sort)) : 0;
    const perks = input.perks && typeof input.perks === "object" ? input.perks : {};
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<PlanRow & Record<string, unknown>>(
        `INSERT INTO catalogue.merchant_plan (country_iso2, code, name, monthly_fee_minor, currency, featured, perks, active, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (country_iso2, code) DO UPDATE SET name = EXCLUDED.name, monthly_fee_minor = EXCLUDED.monthly_fee_minor,
           currency = EXCLUDED.currency, featured = EXCLUDED.featured, perks = EXCLUDED.perks, active = EXCLUDED.active, sort = EXCLUDED.sort, updated_at = now()
         RETURNING id, code, name, monthly_fee_minor::text AS monthly_fee_minor, currency, featured, perks, active, sort`,
        [country, code, name, feeMinor, ccy, featured, JSON.stringify(perks), active, sort],
      );
      await audit(sql, { actor: principal.userId, action: "merchant_plan.saved", target: `merchant_plan:${code}`, country, detail: { monthly_fee_minor: feeMinor, featured } });
      return this.#view(row!);
    });
  }

  /** POST /v1/admin/merchant-plans/assign — put a restaurant group on a plan (or FREE). */
  async assign(country: string, principal: Principal, input: { group_id?: string; plan_code?: string }) {
    this.#gate(country, principal);
    const groupId = String(input.group_id ?? "").trim();
    const code = String(input.plan_code ?? "FREE").trim().toUpperCase();
    if (!groupId) throw badRequest("GROUP_REQUIRED", "Name the restaurant group");
    return this.db.tx({ country }, async (sql) => {
      if (code !== "FREE") {
        const [plan] = await sql.query<{ active: boolean }>("SELECT active FROM catalogue.merchant_plan WHERE code = $1", [code]);
        if (!plan) throw notFound(`Plan ${code}`);
        if (!plan.active) throw badRequest("PLAN_INACTIVE", "That plan is not active");
      }
      const [g] = await sql.query<{ id: string }>("UPDATE catalogue.restaurant_group SET plan_code = $2, updated_at = now() WHERE id = $1 RETURNING id", [groupId, code]);
      if (!g) throw notFound("Restaurant group");
      await audit(sql, { actor: principal.userId, action: "merchant_plan.assigned", target: `group:${groupId}`, country, detail: { plan_code: code } });
      return { group_id: groupId, plan_code: code };
    });
  }

  /**
   * Bills this calendar month's fee for every group on a paid, active plan: debits restaurant_payable (so it is
   * netted from the merchant's payout) and credits subscription_revenue. Idempotent per group per month.
   */
  async billSweep(country: string): Promise<{ billed: number }> {
    const now = this.now();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const due = await this.db.tx({ country }, (sql) => sql.query<{ group_id: string; fee: string; currency: string }>(
      `SELECT g.id AS group_id, p.monthly_fee_minor::text AS fee, p.currency
         FROM catalogue.restaurant_group g
         JOIN catalogue.merchant_plan p ON p.country_iso2 = g.country_iso2 AND p.code = g.plan_code
        WHERE p.active AND p.monthly_fee_minor > 0`,
    ));
    let billed = 0;
    for (const d of due) {
      const key = `merchant-plan:${d.group_id}:${month}`;
      const fee = Money.ofMinor(BigInt(d.fee), d.currency);
      const posted = await this.db.tx({ country }, (sql) => postJournal(sql, createJournal({
        id: key, idempotencyKey: key, description: `Merchant plan fee ${month} for ${d.group_id}`, postedAt: now,
        entries: [{ account: "restaurant_payable", country, amount: fee }, { account: "subscription_revenue", country, amount: fee.negate() }],
      })));
      if (!posted.replayed) billed++;
    }
    return { billed };
  }
}
