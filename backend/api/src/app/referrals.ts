/**
 * Referral program. Every customer has a permanent, shareable referral code. A new customer who applies a
 * code (the referee) gets a discount on their first order; the referrer earns a reward, held until that
 * referee has spent a threshold on the platform, then credited to the referrer's wallet as real, spendable
 * money (the platform funds it from promotion_expense). Amounts are in the market's settlement currency.
 * Additive: it layers on the wallet and reads delivered-order spend.
 */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import type { WalletService } from "./wallet.ts";
import { badRequest, conflict, notFound, unprocessable } from "./errors.ts";

/** The referrer's reward, the spend that unlocks it, and the referee's first-order discount. */
const REWARD_MAJOR = "10";
const SPEND_THRESHOLD_MAJOR = "50";
const FIRST_ORDER_DISCOUNT_BPS = 1000; // 10% off the referee's first order
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes (0/O, 1/I)

export class ReferralService {
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

  private amounts(country: string) {
    const ccy = this.profile(country).money.settlement_currency;
    return { reward: Money.of(REWARD_MAJOR, ccy), threshold: Money.of(SPEND_THRESHOLD_MAJOR, ccy), ccy };
  }

  /** The customer's own code (created on first access) with how it is doing. */
  async myCode(country: string, principal: Principal) {
    const { reward, threshold } = this.amounts(country);
    return this.db.tx({ country }, async (sql) => {
      const code = await this.#ensureCode(sql, country, principal.userId);
      const [stats] = await sql.query<{ total: string; unlocked: string }>(
        "SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'UNLOCKED')::text AS unlocked FROM referral.claim WHERE referrer_user_id = $1",
        [principal.userId],
      );
      const unlocked = Number(stats?.unlocked ?? 0);
      return {
        code,
        reward: wire(reward),
        spend_threshold: wire(threshold),
        friend_discount_pct: FIRST_ORDER_DISCOUNT_BPS / 100,
        invited: Number(stats?.total ?? 0),
        rewarded: unlocked,
        earned: wire(reward.multiply(BigInt(unlocked))),
      };
    });
  }

