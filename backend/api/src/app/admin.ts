/**
 * Admin console use cases: who am I and what may I see, role-scoped analytics, orders,
 * branches, team and role grants, payments, ledger and audit.
 *
 * Visibility is derived from the same policy as every other call (§8.2): a person sees the
 * branches on which they hold `order:read`, so a country admin sees the market, city
 * operations their city, and a restaurant owner only their own branches. Role grants
 * follow one rule: nobody can give out more than they hold (see `canGrant`).
 */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal, type ResourceContext } from "../modules/identity/policy.ts";
import { assertValidBinding, ROLES, type Action, type Role, type RoleBinding, type Scope } from "../modules/identity/roles.ts";
import { addBinding, audit, createUser, userByPhone, verifyAuditChain } from "../persistence/identity.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";

export interface BranchInfo {
  id: string;
  name: string;
  restaurant_group_id: string;
  brand_id: string;
  city: string | null;
  commune: string | null;
  status: string;
}

/** Which slice of a market a person may see. `all` means the whole market (no branch filter). */
interface Visibility {
  readonly all: boolean;
  readonly branches: readonly BranchInfo[];
}

export const STATE_GROUPS = {
  awaiting_payment: ["DRAFT", "PENDING_PAYMENT"],
  open: ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY", "PICKED_UP"],
  delivered: ["DELIVERED", "REFUND_REQUESTED"],
  refunded: ["REFUNDED"],
  lost: ["REJECTED", "CANCELLED", "DELIVERY_FAILED", "EXPIRED", "PAYMENT_FAILED"],
} as const;
const DELIVERED = STATE_GROUPS.delivered as readonly string[];
const LOST = STATE_GROUPS.lost as readonly string[];
const NOT_PLACED = ["DRAFT", "PENDING_PAYMENT", "PAYMENT_FAILED", "EXPIRED"];
const KITCHEN_ACTIVE = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY"];
const KITCHEN_DONE = ["PICKED_UP", "DELIVERED", "REJECTED", "CANCELLED"];

/** Roles whose holders are managed by someone with a narrower "manage" right. */
const MANAGED_BY: Partial<Record<Role, Action>> = { RIDER: "rider:manage", KITCHEN_STAFF: "staff:manage", BRANCH_MANAGER: "staff:manage" };
const NOT_GRANTABLE: readonly Role[] = ["CUSTOMER"];

const PERIODS = [7, 30, 90] as const;

export class AdminService {
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

