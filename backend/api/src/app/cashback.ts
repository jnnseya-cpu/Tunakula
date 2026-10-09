/**
 * Cashback campaigns. A market admin runs a time-boxed "X% back to your wallet" promotion; a delivered order
 * placed while a campaign is live earns cashback, credited to the customer's wallet by a sweep on the operations
 * loop. The platform funds it from promotion_expense through the wallet's creditFromPromotion, so the money books
 * stay balanced and cashback costs the platform only when it is earned. Idempotent (one award per order).
 * Additive; it reuses the wallet. The Uber Eats / Deliveroo promotional-cashback feature.
 */
import { Money } from "@tunakula/ts-money";
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import type { WalletService } from "./wallet.ts";
import { badRequest, forbidden, notFound, unprocessable } from "./errors.ts";

export interface CampaignRow {
  id: string; name: string; percent_bps: number;
  min_spend_minor: string; max_cashback_minor: string | null;
  starts_at: Date; ends_at: Date; active: boolean;
}
interface CampaignInput {
  name?: string; percent_bps?: number;
  min_spend?: string | number | null; max_cashback?: string | number | null;
  starts_at?: string; ends_at?: string; active?: boolean;
}

export class CashbackService {
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

  /** GET /v1/cashback — the live offer a customer can earn right now (the best active campaign), or null. */
  async offer(country: string) {
    const ccy = this.profile(country).money.settlement_currency;
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const [c] = await sql.query<CampaignRow & Record<string, unknown>>(
        `SELECT id, name, percent_bps, min_spend_minor::text AS min_spend_minor, max_cashback_minor::text AS max_cashback_minor, starts_at, ends_at, active
           FROM wallet.cashback_campaign
          WHERE active = true AND starts_at <= $1 AND ends_at > $1
          ORDER BY percent_bps DESC LIMIT 1`,
        [now],
      );
      if (!c) return { offer: null };
      return {
        offer: {
          name: c.name, percent: c.percent_bps / 100,
          min_spend: { amount_minor: c.min_spend_minor, currency: ccy },
          max_cashback: c.max_cashback_minor ? { amount_minor: c.max_cashback_minor, currency: ccy } : null,
          ends_at: new Date(c.ends_at).toISOString(),
        },
      };
    });
  }

  /**
   * Awards cashback on delivered orders placed during an active campaign that have not been awarded yet.
   * cashback = min(floor(order_total * percent_bps / 10000), cap). Runs on the operations loop. Idempotent.
   */
  async awardSweep(country: string): Promise<{ awarded: number }> {
    const due = await this.db.tx({ country }, (sql) => sql.query<{ order_id: string; customer_id: string; total_minor: string; currency: string; campaign_id: string; percent_bps: number; max_cashback_minor: string | null }>(
      `SELECT DISTINCT ON (o.order_id) o.order_id, o.customer_id, o.total_minor::text AS total_minor, o.currency,
              c.id AS campaign_id, c.percent_bps, c.max_cashback_minor::text AS max_cashback_minor
         FROM ordering.order_view o
         JOIN wallet.cashback_campaign c
           ON c.active = true AND c.starts_at <= o.created_at AND c.ends_at > o.created_at AND o.total_minor >= c.min_spend_minor
        WHERE o.state = 'DELIVERED' AND o.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM wallet.cashback_award a WHERE a.order_id = o.order_id)
        ORDER BY o.order_id, c.percent_bps DESC
        LIMIT 100`,
    ));
    let awarded = 0;
    for (const d of due) {
      let minor = (BigInt(d.total_minor) * BigInt(d.percent_bps)) / 10000n;
      if (d.max_cashback_minor !== null) { const cap = BigInt(d.max_cashback_minor); if (minor > cap) minor = cap; }
      if (minor <= 0n) continue;
      const amount = Money.ofMinor(minor, d.currency);
      try {
        const did = await this.db.tx({ country }, async (sql) => {
          // One award per order: the unique index makes the insert the idempotency guard.
          const inserted = await sql.query<{ id: string }>(
            "INSERT INTO wallet.cashback_award (country_iso2, user_id, order_id, campaign_id, amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING RETURNING id",
            [country, d.customer_id, d.order_id, d.campaign_id, minor.toString()],
          );
          if (inserted.length === 0) return false; // already awarded
          await this.wallet.creditFromPromotion(sql, country, d.customer_id, amount, "CASHBACK", `cashback:${d.order_id}`);
          return true;
        });
        if (did) awarded++;
      } catch (e) { if (!/duplicate key|unique/i.test((e as Error).message)) throw e; }
    }
    return { awarded };
  }

  // ── Admin ──

  #assertAdmin(principal: Principal, country: string): void {
    const profile = this.profile(country);
    if (!authorize(principal, "campaign:write", { type: "order", country }, { activeCountry: country, profile }).allowed) throw forbidden("Cashback campaigns are managed by a market admin");
  }

  /** Admin: list the market's cashback campaigns, newest first, each tagged live / upcoming / ended. */
  async list(country: string, principal: Principal) {
    this.#assertAdmin(principal, country);
    const ccy = this.profile(country).money.settlement_currency;
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<CampaignRow & Record<string, unknown>>(
        "SELECT id, name, percent_bps, min_spend_minor::text AS min_spend_minor, max_cashback_minor::text AS max_cashback_minor, starts_at, ends_at, active FROM wallet.cashback_campaign ORDER BY starts_at DESC",
      );
      return { currency: ccy, campaigns: rows.map((c) => this.#view(c, now, ccy)) };
    });
  }

  /** Admin: create a cashback campaign. */
  async create(country: string, principal: Principal, input: CampaignInput) {
    this.#assertAdmin(principal, country);
    const ccy = this.profile(country).money.settlement_currency;
    const p = this.#parse(input, ccy, true);
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<CampaignRow & Record<string, unknown>>(
        `INSERT INTO wallet.cashback_campaign (country_iso2, name, percent_bps, min_spend_minor, max_cashback_minor, starts_at, ends_at, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, percent_bps, min_spend_minor::text AS min_spend_minor, max_cashback_minor::text AS max_cashback_minor, starts_at, ends_at, active`,
        [country, p.name, p.percent_bps, p.min_spend_minor, p.max_cashback_minor, p.starts_at, p.ends_at, p.active ?? true],
      );
      await audit(sql, { actor: principal.userId, action: "cashback.created", target: `country:${country}`, country, detail: { campaign: row!.id, name: row!.name } });
      return this.#view(row!, now, ccy);
    });
  }

  /** Admin: update or switch a cashback campaign. */
  async update(country: string, principal: Principal, id: string, input: CampaignInput) {
    this.#assertAdmin(principal, country);
    const ccy = this.profile(country).money.settlement_currency;
    const p = this.#parse(input, ccy, false);
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (p.name !== undefined) add("name", p.name);
    if (p.percent_bps !== undefined) add("percent_bps", p.percent_bps);
    if (p.min_spend_minor !== undefined) add("min_spend_minor", p.min_spend_minor);
    if (p.max_cashback_minor !== undefined) add("max_cashback_minor", p.max_cashback_minor);
    if (p.starts_at !== undefined) add("starts_at", p.starts_at);
    if (p.ends_at !== undefined) add("ends_at", p.ends_at);
    if (p.active !== undefined) add("active", p.active);
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      if (sets.length === 0) { const [row] = await sql.query<CampaignRow & Record<string, unknown>>("SELECT id, name, percent_bps, min_spend_minor::text AS min_spend_minor, max_cashback_minor::text AS max_cashback_minor, starts_at, ends_at, active FROM wallet.cashback_campaign WHERE id = $1", [id]); if (!row) throw notFound("Campaign"); return this.#view(row, now, ccy); }
      const [row] = await sql.query<CampaignRow & Record<string, unknown>>(
        `UPDATE wallet.cashback_campaign SET ${sets.join(", ")}, updated_at = now() WHERE id = $1
         RETURNING id, name, percent_bps, min_spend_minor::text AS min_spend_minor, max_cashback_minor::text AS max_cashback_minor, starts_at, ends_at, active`,
        vals,
      );
      if (!row) throw notFound("Campaign");
      await audit(sql, { actor: principal.userId, action: "cashback.updated", target: `country:${country}`, country, detail: { campaign: id } });
      return this.#view(row, now, ccy);
    });
  }

  #view(c: CampaignRow, now: Date, ccy: string) {
    const starts = new Date(c.starts_at), ends = new Date(c.ends_at);
    const status = !c.active ? "OFF" : ends <= now ? "ENDED" : starts > now ? "UPCOMING" : "LIVE";
    return {
      id: c.id, name: c.name, percent: c.percent_bps / 100, percent_bps: c.percent_bps,
      min_spend: { amount_minor: c.min_spend_minor, currency: ccy },
      max_cashback: c.max_cashback_minor ? { amount_minor: c.max_cashback_minor, currency: ccy } : null,
      starts_at: starts.toISOString(), ends_at: ends.toISOString(), active: c.active, status,
    };
  }

  #parse(input: CampaignInput, ccy: string, creating: boolean) {
    const out: { name?: string; percent_bps?: number; min_spend_minor?: string; max_cashback_minor?: string | null; starts_at?: Date; ends_at?: Date; active?: boolean } = {};
    const money = (v: string | number) => Money.of(String(v), ccy).minor.toString();
    if (creating || input.name !== undefined) { const n = String(input.name ?? "").trim(); if (!n) throw badRequest("NAME_REQUIRED", "A campaign needs a name"); out.name = n.slice(0, 80); }
    if (creating || input.percent_bps !== undefined) { const b = Math.round(Number(input.percent_bps)); if (!Number.isFinite(b) || b < 1 || b > 10000) throw badRequest("PERCENT_INVALID", "Cashback is between 0.01% and 100%"); out.percent_bps = b; }
    if (input.min_spend !== undefined) { out.min_spend_minor = input.min_spend === null || input.min_spend === "" ? "0" : (() => { try { return money(input.min_spend!); } catch (e) { throw badRequest("MIN_SPEND_INVALID", (e as Error).message); } })(); }
    else if (creating) out.min_spend_minor = "0";
    if (input.max_cashback !== undefined) { out.max_cashback_minor = input.max_cashback === null || input.max_cashback === "" ? null : (() => { try { return money(input.max_cashback!); } catch (e) { throw badRequest("MAX_CASHBACK_INVALID", (e as Error).message); } })(); }
    if (creating || input.starts_at !== undefined || input.ends_at !== undefined) {
      const starts = new Date(String(input.starts_at ?? ""));
      const ends = new Date(String(input.ends_at ?? ""));
      if (input.starts_at !== undefined) { if (Number.isNaN(starts.getTime())) throw badRequest("TIME_INVALID", "Give a start time"); out.starts_at = starts; }
      if (input.ends_at !== undefined) { if (Number.isNaN(ends.getTime())) throw badRequest("TIME_INVALID", "Give an end time"); out.ends_at = ends; }
      if (creating && (out.starts_at === undefined || out.ends_at === undefined)) throw badRequest("TIME_INVALID", "Give a start and an end time");
      if (out.starts_at && out.ends_at && out.ends_at <= out.starts_at) throw unprocessable("WINDOW_INVALID", "A campaign ends after it starts");
    }
    if (input.active !== undefined) out.active = Boolean(input.active);
    return out;
  }
}
