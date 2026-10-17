/**
 * Loyalty points. A customer earns points on every delivered order (a rate per amount spent, set per market)
 * and redeems them for wallet credit. The balance is the running sum of an append-only points ledger
 * (wallet.loyalty_point). Redeeming credits the wallet, funded by the platform from promotion_expense through
 * the wallet's creditFromPromotion — so the money books stay balanced and points cost the platform only when
 * they are spent. Additive; it reuses the wallet and the ledger. The StackFood / Just Eat loyalty feature.
 */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import type { WalletService } from "./wallet.ts";
import { badRequest, forbidden, notFound, unprocessable } from "./errors.ts";

interface Config { enabled: boolean; earn_bps: number; redeem_minor_per_point: number; min_redeem_points: number }
const DEFAULT_CONFIG: Config = { enabled: true, earn_bps: 100, redeem_minor_per_point: 1, min_redeem_points: 100 };

export class LoyaltyService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly wallet: WalletService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, wallet: WalletService, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.wallet = wallet;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** The market's loyalty settings (defaults until an admin changes them). */
  async config(sql: Sql, country: string): Promise<Config> {
    const [row] = await sql.query<Config & Record<string, unknown>>("SELECT enabled, earn_bps, redeem_minor_per_point, min_redeem_points FROM wallet.loyalty_config WHERE country_iso2 = $1", [country]);
    return row ? { enabled: row.enabled, earn_bps: Number(row.earn_bps), redeem_minor_per_point: Number(row.redeem_minor_per_point), min_redeem_points: Number(row.min_redeem_points) } : DEFAULT_CONFIG;
  }

  /** The customer's points balance right now. */
  async balance(sql: Sql, country: string, userId: string): Promise<number> {
    const [row] = await sql.query<{ total: string | null }>("SELECT coalesce(sum(points),0)::text AS total FROM wallet.loyalty_point WHERE user_id = $1 AND country_iso2 = $2", [userId, country]);
    return Number(row?.total ?? "0");
  }

  /** Records a signed points movement and returns the new balance. Debits are refused when the balance is short. */
  async #move(sql: Sql, country: string, userId: string, points: number, kind: "EARN" | "REDEEM" | "ADJUSTMENT", opts: { orderId?: string; reference?: string } = {}): Promise<number> {
    const current = await this.balance(sql, country, userId);
    const after = current + points;
    if (after < 0) throw unprocessable("INSUFFICIENT_POINTS", "You do not have enough points for that");
    await sql.query(
      "INSERT INTO wallet.loyalty_point (country_iso2, user_id, points, kind, order_id, reference, balance_after) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [country, userId, points, kind, opts.orderId ?? null, opts.reference ?? null, after],
    );
    return after;
  }

  /** GET /v1/me/loyalty — the customer's balance, what a point is worth, and the current rules. */
  async summary(country: string, principal: Principal) {
    const settlement = this.profile(country).money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const cfg = await this.config(sql, country);
      const points = await this.balance(sql, country, principal.userId);
      const worth = Money.ofMinor(BigInt(points * cfg.redeem_minor_per_point), settlement);
      return {
        enabled: cfg.enabled,
        points,
        point_value: { amount_minor: String(cfg.redeem_minor_per_point), currency: settlement },
        worth: { amount_minor: worth.minor.toString(), currency: settlement },
        min_redeem_points: cfg.min_redeem_points,
        earn_bps: cfg.earn_bps,
      };
    });
  }

  /** GET /v1/me/loyalty/transactions — recent points movements, newest first. */
  async history(country: string, principal: Principal, limit = 50) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; points: string; kind: string; order_id: string | null; balance_after: string; created_at: Date }>(
        "SELECT id, points::text AS points, kind, order_id, balance_after::text AS balance_after, created_at FROM wallet.loyalty_point WHERE user_id = $1 AND country_iso2 = $2 ORDER BY created_at DESC LIMIT $3",
        [principal.userId, country, Math.min(Math.max(limit, 1), 100)],
      );
      return { transactions: rows.map((r) => ({ id: r.id, points: Number(r.points), kind: r.kind, order_id: r.order_id, balance_after: Number(r.balance_after), created_at: new Date(r.created_at).toISOString() })) };
    });
  }

  /** POST /v1/me/loyalty/redeem — turn points into wallet credit. Idempotent on the request key. */
  async redeem(country: string, principal: Principal, points: number, idempotencyKey: string) {
    const settlement = this.profile(country).money.settlement_currency;
    if (!Number.isInteger(points) || points <= 0) throw badRequest("POINTS_INVALID", "Redeem a whole number of points");
    return this.db.tx({ country }, async (sql) => {
      const cfg = await this.config(sql, country);
      if (!cfg.enabled) throw unprocessable("LOYALTY_DISABLED", "Loyalty points are not available in this market");
      // Idempotency: a repeat of the same request returns the balance without redeeming again.
      const [prior] = await sql.query<{ id: string }>("SELECT id FROM wallet.loyalty_point WHERE country_iso2 = $1 AND kind = 'REDEEM' AND reference = $2", [country, idempotencyKey]);
      if (prior) {
        const balance = await this.balance(sql, country, principal.userId);
        const wallet = await this.wallet.balance(sql, country, principal.userId, settlement);
        return { points_balance: balance, wallet_balance: { amount_minor: wallet.minor.toString(), currency: settlement } };
      }
      if (points < cfg.min_redeem_points) throw unprocessable("BELOW_MIN_REDEEM", `Redeem at least ${cfg.min_redeem_points} points`);
      const credit = Money.ofMinor(BigInt(points) * BigInt(cfg.redeem_minor_per_point), settlement);
      const after = await this.#move(sql, country, principal.userId, -points, "REDEEM", { reference: idempotencyKey });
      await this.wallet.creditFromPromotion(sql, country, principal.userId, credit, "LOYALTY", `loyalty:${idempotencyKey}`);
      const wallet = await this.wallet.balance(sql, country, principal.userId, settlement);
      await audit(sql, { actor: principal.userId, action: "loyalty.redeemed", target: `user:${principal.userId}`, country, detail: { points, credit_minor: credit.minor.toString() } });
      return { points_balance: after, credited: { amount_minor: credit.minor.toString(), currency: settlement }, wallet_balance: { amount_minor: wallet.minor.toString(), currency: settlement } };
    });
  }

  /**
   * Awards points on delivered orders that have not been awarded yet. Points = floor(spend_minor * earn_bps / 10000).
   * Runs on the operations loop alongside the other sweeps. Idempotent (one EARN per order).
   */
  async awardSweep(country: string): Promise<{ awarded: number }> {
    const cfg = await this.db.tx({ country }, (sql) => this.config(sql, country));
    if (!cfg.enabled || cfg.earn_bps <= 0) return { awarded: 0 };
    const due = await this.db.tx({ country }, (sql) => sql.query<{ order_id: string; customer_id: string; total_minor: string }>(
      `SELECT o.order_id, o.customer_id, o.total_minor::text AS total_minor
         FROM ordering.order_view o
        WHERE o.state = 'DELIVERED' AND o.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM wallet.loyalty_point p WHERE p.order_id = o.order_id AND p.kind = 'EARN')
        LIMIT 100`,
    ));
    let awarded = 0;
    for (const d of due) {
      const points = Number((BigInt(d.total_minor) * BigInt(cfg.earn_bps)) / 10000n);
      await this.db.tx({ country }, async (sql) => {
        if (points > 0) {
          try { await this.#move(sql, country, d.customer_id, points, "EARN", { orderId: d.order_id }); }
          catch (e) { if (!/duplicate key|unique/i.test((e as Error).message)) throw e; } // already awarded (idempotent)
        }
      });
      if (points > 0) awarded++;
    }
    return { awarded };
  }

  /** Admin: read the market's loyalty settings. */
  async adminConfig(country: string, principal: Principal) {
    this.#assertAdmin(principal, country);
    return this.db.tx({ country }, (sql) => this.config(sql, country));
  }

  /** Admin: set the market's loyalty settings. */
  async setConfig(country: string, principal: Principal, input: Partial<Config>) {
    this.#assertAdmin(principal, country);
    const cur = await this.db.tx({ country }, (sql) => this.config(sql, country));
    const next: Config = {
      enabled: input.enabled ?? cur.enabled,
      earn_bps: clampInt(input.earn_bps ?? cur.earn_bps, 0, 5000),
      redeem_minor_per_point: clampInt(input.redeem_minor_per_point ?? cur.redeem_minor_per_point, 1, 100000),
      min_redeem_points: clampInt(input.min_redeem_points ?? cur.min_redeem_points, 1, 1000000),
    };
    return this.db.tx({ country }, async (sql) => {
      await sql.query(
        `INSERT INTO wallet.loyalty_config (country_iso2, enabled, earn_bps, redeem_minor_per_point, min_redeem_points, updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (country_iso2) DO UPDATE SET enabled = EXCLUDED.enabled, earn_bps = EXCLUDED.earn_bps,
           redeem_minor_per_point = EXCLUDED.redeem_minor_per_point, min_redeem_points = EXCLUDED.min_redeem_points, updated_at = now()`,
        [country, next.enabled, next.earn_bps, next.redeem_minor_per_point, next.min_redeem_points],
      );
      await audit(sql, { actor: principal.userId, action: "loyalty.config_set", target: `country:${country}`, country, detail: next as unknown as Record<string, string> });
      return next;
    });
  }

  #assertAdmin(principal: Principal, country: string): void {
    const profile = this.profile(country);
    if (!authorize(principal, "membership:manage", { type: "order", country }, { activeCountry: country, profile }).allowed) throw forbidden("Loyalty settings are managed by a market admin");
  }
}

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
