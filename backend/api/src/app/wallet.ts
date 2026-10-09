/**
 * In-app customer wallet. A customer tops up through the same payment providers, pays for orders from
 * the balance (including partial payment, the rest on another method), and is refunded to the wallet.
 * The balance is the running sum of an append-only ledger (wallet.transaction); each move mirrors into
 * the money.customer_wallet ledger account so the platform books stay balanced. Additive.
 */
import { Money, type MoneyJSON } from "@tunakula/ts-money";
import type { CountryProfile, PaymentMethodType } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { createJournal, type LedgerEntry } from "../modules/money/journal.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { postJournal } from "../persistence/ledger.ts";
import { audit } from "../persistence/identity.ts";
import type { CommerceService } from "./commerce.ts";
import type { PaymentService } from "./payments.ts";
import { badRequest, notFound, unprocessable } from "./errors.ts";

type TxKind = "TOPUP" | "ORDER_PAYMENT" | "REFUND" | "ADJUSTMENT";
const MIN_TOPUP_MINOR = 100n; // at least one major unit

export class WalletService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly payments: PaymentService;
  private readonly commerce: CommerceService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, payments: PaymentService, commerce: CommerceService, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.payments = payments;
    this.commerce = commerce;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** The balance in one currency as held right now. */
  async balance(sql: Sql, country: string, userId: string, currency: string): Promise<Money> {
    const [row] = await sql.query<{ total: string | null }>(
      "SELECT coalesce(sum(amount_minor),0)::text AS total FROM wallet.transaction WHERE user_id = $1 AND country_iso2 = $2 AND currency = $3",
      [userId, country, currency],
    );
    return Money.ofMinor(BigInt(row?.total ?? "0"), currency);
  }

  /** Every currency the customer holds a balance in, plus the market's settlement currency at zero. */
  async balances(country: string, principal: Principal) {
    const settlement = this.profile(country).money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ currency: string; total: string }>(
        "SELECT currency, sum(amount_minor)::text AS total FROM wallet.transaction WHERE user_id = $1 AND country_iso2 = $2 GROUP BY currency",
        [principal.userId, country],
      );
      const byCcy = new Map(rows.map((r) => [r.currency, r.total]));
      if (!byCcy.has(settlement)) byCcy.set(settlement, "0");
      return { balances: [...byCcy].map(([currency, minor]) => ({ amount_minor: minor, currency })) };
    });
  }

  /** The customer's recent wallet movements, newest first. */
  async history(country: string, principal: Principal, limit = 50) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; amount_minor: string; kind: string; order_id: string | null; reference: string | null; balance_after: string; currency: string; created_at: Date }>(
        `SELECT id, amount_minor::text AS amount_minor, kind, order_id, reference, balance_after::text AS balance_after, currency, created_at
           FROM wallet.transaction WHERE user_id = $1 AND country_iso2 = $2 ORDER BY created_at DESC LIMIT $3`,
        [principal.userId, country, Math.min(Math.max(limit, 1), 100)],
      );
      return {
        transactions: rows.map((r) => ({
          id: r.id, kind: r.kind, amount: { amount_minor: r.amount_minor, currency: r.currency },
          balance_after: { amount_minor: r.balance_after, currency: r.currency },
          order_id: r.order_id, reference: r.reference, created_at: new Date(r.created_at).toISOString(),
        })),
      };
    });
  }

  /** Records a signed movement and returns the new balance. Debits are refused when the balance is short. */
  async #move(sql: Sql, country: string, userId: string, amount: Money, kind: TxKind, opts: { orderId?: string; reference?: string } = {}): Promise<Money> {
    const current = await this.balance(sql, country, userId, amount.currency);
    const after = current.add(amount);
    if (after.minor < 0n) throw unprocessable("INSUFFICIENT_WALLET_BALANCE", "Your wallet balance is too low for this payment");
    await sql.query(
      `INSERT INTO wallet.transaction (country_iso2, user_id, currency, amount_minor, kind, order_id, reference, balance_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [country, userId, amount.currency, amount.minor.toString(), kind, opts.orderId ?? null, opts.reference ?? null, after.minor.toString()],
    );
    return after;
  }

  /** Debits the wallet for an order (used by the order placement transaction). Idempotent per order. */
  async payForOrder(sql: Sql, country: string, userId: string, orderId: string, total: Money): Promise<void> {
    const [existing] = await sql.query<{ id: string }>("SELECT id FROM wallet.transaction WHERE order_id = $1 AND kind = 'ORDER_PAYMENT'", [orderId]);
    if (existing) return;
    await this.#move(sql, country, userId, total.negate(), "ORDER_PAYMENT", { orderId });
  }

  /** Credits a wallet-funded order back to the wallet (on cancellation before delivery). Idempotent per order. */
  async refundOrder(sql: Sql, country: string, userId: string, orderId: string, total: Money): Promise<boolean> {
    const [existing] = await sql.query<{ id: string }>("SELECT id FROM wallet.transaction WHERE order_id = $1 AND kind = 'REFUND'", [orderId]);
    if (existing) return false;
    await this.#move(sql, country, userId, total, "REFUND", { orderId });
    return true;
  }

  /**
   * Credits wallet-funded orders that ended before delivery (cancelled, rejected, delivery failed) back to the
   * wallet, then moves each to REFUNDED. Runs on the same loop as the provider refund sweep. Idempotent.
   */
  async refundSweep(country: string): Promise<{ refunded: number }> {
    const due = await this.db.tx({ country }, (sql) => sql.query<{ order_id: string; customer_id: string; total_minor: string; currency: string }>(
      `SELECT o.order_id, o.customer_id, o.total_minor::text AS total_minor, o.currency
         FROM ordering.order_view o
         JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
        WHERE o.state IN ('CANCELLED', 'REJECTED', 'DELIVERY_FAILED')
          AND (d.payload->'snapshot'->>'walletFunded') = 'true'
          AND NOT EXISTS (SELECT 1 FROM wallet.transaction w WHERE w.order_id = o.order_id AND w.kind = 'REFUND')
        LIMIT 50`,
    ));
    let refunded = 0;
    for (const d of due) {
      await this.db.tx({ country }, async (sql) => {
        const credited = await this.refundOrder(sql, country, d.customer_id, d.order_id, Money.ofMinor(BigInt(d.total_minor), d.currency));
        if (credited) {
          await this.commerce.systemCommand(sql, country, d.order_id, `wallet-refund:${d.order_id}`, { type: "REFUND", reasonCode: "WALLET_REFUND" }, "wallet");
        }
      });
      refunded++;
    }
    return { refunded };
  }

  /** Customer: top up the wallet through a payment provider. On a synchronous success the balance rises at once. */
  async topup(country: string, principal: Principal, input: { amountMinor: string; currency?: string; methodType: PaymentMethodType; payer: { msisdn?: string; token?: string } }, idempotencyKey: string) {
    const profile = this.profile(country);
    const currency = (input.currency ?? profile.money.settlement_currency).toUpperCase();
    let amount: Money;
    try { amount = Money.ofMinor(BigInt(input.amountMinor), currency); } catch { throw badRequest("AMOUNT_INVALID", "Send a whole amount in minor units"); }
    if (amount.minor < MIN_TOPUP_MINOR) throw badRequest("AMOUNT_TOO_SMALL", "Top up at least one unit");
    // Idempotency: a repeat of the same request returns the balance without charging again.
    const prior = await this.db.tx({ country }, (sql) => sql.query<{ id: string }>("SELECT id FROM wallet.transaction WHERE country_iso2 = $1 AND kind = 'TOPUP' AND reference = $2", [country, idempotencyKey]));
    if (prior[0]) return this.db.tx({ country }, async (sql) => ({ status: "SUCCEEDED" as const, balance: wire(await this.balance(sql, country, principal.userId, currency)) }));

    const charge = await this.payments.chargeStandalone(country, { amount: { currency, minor: amount.minor.toString() }, methodType: input.methodType, payerCountry: country, payer: input.payer, description: "Tunakula wallet top-up" }, `wallet-topup:${idempotencyKey}`);
    if (charge.status !== "SUCCEEDED") {
      return { status: charge.status, ...(charge.reasonCode ? { reason_code: charge.reasonCode } : {}) };
    }
    return this.db.tx({ country }, async (sql) => {
      const after = await this.#move(sql, country, principal.userId, amount, "TOPUP", { reference: idempotencyKey });
      // The customer's cash came in to the platform and is now owed back to them as stored value.
      const entries: LedgerEntry[] = [
        { account: "psp_clearing", country, amount },
        { account: "customer_wallet", country, amount: amount.negate() },
      ];
      await postJournal(sql, createJournal({ id: `wallet-topup:${idempotencyKey}`, idempotencyKey: `wallet-topup:${idempotencyKey}`, description: "Wallet top-up", entries, postedAt: this.now() }));
      await audit(sql, { actor: principal.userId, action: "wallet.topup", target: `wallet:${principal.userId}`, country, detail: { amount_minor: amount.minor.toString(), currency } });
      return { status: "SUCCEEDED" as const, balance: wire(after) };
    });
  }
}

const wire = (m: Money): MoneyJSON | { amount_minor: string; currency: string } => ({ amount_minor: m.minor.toString(), currency: m.currency });