  #can(principal: Principal, action: Action, resource: ResourceContext, profile: CountryProfile, amount?: { currency: string; minor: string }): boolean {
    return authorize(principal, action, resource, { activeCountry: resource.country, profile, ...(amount ? { amount } : {}) }).allowed;
  }

  #isSuperAdmin(principal: Principal): boolean {
    return principal.bindings.some((b) => b.userId === principal.userId && b.scope.type === "GROUP" && "role" in b && ROLES[b.role].grants.some((g) => g.action === "*"));
  }

  async #branches(sql: Sql): Promise<BranchInfo[]> {
    return sql.query<BranchInfo & Record<string, unknown>>(
      "SELECT id, name, restaurant_group_id, brand_id, city, commune, status FROM catalogue.branch ORDER BY name",
    );
  }

  #branchResource(country: string, b: BranchInfo): ResourceContext {
    return {
      type: "order",
      country,
      brandId: b.brand_id,
      branchId: b.id,
      restaurantGroupId: b.restaurant_group_id,
      ...(b.city ? { cityId: b.city } : {}),
      ...(b.commune ? { zoneIds: [b.commune] } : {}),
    };
  }

  async #visibility(sql: Sql, principal: Principal, country: string, profile: CountryProfile, action: Action = "order:read"): Promise<Visibility> {
    const branches = await this.#branches(sql);
    if (this.#can(principal, action, { type: "order", country }, profile)) return { all: true, branches };
    return { all: false, branches: branches.filter((b) => this.#can(principal, action, this.#branchResource(country, b), profile)) };
  }

  /** GET /v1/me: the person, their roles, and which console sections they can use in this market. */
  async me(principal: Principal, country: string | undefined) {
    return this.db.tx(country ? { country } : {}, async (sql) => {
      const [user] = await sql.query<{ id: string; display_name: string; phone_e164: string | null; created_at: Date }>(
        "SELECT id, display_name, phone_e164, created_at FROM identity.app_user WHERE id = $1",
        [principal.userId],
      );
      if (!user) throw notFound("User");
      const bindings = principal.bindings.filter((b) => !(b.id.startsWith("customer:"))).map(publicBinding);
      const markets = this.registry.countries();
      let capabilities: Record<string, boolean> = {};
      if (country) {
        const profile = this.#profile(country);
        const vis = await this.#visibility(sql, principal, country, profile);
        const prep = await this.#visibility(sql, principal, country, profile, "order:prepare");
        const marketWide = { type: "scope", country };
        capabilities = {
          overview: vis.all || vis.branches.length > 0,
          orders: vis.all || vis.branches.length > 0,
          catalogue: this.#can(principal, "restaurant:manage", marketWide, profile) || vis.branches.some((b) => this.#can(principal, "menu:write", { ...this.#branchResource(country, b), type: "menu" }, profile)),
          markets: this.#can(principal, "country_config:write", marketWide, profile),
          team: this.#isSuperAdmin(principal) || ["rider:manage", "staff:manage", "country_config:write"].some((a) => this.#can(principal, a as Action, marketWide, profile) || vis.branches.some((b) => this.#can(principal, a as Action, this.#branchResource(country, b), profile))),
          finance: this.#can(principal, "ledger:read", marketWide, profile),
          payments: vis.all,
          audit: this.#can(principal, "audit:read", marketWide, profile),
          customers: vis.all,
          kitchen: prep.all || prep.branches.length > 0,
          dispatch: this.#can(principal, "dispatch:manage", marketWide, profile) || vis.branches.some((b) => this.#can(principal, "dispatch:manage", this.#branchResource(country, b), profile)),
          riders: this.#can(principal, "rider:manage", marketWide, profile) || vis.branches.some((b) => this.#can(principal, "rider:manage", this.#branchResource(country, b), profile)),
        };
      }
      return {
        user: { id: user.id, display_name: user.display_name, phone: user.phone_e164, since: user.created_at },
        bindings,
        markets,
        scope: country ? { country } : null,
        capabilities,
      };
    });
  }

  /** GET /v1/admin/analytics?days=7|30|90: every chart on the dashboard, for what this person may see. */
  async analytics(principal: Principal, country: string, daysParam: number) {
    const days = (PERIODS as readonly number[]).includes(daysParam) ? daysParam : 30;
    const profile = this.#profile(country);
    const tz = profile.country.timezones[0] ?? "UTC";
    const ccy = profile.money.settlement_currency;
    const end = this.now();
    const start = new Date(end.getTime() - days * 86_400_000);
    const prevStart = new Date(start.getTime() - days * 86_400_000);
    return this.db.tx({ country }, async (sql) => {
      const vis = await this.#visibility(sql, principal, country, profile);
      if (!vis.all && vis.branches.length === 0) throw forbidden("No branches or markets you can see orders for");
      const ids = vis.branches.map((b) => b.id);
      // $1 start, $2 end, $3 branch filter (null = whole market), $4 currency, $5 tz
      const scope = "($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[]))";
      const p = [start, end, vis.all ? null : ids, ccy, tz];

      const kpi = async (from: Date, to: Date) => {
        const [r] = await sql.query<Record<string, string>>(
          `SELECT count(*) FILTER (WHERE NOT (o.state = ANY($6))) AS placed,
                  count(*) FILTER (WHERE o.state = ANY($7)) AS delivered,
                  count(*) FILTER (WHERE o.state = ANY($8)) AS lost,
                  coalesce(sum(o.total_minor) FILTER (WHERE o.state = ANY($7) AND o.currency = $4), 0) AS gmv,
                  count(DISTINCT o.customer_id) FILTER (WHERE NOT (o.state = ANY($6))) AS customers
             FROM ordering.order_view o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND $5::text IS NOT NULL`,
          [from, to, p[2], ccy, tz, NOT_PLACED, DELIVERED, LOST],
        );
        const placed = Number(r?.placed ?? 0), delivered = Number(r?.delivered ?? 0), lost = Number(r?.lost ?? 0);
        const gmv = BigInt(r?.gmv ?? "0");
        return {
          orders: placed,
          delivered,
          gmv_minor: gmv.toString(),
          aov_minor: delivered ? (gmv / BigInt(delivered)).toString() : "0",
          delivered_rate: placed ? delivered / placed : 0,
          lost_rate: placed ? lost / placed : 0,
          customers: Number(r?.customers ?? 0),
        };
      };

      const daily = await sql.query<{ day: string; orders: string; delivered: string; lost: string; gmv: string; new_customers: string; returning: string }>(
        `WITH days AS (
           SELECT generate_series(date_trunc('day', $1::timestamptz AT TIME ZONE $5), date_trunc('day', $2::timestamptz AT TIME ZONE $5), interval '1 day')::date AS day
         ), firsts AS (
           SELECT o.customer_id, min(o.created_at) AS first_at FROM ordering.order_view o
            WHERE NOT (o.state = ANY($6)) AND ${scope} GROUP BY o.customer_id
         ), placed AS (
           SELECT o.*, (o.created_at AT TIME ZONE $5)::date AS day, f.first_at = o.created_at AS first_order
             FROM ordering.order_view o JOIN firsts f USING (customer_id)
            WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND NOT (o.state = ANY($6))
         )
         SELECT d.day::text,
                count(p.order_id) AS orders,
                count(p.order_id) FILTER (WHERE p.state = ANY($7)) AS delivered,
                count(p.order_id) FILTER (WHERE p.state = ANY($8)) AS lost,
                coalesce(sum(p.total_minor) FILTER (WHERE p.state = ANY($7) AND p.currency = $4), 0) AS gmv,
                count(DISTINCT p.customer_id) FILTER (WHERE p.first_order) AS new_customers,
                count(DISTINCT p.customer_id) FILTER (WHERE NOT p.first_order) AS returning
           FROM days d LEFT JOIN placed p ON p.day = d.day
          GROUP BY d.day ORDER BY d.day`,
        [...p, NOT_PLACED, DELIVERED, LOST],
      );

      const states = await sql.query<{ state: string; n: string }>(
        `SELECT o.state, count(*) AS n FROM ordering.order_view o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND $4::text IS NOT NULL AND $5::text IS NOT NULL GROUP BY o.state`,
        p,
      );

      const FUNNEL = ["PLACED", "ACCEPTED", "READY", "PICKED_UP", "DELIVERED"];
      const funnel = await sql.query<{ stage: string; n: string }>(
        `SELECT e.payload->>'to' AS stage, count(DISTINCT e.order_id) AS n
           FROM ordering.order_event e JOIN ordering.order_view o ON o.order_id = e.order_id
          WHERE e.type = 'STATE_CHANGED' AND e.payload->>'to' = ANY($6) AND o.created_at >= $1 AND o.created_at < $2 AND ${scope}
            AND $4::text IS NOT NULL AND $5::text IS NOT NULL
          GROUP BY 1`,
        [...p, FUNNEL],
      );

      const heat = await sql.query<{ dow: number; hour: number; n: string }>(
        `SELECT extract(isodow FROM o.created_at AT TIME ZONE $5)::int AS dow, extract(hour FROM o.created_at AT TIME ZONE $5)::int AS hour, count(*) AS n
           FROM ordering.order_view o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND NOT (o.state = ANY($6)) AND $4::text IS NOT NULL
          GROUP BY 1, 2`,
        [...p, NOT_PLACED],
      );

      const durations = await sql.query<{ minutes: string }>(
        `SELECT extract(epoch FROM (d.at - pl.at)) / 60 AS minutes
           FROM ordering.order_view o
           JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'PLACED') pl ON true
           JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'DELIVERED') d ON true
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND pl.at IS NOT NULL AND d.at IS NOT NULL AND $4::text IS NOT NULL AND $5::text IS NOT NULL`,
        p,
      );
      const mins = durations.map((d) => Number(d.minutes)).sort((a, b) => a - b);
      const BUCKETS: [string, number, number][] = [["< 15", 0, 15], ["15–25", 15, 25], ["25–35", 25, 35], ["35–45", 35, 45], ["45–60", 45, 60], ["60+", 60, Infinity]];
      const pct = (q: number) => (mins.length ? Math.round(mins[Math.min(mins.length - 1, Math.floor(q * mins.length))]! * 10) / 10 : null);

      const mix = await sql.query<{ dim: string; key: string; n: string }>(
        `SELECT 'type' AS dim, o.type AS key, count(*) AS n FROM ordering.order_view o
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND NOT (o.state = ANY($6)) AND $4::text IS NOT NULL AND $5::text IS NOT NULL GROUP BY o.type
         UNION ALL
         SELECT 'payment_mode', o.payment_mode, count(*) FROM ordering.order_view o
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND NOT (o.state = ANY($6)) GROUP BY o.payment_mode
         UNION ALL
         SELECT 'method', i.method_type, count(*) FROM payments.payment_intent i JOIN ordering.order_view o ON o.order_id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND i.status = 'SUCCEEDED' GROUP BY i.method_type
         UNION ALL
         SELECT 'intent_status', i.status, count(*) FROM payments.payment_intent i JOIN ordering.order_view o ON o.order_id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} GROUP BY i.status`,
        [...p, NOT_PLACED],
      );

      const topBranches = await sql.query<{ id: string; name: string; orders: string; gmv: string }>(
        `SELECT b.id, b.name, count(o.order_id) FILTER (WHERE NOT (o.state = ANY($6))) AS orders,
                coalesce(sum(o.total_minor) FILTER (WHERE o.state = ANY($7) AND o.currency = $4), 0) AS gmv
           FROM catalogue.branch b JOIN ordering.order_view o ON o.branch_id = b.id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND $5::text IS NOT NULL
          GROUP BY b.id, b.name ORDER BY gmv DESC, orders DESC LIMIT 8`,
        [...p, NOT_PLACED, DELIVERED],
      );

      const topDishes = await sql.query<{ name: string; quantity: string }>(
        `SELECT line->>'name' AS name, sum((line->>'quantity')::int) AS quantity
           FROM ordering.order_event e JOIN ordering.order_view o ON o.order_id = e.order_id,
                jsonb_array_elements(e.payload->'snapshot'->'lines') AS line
          WHERE e.type = 'ORDER_DRAFTED' AND o.created_at >= $1 AND o.created_at < $2 AND ${scope} AND NOT (o.state = ANY($6))
            AND $4::text IS NOT NULL AND $5::text IS NOT NULL
          GROUP BY 1 ORDER BY quantity DESC, name LIMIT 10`,
        [...p, NOT_PLACED],
      );

      const riders = await sql.query<{ rider_id: string; name: string | null; deliveries: string }>(
        `SELECT o.rider_id, u.display_name AS name, count(*) AS deliveries
           FROM ordering.order_view o LEFT JOIN identity.app_user u ON u.id::text = o.rider_id
          WHERE o.rider_id IS NOT NULL AND o.state = ANY($6) AND o.created_at >= $1 AND o.created_at < $2 AND ${scope}
            AND $4::text IS NOT NULL AND $5::text IS NOT NULL
          GROUP BY 1, 2 ORDER BY deliveries DESC LIMIT 8`,
        [...p, DELIVERED],
      );

      const marketWide = { type: "scope", country };
      let finance: unknown = null;
      if (this.#can(principal, "ledger:read", marketWide, profile)) {
        const balances = await sql.query<{ account: string; currency: string; balance: string }>(
          "SELECT account, currency, sum(amount_minor)::text AS balance FROM money.ledger_entry WHERE country_iso2 = $1 GROUP BY 1, 2 ORDER BY 1, 2",
          [country],
        );
        const flows = await sql.query<{ day: string; account: string; credit: string }>(
          `WITH days AS (SELECT generate_series(date_trunc('day', $1::timestamptz AT TIME ZONE $4), date_trunc('day', $2::timestamptz AT TIME ZONE $4), interval '1 day')::date AS day)
           SELECT d.day::text, a.account, coalesce(-sum(e.amount_minor) FILTER (WHERE e.amount_minor < 0), 0)::text AS credit
             FROM days d CROSS JOIN unnest($5::text[]) AS a(account)
             LEFT JOIN money.journal j ON (j.posted_at AT TIME ZONE $4)::date = d.day
             LEFT JOIN money.ledger_entry e ON e.journal_id = j.id AND e.account = a.account AND e.country_iso2 = $3 AND e.currency = $6
            GROUP BY d.day, a.account ORDER BY d.day, a.account`,
          [start, end, country, tz, ["restaurant_payable", "rider_payable", "service_charge_revenue", "delivery_fee_revenue"], ccy],
        );
        finance = { balances: balances.map((b) => ({ account: b.account, currency: b.currency, balance_minor: b.balance })), daily_credits: flows.map((f) => ({ day: f.day, account: f.account, amount_minor: f.credit })) };
      }

      let auditStats: unknown = null;
      if (this.#can(principal, "audit:read", marketWide, profile)) {
        const rows = await sql.query<{ day: string; action: string; n: string }>(
          `SELECT (at AT TIME ZONE $3)::date::text AS day, action, count(*) AS n FROM identity.audit_log WHERE at >= $1 AND at < $2 GROUP BY 1, 2 ORDER BY 1`,
          [start, end, tz],
        );
        auditStats = { by_day: rows.map((r) => ({ day: r.day, action: r.action, count: Number(r.n) })), chain: await verifyAuditChain(sql) };
      }

      return {
        period: { days, from: start.toISOString(), to: end.toISOString(), timezone: tz, currency: ccy },
        scope: vis.all ? { kind: "market", country } : { kind: "branches", branches: vis.branches.map((b) => ({ id: b.id, name: b.name })) },
        kpis: { current: await kpi(start, end), previous: await kpi(prevStart, start) },
        daily: daily.map((d) => ({ day: d.day, orders: Number(d.orders), delivered: Number(d.delivered), lost: Number(d.lost), gmv_minor: d.gmv, new_customers: Number(d.new_customers), returning_customers: Number(d.returning) })),
        states: Object.fromEntries(states.map((s) => [s.state, Number(s.n)])),
        state_groups: STATE_GROUPS,
        funnel: FUNNEL.map((stage) => ({ stage, orders: Number(funnel.find((f) => f.stage === stage)?.n ?? 0) })),
        heatmap: heat.map((h) => ({ weekday: h.dow, hour: h.hour, orders: Number(h.n) })),
        delivery_minutes: {
          median: pct(0.5),
          p90: pct(0.9),
          buckets: BUCKETS.map(([label, lo, hi]) => ({ label, orders: mins.filter((m) => m >= lo && m < hi).length })),
        },
        mix: {
          order_type: mix.filter((m) => m.dim === "type").map((m) => ({ key: m.key, orders: Number(m.n) })),
          payment_mode: mix.filter((m) => m.dim === "payment_mode").map((m) => ({ key: m.key, orders: Number(m.n) })),
          payment_method: mix.filter((m) => m.dim === "method").map((m) => ({ key: m.key, payments: Number(m.n) })),
          payment_status: mix.filter((m) => m.dim === "intent_status").map((m) => ({ key: m.key, payments: Number(m.n) })),
        },
        top_branches: topBranches.map((b) => ({ id: b.id, name: b.name, orders: Number(b.orders), gmv_minor: b.gmv })),
        top_dishes: topDishes.map((d) => ({ name: d.name, quantity: Number(d.quantity) })),
        riders: riders.map((r) => ({ rider_id: r.rider_id, name: r.name ?? "Rider", deliveries: Number(r.deliveries) })),
        finance,
        audit: auditStats,
      };
    });
  }

  /** GET /v1/admin/orders */
  async orders(principal: Principal, country: string, filter: { group?: string; limit?: number; before?: string }) {
    const profile = this.#profile(country);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const states = filter.group && filter.group in STATE_GROUPS ? (STATE_GROUPS as Record<string, readonly string[]>)[filter.group] : null;
    if (filter.before && Number.isNaN(Date.parse(filter.before))) throw badRequest("CURSOR_INVALID", "before is an ISO timestamp");
    return this.db.tx({ country }, async (sql) => {
      const vis = await this.#visibility(sql, principal, country, profile);
      if (!vis.all && vis.branches.length === 0) throw forbidden("No orders you can see in this market");
      const rows = await sql.query<Record<string, unknown>>(
        `SELECT o.order_id, o.state, o.type, o.payment_mode, o.total_minor::text AS total_minor, o.currency, o.created_at, o.updated_at,
                o.rider_id, b.name AS branch_name, b.id AS branch_id, u.display_name AS customer_name
           FROM ordering.order_view o JOIN catalogue.branch b ON b.id = o.branch_id LEFT JOIN identity.app_user u ON u.id = o.customer_id
          WHERE ($1::uuid[] IS NULL OR o.branch_id = ANY($1::uuid[])) AND ($2::text[] IS NULL OR o.state = ANY($2::text[]))
            AND ($3::timestamptz IS NULL OR o.created_at < $3)
          ORDER BY o.created_at DESC LIMIT $4`,
        [vis.all ? null : vis.branches.map((b) => b.id), states, filter.before ?? null, limit],
      );
      return { data: rows, next: rows.length === limit ? (rows.at(-1)?.["created_at"] as Date).toISOString() : null };
    });
  }

  /** GET /v1/admin/branches */
  async branches(principal: Principal, country: string) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const vis = await this.#visibility(sql, principal, country, profile);
      const manage = this.#can(principal, "restaurant:manage", { type: "scope", country }, profile);
      const list = vis.all || manage ? await this.#branches(sql) : vis.branches;
      if (list.length === 0 && !manage) throw forbidden("No branches you can see in this market");
      const since = new Date(this.now().getTime() - 30 * 86_400_000);
      const stats = await sql.query<{ branch_id: string; items: string; available: string; orders: string }>(
        `SELECT b.id AS branch_id,
                (SELECT count(*) FROM catalogue.menu_item m WHERE m.branch_id = b.id) AS items,
                (SELECT count(*) FROM catalogue.menu_item m WHERE m.branch_id = b.id AND m.available) AS available,
                (SELECT count(*) FROM ordering.order_view o WHERE o.branch_id = b.id AND o.created_at >= $2 AND NOT (o.state = ANY($3))) AS orders
           FROM catalogue.branch b WHERE b.id = ANY($1::uuid[])`,
        [list.map((b) => b.id), since, NOT_PLACED],
      );
      const by = new Map(stats.map((s) => [s.branch_id, s]));
      return {
        can_create: manage,
        data: list.map((b) => ({ ...b, items: Number(by.get(b.id)?.items ?? 0), available_items: Number(by.get(b.id)?.available ?? 0), orders_30d: Number(by.get(b.id)?.orders ?? 0) })),
      };
    });
  }

  /** GET /v1/admin/payments */
  async payments(principal: Principal, country: string, status?: string) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const vis = await this.#visibility(sql, principal, country, profile);
      if (!vis.all) throw forbidden("Payments are visible to market-wide roles");
      const rows = await sql.query<Record<string, unknown>>(
        `SELECT id, order_id, status, method_type, amount_minor::text AS amount_minor, currency, connector_id, reason_code, payer_country, created_at
           FROM payments.payment_intent WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 100`,
        [status ?? null],
      );
      return { data: rows };
    });
  }

  /** GET /v1/admin/ledger */
  async ledger(principal: Principal, country: string) {
    const profile = this.#profile(country);
    if (!this.#can(principal, "ledger:read", { type: "scope", country }, profile)) throw forbidden("Ledger access needs ledger:read");
    return this.db.tx({ country }, async (sql) => {
      const balances = await sql.query<{ account: string; currency: string; balance: string }>(
        "SELECT account, currency, sum(amount_minor)::text AS balance FROM money.ledger_entry WHERE country_iso2 = $1 GROUP BY 1, 2 ORDER BY 1, 2",
        [country],
      );
      const journals = await sql.query<{ id: string; description: string; posted_at: Date; entries: { account: string; currency: string; amount_minor: string }[] }>(
        `SELECT j.id, j.description, j.posted_at,
                json_agg(json_build_object('account', e.account, 'currency', e.currency, 'amount_minor', e.amount_minor::text) ORDER BY e.line) AS entries
           FROM money.journal j JOIN money.ledger_entry e ON e.journal_id = j.id
          WHERE e.country_iso2 = $1 GROUP BY j.id ORDER BY j.posted_at DESC LIMIT 50`,
        [country],
      );
      return { balances: balances.map((b) => ({ account: b.account, currency: b.currency, balance_minor: b.balance })), journals };
    });
  }

  /** GET /v1/admin/audit */
  async audit(principal: Principal, country: string, limit = 100) {
    const profile = this.#profile(country);
    if (!this.#can(principal, "audit:read", { type: "scope", country }, profile)) throw forbidden("Audit access needs audit:read");
    return this.db.tx({}, async (sql) => {
      const rows = await sql.query<Record<string, unknown>>(
        "SELECT id::text, at, actor, action, target, country_iso2, detail, hash FROM identity.audit_log ORDER BY audit_log.id DESC LIMIT $1",
        [Math.min(Math.max(limit, 1), 500)],
      );
      return { chain: await verifyAuditChain(sql), data: rows };
    });
  }

  // ---------- team and role grants ----------

  async #scopeResource(sql: Sql, country: string, scope: Scope): Promise<ResourceContext> {
    switch (scope.type) {
      case "GROUP":
        return { type: "role_binding", country };
      case "GLOBAL_IDENTITY":
        throw badRequest("SCOPE_NOT_GRANTABLE", "Everyone is a customer already");
      case "COUNTRY":
        if (scope.id !== country) throw badRequest("SCOPE_OTHER_MARKET", `Switch to ${scope.id} to manage roles there`);
        return { type: "role_binding", country };
      case "CITY":
        return { type: "role_binding", country, cityId: scope.id };
      case "ZONE":
        return { type: "role_binding", country, zoneIds: [scope.id] };
      case "RESTAURANT_GROUP":
        return { type: "role_binding", country, restaurantGroupId: scope.id };
      case "BRANCH": {
        const [b] = await sql.query<BranchInfo & Record<string, unknown>>(
          "SELECT id, name, restaurant_group_id, brand_id, city, commune, status FROM catalogue.branch WHERE id::text = $1",
          [scope.id],
        );
        if (!b) throw notFound(`Branch ${scope.id} in ${country}`);
        return { ...this.#branchResource(country, b), type: "role_binding" };
      }
    }
  }

  /** Nobody can give out more than they hold. */
  async #canGrant(sql: Sql, principal: Principal, country: string, profile: CountryProfile, role: Role, scope: Scope): Promise<boolean> {
    if (this.#isSuperAdmin(principal)) return true;
    if (NOT_GRANTABLE.includes(role) || scope.type === "GROUP" || role === "FLEET_PARTNER") return false;
    const resource = await this.#scopeResource(sql, country, scope);
    const manager = MANAGED_BY[role];
    if (manager) return this.#can(principal, manager, resource, profile);
    const zero = { currency: profile.money.settlement_currency, minor: "0" };
    return ROLES[role].grants.every((g) => g.action !== "*" && this.#can(principal, g.action as Action, resource, profile, zero));
  }

  /** GET /v1/admin/team: the role bindings this person could grant (and therefore manage). */
  async team(principal: Principal, country: string) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; user_id: string; role: string; scope_type: string; scope_id: string | null; created_at: Date; display_name: string; phone_e164: string | null }>(
        `SELECT r.id, r.user_id, r.role, r.scope_type, r.scope_id, r.created_at, u.display_name, u.phone_e164
           FROM identity.role_binding r JOIN identity.app_user u ON u.id = r.user_id
          WHERE r.role IS NOT NULL ORDER BY r.created_at DESC`,
      );
      const out = [];
      for (const r of rows) {
        const scope = (r.scope_id ? { type: r.scope_type, id: r.scope_id } : { type: r.scope_type }) as Scope;
        if (scope.type === "COUNTRY" && scope.id !== country) continue;
        let manageable = false;
        try {
          manageable = await this.#canGrant(sql, principal, country, profile, r.role as Role, scope);
        } catch {
          manageable = false;
        }
        if (manageable) out.push({ id: r.id, user: { id: r.user_id, display_name: r.display_name, phone: r.phone_e164 }, role: r.role, scope, since: r.created_at });
      }
      const grantable = (Object.keys(ROLES) as Role[]).filter((r) => !NOT_GRANTABLE.includes(r));
      return { data: out, roles: grantable.map((r) => ({ role: r, scopes: ROLES[r].scopes })) };
    });
  }

  /** POST /v1/admin/role-bindings — by user id or phone (a new phone is invited as an account). */
  async grant(principal: Principal, country: string, input: { user_id?: string; phone?: string; display_name?: string; role: string; scope: Scope }) {
    const profile = this.#profile(country);
    if (!input?.role || !(input.role in ROLES)) throw badRequest("ROLE_INVALID", "Unknown role");
    const role = input.role as Role;
    return this.db.tx({ country }, async (sql) => {
      let userId = input.user_id;
      if (!userId && input.phone) {
        const existing = await userByPhone(sql, input.phone);
        userId = existing?.id ?? (await createUser(sql, { phone: input.phone, displayName: input.display_name?.trim() || "Team member" })).id;
      }
      if (!userId) throw badRequest("USER_REQUIRED", "Give a user_id or a phone number");
      const binding = { id: "new", userId, role, scope: input.scope } as RoleBinding;
      try {
        assertValidBinding(binding);
      } catch (error) {
        throw badRequest("BINDING_INVALID", (error as Error).message);
      }
      if (!(await this.#canGrant(sql, principal, country, profile, role, input.scope))) throw forbidden(`You cannot grant ${role} at this scope: nobody can give out more than they hold`);
      const dup = await sql.query("SELECT 1 FROM identity.role_binding WHERE user_id = $1 AND role = $2 AND scope_type = $3 AND scope_id IS NOT DISTINCT FROM $4", [userId, role, input.scope.type, "id" in input.scope ? input.scope.id : null]);
      if (dup.length) throw conflict("ALREADY_GRANTED", "This person already has that role there");
      const id = await addBinding(sql, { userId, role, scope: input.scope });
      await audit(sql, { actor: principal.userId, action: "role.granted", target: `user:${userId}`, country, detail: { binding: id, role, scope: input.scope } });
      return { id, user_id: userId, role, scope: input.scope };
    });
  }

  /** DELETE /v1/admin/role-bindings/{id} */
  async revoke(principal: Principal, country: string, bindingId: string) {
    const profile = this.#profile(country);
    if (!/^[0-9a-f-]{36}$/.test(bindingId)) throw notFound("Role");
    return this.db.tx({ country }, async (sql) => {
      const [r] = await sql.query<{ id: string; user_id: string; role: string | null; scope_type: string; scope_id: string | null }>(
        "SELECT id, user_id, role, scope_type, scope_id FROM identity.role_binding WHERE id = $1 FOR UPDATE",
        [bindingId],
      );
      if (!r || !r.role) throw notFound("Role");
      const scope = (r.scope_id ? { type: r.scope_type, id: r.scope_id } : { type: r.scope_type }) as Scope;
      if (!(await this.#canGrant(sql, principal, country, profile, r.role as Role, scope))) throw forbidden("You cannot remove a role you could not grant");
      if (r.role === "SUPER_ADMIN") {
        const [n] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM identity.role_binding WHERE role = 'SUPER_ADMIN'");
        if (Number(n?.n ?? 0) <= 1) throw conflict("LAST_SUPER_ADMIN", "The platform must keep at least one Super Admin");
      }
      await sql.query("DELETE FROM identity.role_binding WHERE id = $1", [bindingId]);
      await audit(sql, { actor: principal.userId, action: "role.revoked", target: `user:${r.user_id}`, country, detail: { binding: bindingId, role: r.role, scope } });
      return { revoked: bindingId };
    });
  }

  /** GET /v1/admin/users?phone= — exact lookup, for anyone who can grant roles. */
  async findUser(principal: Principal, country: string, phone: string) {
    const caps = (await this.me(principal, country)).capabilities;
    if (!caps["team"]) throw forbidden("Looking people up needs the right to grant roles");
    return this.db.tx({}, async (sql) => {
      const u = await userByPhone(sql, phone);
      if (!u) throw notFound("Nobody with that phone number yet");
      return { id: u.id, display_name: u.display_name, phone: u.phone_e164, status: u.status };
    });
  }

  /**
   * GET /v1/kitchen/orders[?branch_id=]: the kitchen board. Orders being handled at the branches this
   * person can prepare for, oldest first, plus what left the counter in the last two hours.
   */
  async kitchen(principal: Principal, country: string, branchId?: string) {
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const vis = await this.#visibility(sql, principal, country, profile, "order:prepare");
      let list = vis.branches;
      if (list.length === 0) throw forbidden("You do not work in a kitchen in this market");
      if (branchId) list = list.filter((b) => b.id === branchId);
      if (branchId && list.length === 0) throw forbidden("You do not work at this branch");
      const ids = list.map((b) => b.id);
      const status = await sql.query<{ id: string; status: string }>("SELECT id, status FROM catalogue.branch WHERE id = ANY($1::uuid[])", [ids]);
      const statusOf = new Map(status.map((r) => [r.id, r.status]));
      const since = new Date(this.now().getTime() - 2 * 3_600_000);
      const rows = await sql.query<{
        order_id: string; state: string; type: string; payment_mode: string; total_minor: string; currency: string; created_at: Date; updated_at: Date;
        branch_id: string; customer_name: string | null; rider_id: string | null; rider_name: string | null; lines: unknown; times: Record<string, string> | null;
        packages: number | null; labels: string[] | null; confirmation_model: string | null;
      }>(
        `SELECT o.order_id, o.state, o.type, o.payment_mode, o.total_minor::text AS total_minor, o.currency, o.created_at, o.updated_at, o.branch_id,
                u.display_name AS customer_name, o.rider_id, r.display_name AS rider_name,
                (SELECT d.payload->'snapshot'->'lines' FROM ordering.order_event d WHERE d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED' LIMIT 1) AS lines,
                (SELECT d.payload->'snapshot'->>'confirmationModel' FROM ordering.order_event d WHERE d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED' LIMIT 1) AS confirmation_model,
                (SELECT jsonb_object_agg(e.payload->>'to', e.at) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED') AS times,
                (SELECT (e.payload->'evidence'->>'packageCount')::int FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'PACKED' ORDER BY e.seq DESC LIMIT 1) AS packages,
                (SELECT array(SELECT jsonb_array_elements_text(e.payload->'evidence'->'labelIds')) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'READY' ORDER BY e.seq DESC LIMIT 1) AS labels
           FROM ordering.order_view o
           LEFT JOIN identity.app_user u ON u.id = o.customer_id
           LEFT JOIN identity.app_user r ON r.id::text = o.rider_id
          WHERE o.branch_id = ANY($1::uuid[])
            AND (o.state = ANY($2) OR (o.state = ANY($3) AND o.updated_at >= $4))
          ORDER BY o.created_at ASC LIMIT 200`,
        [ids, KITCHEN_ACTIVE, KITCHEN_DONE, since],
      );
      return {
        now: this.now().toISOString(),
        branches: list.map((b) => ({
          id: b.id, name: b.name, commune: b.commune, status: statusOf.get(b.id) ?? "OPEN",
          can_pause: this.#can(principal, "availability:write", this.#branchResource(country, b), profile),
        })),
        orders: rows.map((o) => ({
          order_id: o.order_id,
          ref: o.order_id.slice(-5).toUpperCase(),
          state: o.state,
          type: o.type,
          payment_mode: o.payment_mode,
          total: { amount_minor: o.total_minor, currency: o.currency },
          branch_id: o.branch_id,
          customer: o.customer_name && o.customer_name !== "Tunakula customer" ? o.customer_name.split(/\s+/)[0] : null,
          rider: o.rider_id ? { id: o.rider_id, name: o.rider_name ?? "Rider" } : null,
          lines: ((o.lines ?? []) as { id: string; name: string; quantity: number; options?: string[]; allergenFlags?: string[]; note?: string }[]).map((l) => ({
            id: l.id, name: l.name, quantity: l.quantity, options: l.options ?? [], allergens: l.allergenFlags ?? [], ...(l.note ? { note: l.note } : {}),
          })),
          confirmation_model: o.confirmation_model ?? "RESTAURANT_FIRST",
          packages: o.packages ?? null,
          labels: o.labels ?? [],
          times: Object.fromEntries(Object.entries(o.times ?? {}).map(([k, v]) => [k, new Date(v).toISOString()])),
          created_at: new Date(o.created_at).toISOString(),
        })),
      };
    });
  }

  /** POST /v1/kitchen/branches/:id/status: stop or resume taking new orders (busy, out of gas, closing early). */
  async setBranchStatus(principal: Principal, country: string, branchId: string, status: string, reason?: string) {
    if (!["OPEN", "PAUSED"].includes(status)) throw badRequest("STATUS_INVALID", "Status is OPEN or PAUSED");
    const profile = this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const branch = (await this.#branches(sql)).find((b) => b.id === branchId);
      if (!branch) throw notFound("Branch");
      if (!this.#can(principal, "availability:write", this.#branchResource(country, branch), profile)) throw forbidden("Pausing orders needs a manager or the owner");
      const [row] = await sql.query<{ status: string }>("UPDATE catalogue.branch SET status = $2, updated_at = now() WHERE id = $1 RETURNING status", [branchId, status]);
      await audit(sql, { actor: principal.userId, action: status === "PAUSED" ? "branch.paused" : "branch.resumed", target: `branch:${branchId}`, country, ...(reason ? { detail: { reason } } : {}) });
      return { id: branchId, status: row?.status ?? status };
    });
  }
}

function publicBinding(b: RoleBinding) {
  return { id: b.id, role: "role" in b ? b.role : `profile:${b.profile.name}`, scope: b.scope };
}