  /** The referee applies a code. Allowed once, for a new customer, and not their own code. */
  async claim(country: string, principal: Principal, rawCode: string) {
    const code = String(rawCode ?? "").trim().toUpperCase();
    if (!code) throw badRequest("CODE_REQUIRED", "Enter a referral code");
    const { reward, threshold, ccy } = this.amounts(country);
    return this.db.tx({ country }, async (sql) => {
      const [owner] = await sql.query<{ user_id: string }>("SELECT user_id FROM referral.code WHERE code = $1", [code]);
      if (!owner) throw notFound("Referral code");
      if (owner.user_id === principal.userId) throw unprocessable("CANNOT_REFER_SELF", "You cannot use your own referral code");
      const [claimed] = await sql.query<{ id: string }>("SELECT id FROM referral.claim WHERE referee_user_id = $1", [principal.userId]);
      if (claimed) throw conflict("ALREADY_REFERRED", "You have already used a referral code");
      const [orders] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_view WHERE customer_id = $1", [principal.userId]);
      if (Number(orders?.n ?? 0) > 0) throw unprocessable("NOT_NEW_CUSTOMER", "A referral code can only be used before your first order");
      const [row] = await sql.query<{ id: string }>(
        `INSERT INTO referral.claim (country_iso2, code, referrer_user_id, referee_user_id, reward_minor, threshold_minor, currency, discount_bps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [country, code, owner.user_id, principal.userId, reward.minor.toString(), threshold.minor.toString(), ccy, FIRST_ORDER_DISCOUNT_BPS],
      );
      await audit(sql, { actor: principal.userId, action: "referral.claimed", target: `referral:${code}`, country });
      return { id: row?.id, status: "PENDING" as const, first_order_discount_pct: FIRST_ORDER_DISCOUNT_BPS / 100 };
    });
  }

  /** The referee's own claim: whether their first-order discount is still available or already used. */
  async status(country: string, principal: Principal) {
    return this.db.tx({ country }, async (sql) => {
      const [c] = await sql.query<{ discount_bps: number; discount_used_at: Date | null }>(
        "SELECT discount_bps, discount_used_at FROM referral.claim WHERE referee_user_id = $1",
        [principal.userId],
      );
      if (!c) return { claim: null };
      const [orders] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_view WHERE customer_id = $1", [principal.userId]);
      const available = c.discount_used_at === null && Number(orders?.n ?? 0) === 0;
      return {
        claim: {
          first_order_discount_pct: c.discount_bps / 100,
          discount_available: available,
          discount_used: c.discount_used_at !== null,
        },
      };
    });
  }

  /** The referee's first-order discount, if they still have one (a pending claim, discount unused, no orders yet). */
  async firstOrderDiscount(sql: Sql, _country: string, customerId: string): Promise<{ claimId: string; bps: number } | null> {
    const [c] = await sql.query<{ id: string; discount_bps: number }>(
      "SELECT id, discount_bps FROM referral.claim WHERE referee_user_id = $1 AND discount_used_at IS NULL",
      [customerId],
    );
    if (!c || c.discount_bps <= 0) return null;
    const [orders] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_view WHERE customer_id = $1", [customerId]);
    if (Number(orders?.n ?? 0) > 0) return null;
    return { claimId: c.id, bps: c.discount_bps };
  }

  /** Marks a referee's first-order discount as used (called when their order is placed). Idempotent. */
  async consumeDiscount(sql: Sql, claimId: string): Promise<void> {
    await sql.query("UPDATE referral.claim SET discount_used_at = $2, updated_at = $2 WHERE id = $1 AND discount_used_at IS NULL", [claimId, this.now()]);
  }

  /**
   * Unlocks every pending claim whose referee has now spent the threshold: credits the referrer's wallet
   * with the reward and marks the claim UNLOCKED. Runs on the dispatch loop. Idempotent.
   */
  async unlockSweep(country: string): Promise<{ unlocked: number }> {
    const pending = await this.db.tx({ country }, (sql) => sql.query<{ id: string; referrer_user_id: string; referee_user_id: string; reward_minor: string; threshold_minor: string; currency: string }>(
      "SELECT id, referrer_user_id, referee_user_id, reward_minor::text AS reward_minor, threshold_minor::text AS threshold_minor, currency FROM referral.claim WHERE status = 'PENDING' LIMIT 100",
    ));
    let unlocked = 0;
    for (const c of pending) {
      await this.db.tx({ country }, async (sql) => {
        const spent = await this.#spend(sql, c.referee_user_id, c.currency);
        if (spent.minor < BigInt(c.threshold_minor)) return;
        const reward = Money.ofMinor(BigInt(c.reward_minor), c.currency);
        await this.wallet.creditFromPromotion(sql, country, c.referrer_user_id, reward, "REFERRAL", `referral:${c.id}:referrer`);
        await sql.query("UPDATE referral.claim SET status = 'UNLOCKED', unlocked_at = $2, updated_at = $2 WHERE id = $1 AND status = 'PENDING'", [c.id, this.now()]);
        await audit(sql, { actor: c.referee_user_id, action: "referral.unlocked", target: `referral:${c.id}`, country, detail: { reward_minor: c.reward_minor } });
        unlocked++;
      });
    }
    return { unlocked };
  }

  /** The referee's cumulative spend: the total of their delivered orders in this currency. */
  async #spend(sql: Sql, userId: string, currency: string): Promise<Money> {
    const [row] = await sql.query<{ total: string | null }>(
      "SELECT coalesce(sum(total_minor),0)::text AS total FROM ordering.order_view WHERE customer_id = $1 AND state = 'DELIVERED' AND currency = $2",
      [userId, currency],
    );
    return Money.ofMinor(BigInt(row?.total ?? "0"), currency);
  }

  async #ensureCode(sql: Sql, country: string, userId: string): Promise<string> {
    const [existing] = await sql.query<{ code: string }>("SELECT code FROM referral.code WHERE user_id = $1", [userId]);
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = this.#generate();
      const [clash] = await sql.query<{ code: string }>("SELECT code FROM referral.code WHERE code = $1", [code]);
      if (clash) continue;
      await sql.query("INSERT INTO referral.code (user_id, country_iso2, code) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING", [userId, country, code]);
      const [saved] = await sql.query<{ code: string }>("SELECT code FROM referral.code WHERE user_id = $1", [userId]);
      if (saved) return saved.code;
    }
    throw unprocessable("CODE_GENERATION_FAILED", "Could not allocate a referral code; try again");
  }

  #generate(): string {
    let out = "";
    for (let i = 0; i < 7; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
  }
}

const wire = (m: Money) => ({ amount_minor: m.minor.toString(), currency: m.currency });
