/**
 * Dispatch (§10.2, §12): riders go online with their position; every few seconds the dispatcher offers each
 * order that still needs a rider to the nearest free, eligible rider, one at a time, with the distance and
 * what they will earn shown before they accept. Saying no or letting the offer run out never costs the
 * rider anything; the next rider is asked. Accepting assigns the rider to the order (ASSIGN_RIDER, system actor).
 *
 * The same loop cancels orders no kitchen answered in time, so a customer is never left waiting forever.
 */
import { greatCircleMetres, ROAD_FACTOR } from "@tunakula/ts-contracts/eta-model";
import type { Db, Sql } from "../db/db.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { RIDER_ORDER_TYPES } from "../modules/ordering/order-types.ts";
import { createJournal } from "../modules/money/journal.ts";
import { Money } from "@tunakula/ts-money";
import { audit } from "../persistence/identity.ts";
import { postJournal } from "../persistence/ledger.ts";
import type { CommerceService } from "./commerce.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { loadPrincipal } from "./principal.ts";

/** How long a rider has to answer an offer. */
export const OFFER_SECONDS = 30;
/** A rider's position older than this is not trusted for dispatch. */
const PRESENCE_FRESH_MS = 2 * 60_000;
/** Orders a rider may carry at once (one in Kinshasa traffic; raise per market later). */
const MAX_ACTIVE_JOBS = 1;
/** A kitchen that has not accepted a placed order after this long: the order is cancelled for the customer. */
export const KITCHEN_TIMEOUT_MIN = 10;
/** A scheduled order is released to the kitchen and to dispatch this long before its scheduled time. */
export const SCHEDULE_RELEASE_LEAD_MIN = 30;
const NEEDS_RIDER = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY"];
const RIDER_ACTIVE = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY", "PICKED_UP"];

interface Point { lat: number; lng: number }
const unprocessableRider = () => unprocessable("NOT_A_RIDER", "That person is not a rider");
const road = (a: Point, b: Point) => Math.round(greatCircleMetres(a, b) * ROAD_FACTOR);

/** Cash a rider holds: cash-on-delivery totals they delivered, minus what they handed in. */
async function cashInHand(sql: Sql, riderId: string): Promise<{ cash: string; currency: string | null }> {
  const [r] = await sql.query<{ collected: string | null; remitted: string | null; currency: string | null }>(
    `SELECT (SELECT sum(total_minor) FROM ordering.order_view WHERE rider_id = $1::text AND state = 'DELIVERED' AND payment_mode = 'CASH_ON_DELIVERY')::text AS collected,
            (SELECT sum(amount_minor) FROM dispatch.cash_remittance WHERE rider_id = $1::uuid)::text AS remitted,
            (SELECT min(currency) FROM ordering.order_view WHERE rider_id = $1::text AND payment_mode = 'CASH_ON_DELIVERY') AS currency`,
    [riderId],
  );
  return { cash: (BigInt(r?.collected ?? "0") - BigInt(r?.remitted ?? "0")).toString(), currency: r?.currency ?? null };
}

export class DispatchService {
  private readonly db: Db;
  private readonly commerce: CommerceService;
  private readonly now: () => Date;

  constructor(db: Db, commerce: CommerceService, now: () => Date = () => new Date()) {
    this.db = db;
    this.commerce = commerce;
    this.now = now;
  }

  #profile(country: string) {
    return this.commerce.profile(country);
  }

  /** Zones this person rides in (RIDER bindings). Empty means they are not a rider. */
  static riderZones(principal: Principal): string[] {
    return principal.bindings.filter((b) => "role" in b && b.role === "RIDER" && b.scope.type === "ZONE").map((b) => (b.scope as { id: string }).id);
  }

  #canRide(principal: Principal, country: string, zone: string | null): boolean {
    return authorize(principal, "job:accept", { type: "order", country, ...(zone ? { zoneIds: [zone] } : {}) }, { activeCountry: country, profile: this.#profile(country) }).allowed;
  }

  /** POST /v1/rider/presence: go online or offline, and report position while online. */
  async presence(principal: Principal, country: string, input: { online: boolean; lat?: number; lng?: number; vehicle?: string }) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders can go online");
    if (typeof input.online !== "boolean") throw badRequest("ONLINE_REQUIRED", "Send { online: true | false }");
    const hasPos = Number.isFinite(input.lat) && Number.isFinite(input.lng);
    if (input.online && !hasPos) throw badRequest("LOCATION_REQUIRED", "Going online needs your position");
    if (hasPos && (Math.abs(input.lat!) > 90 || Math.abs(input.lng!) > 180)) throw badRequest("LOCATION_INVALID", "Position out of range");
    const vehicle = input.vehicle && ["MOTO", "BICYCLE", "CAR", "FOOT"].includes(input.vehicle) ? input.vehicle : "MOTO";
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<{ online: boolean; online_since: Date | null }>(
        `INSERT INTO dispatch.rider_presence (country_iso2, rider_id, online, lat, lng, vehicle, online_since, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 THEN $7::timestamptz END, $7)
         ON CONFLICT (country_iso2, rider_id) DO UPDATE SET
           online = EXCLUDED.online,
           lat = COALESCE(EXCLUDED.lat, dispatch.rider_presence.lat),
           lng = COALESCE(EXCLUDED.lng, dispatch.rider_presence.lng),
           vehicle = EXCLUDED.vehicle,
           online_since = CASE WHEN EXCLUDED.online AND NOT dispatch.rider_presence.online THEN EXCLUDED.updated_at
                               WHEN EXCLUDED.online THEN dispatch.rider_presence.online_since END,
           updated_at = EXCLUDED.updated_at
         RETURNING online, online_since`,
        [country, principal.userId, input.online, hasPos ? input.lat : null, hasPos ? input.lng : null, vehicle, this.now()],
      );
      if (!input.online) {
        // Going offline withdraws any offer waiting for this rider, so the order moves on at once.
        await sql.query("UPDATE dispatch.offer SET status = 'WITHDRAWN', responded_at = $2 WHERE rider_id = $1 AND status = 'OFFERED'", [principal.userId, this.now()]);
      }
      return { online: row?.online ?? input.online, online_since: row?.online_since ? new Date(row.online_since).toISOString() : null };
    });
  }

  /** GET /v1/rider/jobs: the live offer, the jobs in hand, today's earnings and cash to hand in. */
  async jobs(principal: Principal, country: string) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders have jobs");
    const tz = this.#profile(country).country.timezones[0] ?? "UTC";
    return this.db.tx({ country }, async (sql) => {
      const [presence] = await sql.query<{ online: boolean; lat: string | null; lng: string | null; online_since: Date | null; updated_at: Date }>(
        "SELECT online, lat::text, lng::text, online_since, updated_at FROM dispatch.rider_presence WHERE rider_id = $1",
        [principal.userId],
      );
      const offers = await sql.query<{ id: string; order_id: string; pickup_meters: number; drop_meters: number; earnings_minor: string; currency: string; expires_at: Date }>(
        "SELECT id, order_id, pickup_meters, drop_meters, earnings_minor::text, currency, expires_at FROM dispatch.offer WHERE rider_id = $1 AND status = 'OFFERED' AND expires_at > $2 ORDER BY offered_at LIMIT 1",
        [principal.userId, this.now()],
      );
      const active = await sql.query<{ order_id: string }>(
        "SELECT order_id FROM ordering.order_view WHERE rider_id = $1 AND state = ANY($2) ORDER BY created_at",
        [principal.userId, RIDER_ACTIVE],
      );
      const detail = async (orderId: string) => this.#jobDetail(sql, orderId);
      // Today, in the market's time zone: deliveries, earnings (rider share + tip) and cash collected.
      const done = await sql.query<{ n: string; earn: string | null; cash: string | null; currency: string | null }>(
        `SELECT count(*) AS n,
                sum((d.payload->'snapshot'->'money'->'riderReceives'->>'minor')::bigint)::text AS earn,
                sum(CASE WHEN o.payment_mode = 'CASH_ON_DELIVERY' THEN o.total_minor ELSE 0 END)::text AS cash,
                min(o.currency) AS currency
           FROM ordering.order_view o
           JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
          WHERE o.rider_id = $1 AND o.state = 'DELIVERED'
            AND (o.updated_at AT TIME ZONE $2)::date = ($3::timestamptz AT TIME ZONE $2)::date`,
        [principal.userId, tz, this.now()],
      );
      const cashAll = [await cashInHand(sql, principal.userId)];
      const ccy = done[0]?.currency ?? cashAll[0]?.currency ?? this.#profile(country).money.settlement_currency;
      const offer = offers[0];
      return {
        presence: presence
          ? { online: presence.online, lat: presence.lat ? Number(presence.lat) : null, lng: presence.lng ? Number(presence.lng) : null, online_since: presence.online_since ? new Date(presence.online_since).toISOString() : null }
          : { online: false, lat: null, lng: null, online_since: null },
        offer: offer
          ? {
              id: offer.id,
              expires_at: new Date(offer.expires_at).toISOString(),
              seconds_left: Math.max(0, Math.round((new Date(offer.expires_at).getTime() - this.now().getTime()) / 1000)),
              pickup_km: (offer.pickup_meters / 1000).toFixed(1),
              drop_km: (offer.drop_meters / 1000).toFixed(1),
              earnings: { amount_minor: offer.earnings_minor, currency: offer.currency },
              job: await detail(offer.order_id),
            }
          : null,
        active: await Promise.all(active.map((a) => detail(a.order_id))),
        today: { deliveries: Number(done[0]?.n ?? 0), earnings: { amount_minor: done[0]?.earn ?? "0", currency: ccy } },
        // Cash collected at doors minus what was handed in at the hub.
        cash_in_hand: { amount_minor: cashAll[0]?.cash ?? "0", currency: ccy },
      };
    });
  }

  /** The rider's earned balance: riderReceives on every delivered order, minus what they have cashed out. */
  async #earnedBalance(sql: Sql, riderId: string): Promise<bigint> {
    const [e] = await sql.query<{ earned: string }>(
      `SELECT COALESCE(sum((d.payload->'snapshot'->'money'->'riderReceives'->>'minor')::bigint), 0)::text AS earned
         FROM ordering.order_view o JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
        WHERE o.rider_id = $1 AND o.state = 'DELIVERED'`,
      [riderId],
    );
    const [p] = await sql.query<{ paid: string }>("SELECT COALESCE(sum(amount_minor), 0)::text AS paid FROM dispatch.rider_payout WHERE rider_id = $1", [riderId]);
    const [b] = await sql.query<{ bonus: string }>("SELECT COALESCE(sum(amount_minor), 0)::text AS bonus FROM dispatch.rider_bonus WHERE rider_id = $1", [riderId]);
    return BigInt(e?.earned ?? "0") + BigInt(b?.bonus ?? "0") - BigInt(p?.paid ?? "0");
  }

  /** The rider's performance tier from lifetime deliveries and 30-day acceptance (DoorDash Top Dasher / Uber Pro). */
  async #tier(sql: Sql, riderId: string): Promise<{ tier: string; deliveries: number; acceptance_rate: number | null; next: { tier: string; deliveries: number; acceptance_rate: number } | null }> {
    const [d] = await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM ordering.order_view WHERE rider_id = $1 AND state = 'DELIVERED'", [riderId]);
    const since = new Date(this.now().getTime() - 30 * 86_400_000);
    const [a] = await sql.query<{ offered: string; accepted: string }>(
      "SELECT count(*)::text AS offered, count(*) FILTER (WHERE status = 'ACCEPTED')::text AS accepted FROM dispatch.offer WHERE rider_id = $1 AND offered_at >= $2",
      [riderId, since],
    );
    const deliveries = Number(d?.n ?? 0);
    const offered = Number(a?.offered ?? 0);
    const acceptance = offered > 0 ? Math.round((Number(a?.accepted ?? 0) / offered) * 1000) / 10 : null;
    const ladder = [
      { tier: "PLATINUM", deliveries: 500, acceptance_rate: 90 },
      { tier: "GOLD", deliveries: 200, acceptance_rate: 80 },
      { tier: "SILVER", deliveries: 50, acceptance_rate: 70 },
      { tier: "BRONZE", deliveries: 0, acceptance_rate: 0 },
    ];
    const meets = (t: { deliveries: number; acceptance_rate: number }) => deliveries >= t.deliveries && (acceptance === null || acceptance >= t.acceptance_rate);
    const tier = ladder.find(meets) ?? ladder[ladder.length - 1]!;
    const idx = ladder.findIndex((t) => t.tier === tier.tier);
    const next = idx > 0 ? ladder[idx - 1]! : null;
    return { tier: tier.tier, deliveries, acceptance_rate: acceptance, next: next ? { tier: next.tier, deliveries: next.deliveries, acceptance_rate: next.acceptance_rate } : null };
  }

  /** GET /v1/rider/earnings: per-order breakdown (base + tip), lifetime totals and the balance to cash out. */
  async earnings(principal: Principal, country: string) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders have earnings");
    const ccy = this.#profile(country).money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const orders = await sql.query<{ order_id: string; at: Date; receives: string | null; share: string | null; currency: string; branch_name: string; payment_mode: string }>(
        `SELECT o.order_id, o.updated_at AS at,
                (d.payload->'snapshot'->'money'->'riderReceives'->>'minor') AS receives,
                (d.payload->'snapshot'->'money'->'riderShare'->>'minor') AS share,
                o.currency, o.payment_mode, b.name AS branch_name
           FROM ordering.order_view o
           JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
           JOIN catalogue.branch b ON b.id = o.branch_id
          WHERE o.rider_id = $1 AND o.state = 'DELIVERED'
          ORDER BY o.updated_at DESC LIMIT 50`,
        [principal.userId],
      );
      const [tot] = await sql.query<{ earned: string }>(
        `SELECT COALESCE(sum((d.payload->'snapshot'->'money'->'riderReceives'->>'minor')::bigint), 0)::text AS earned
           FROM ordering.order_view o JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
          WHERE o.rider_id = $1 AND o.state = 'DELIVERED'`,
        [principal.userId],
      );
      const [paid] = await sql.query<{ paid: string }>("SELECT COALESCE(sum(amount_minor), 0)::text AS paid FROM dispatch.rider_payout WHERE rider_id = $1", [principal.userId]);
      const [bonusTot] = await sql.query<{ bonus: string }>("SELECT COALESCE(sum(amount_minor), 0)::text AS bonus FROM dispatch.rider_bonus WHERE rider_id = $1", [principal.userId]);
      const earned = BigInt(tot?.earned ?? "0") + BigInt(bonusTot?.bonus ?? "0");
      const cashedOut = BigInt(paid?.paid ?? "0");
      const tier = await this.#tier(sql, principal.userId);
      const m = (minor: bigint) => ({ amount_minor: minor.toString(), currency: ccy });
      return {
        tier,
        available: m(earned - cashedOut),
        lifetime_earned: m(earned),
        bonuses: m(BigInt(bonusTot?.bonus ?? "0")),
        cashed_out: m(cashedOut),
        orders: orders.map((o) => {
          const receives = BigInt(o.receives ?? "0");
          const base = BigInt(o.share ?? "0");
          return {
            order_id: o.order_id,
            at: new Date(o.at).toISOString(),
            restaurant: o.branch_name,
            payment_mode: o.payment_mode,
            base: m(base),
            tip: m(receives - base),
            total: m(receives),
          };
        }),
      };
    });
  }

  /** POST /v1/rider/cashout: pay the rider their earned balance now (ledger: rider_payable -> psp_clearing). */
  async cashout(principal: Principal, country: string, amountMinor: string | undefined, key: string) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders cash out earnings");
    const ccy = this.#profile(country).money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const jkey = `payout:${principal.userId}:${key}`;
      const [existing] = await sql.query<{ amount_minor: string }>("SELECT amount_minor::text FROM dispatch.rider_payout WHERE journal_key = $1", [jkey]);
      const available = await this.#earnedBalance(sql, principal.userId);
      if (existing) return { paid: { amount_minor: existing.amount_minor, currency: ccy }, available: { amount_minor: available.toString(), currency: ccy } };
      const amount = amountMinor && /^\d+$/.test(amountMinor) ? BigInt(amountMinor) : available;
      if (amount <= 0n) throw unprocessable("NOTHING_TO_CASH_OUT", "You have no balance to cash out yet");
      if (amount > available) throw conflict("MORE_THAN_AVAILABLE", `Your balance is ${available} minor units; cash out at most that`);
      const at = this.now();
      const money = Money.ofMinor(amount, ccy);
      await postJournal(sql, createJournal({
        id: jkey, idempotencyKey: jkey, description: `Instant cash-out to rider ${principal.userId.slice(-6)}`, postedAt: at,
        entries: [{ account: "rider_payable", country, amount: money }, { account: "psp_clearing", country, amount: money.negate() }],
      }));
      await sql.query(
        "INSERT INTO dispatch.rider_payout (country_iso2, rider_id, amount_minor, currency, method, journal_key, at) VALUES ($1, $2, $3, $4, 'MOBILE_MONEY', $5, $6)",
        [country, principal.userId, amount.toString(), ccy, jkey, at],
      );
      await audit(sql, { actor: principal.userId, action: "rider.cashout", target: `rider:${principal.userId}`, country, detail: { amount_minor: amount.toString(), currency: ccy } });
      return { paid: { amount_minor: amount.toString(), currency: ccy }, available: { amount_minor: (available - amount).toString(), currency: ccy } };
    });
  }

  /** GET /v1/rider/quests: the active incentive quests and this rider's progress and claims. */
  async quests(principal: Principal, country: string) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders have quests");
    const ccy = this.#profile(country).money.settlement_currency;
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const quests = await sql.query<{ id: string; name: string; target_deliveries: number; bonus_minor: string; currency: string; starts_at: Date; ends_at: Date }>(
        "SELECT id, name, target_deliveries, bonus_minor::text, currency, starts_at, ends_at FROM dispatch.rider_quest WHERE country_iso2 = $1 AND active = true AND ends_at > $2 ORDER BY ends_at",
        [country, now],
      );
      const claims = new Set((await sql.query<{ quest_id: string }>("SELECT quest_id FROM dispatch.rider_bonus WHERE rider_id = $1", [principal.userId])).map((r) => r.quest_id));
      const out = [];
      for (const q of quests) {
        const [p] = await sql.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM ordering.order_view WHERE rider_id = $1 AND state = 'DELIVERED' AND updated_at >= $2 AND updated_at <= $3",
          [principal.userId, q.starts_at, q.ends_at],
        );
        const progress = Number(p?.n ?? 0);
        const claimed = claims.has(q.id);
        out.push({
          id: q.id, name: q.name, target: q.target_deliveries, progress: Math.min(progress, q.target_deliveries),
          bonus: { amount_minor: q.bonus_minor, currency: q.currency }, ends_at: new Date(q.ends_at).toISOString(),
          claimed, claimable: !claimed && progress >= q.target_deliveries,
        });
      }
      return { currency: ccy, quests: out };
    });
  }

  /** POST /v1/rider/quests/:id/claim: a rider claims a completed quest; the bonus joins their cashable balance. */
  async claimQuest(principal: Principal, country: string, questId: string) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders claim quests");
    const now = this.now();
    return this.db.tx({ country }, async (sql) => {
      const [q] = await sql.query<{ id: string; target_deliveries: number; bonus_minor: string; currency: string; starts_at: Date; ends_at: Date; active: boolean }>(
        "SELECT id, target_deliveries, bonus_minor::text, currency, starts_at, ends_at, active FROM dispatch.rider_quest WHERE id = $1 AND country_iso2 = $2",
        [questId, country],
      );
      if (!q) throw notFound("Quest");
      const jkey = `bonus:${questId}:${principal.userId}`;
      const [existing] = await sql.query<{ amount_minor: string }>("SELECT amount_minor::text FROM dispatch.rider_bonus WHERE journal_key = $1", [jkey]);
      if (existing) return { bonus: { amount_minor: existing.amount_minor, currency: q.currency }, claimed: true };
      if (!q.active || new Date(q.ends_at) < now) throw conflict("QUEST_CLOSED", "This quest is closed");
      const [p] = await sql.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM ordering.order_view WHERE rider_id = $1 AND state = 'DELIVERED' AND updated_at >= $2 AND updated_at <= $3",
        [principal.userId, q.starts_at, q.ends_at],
      );
      if (Number(p?.n ?? 0) < q.target_deliveries) throw unprocessable("QUEST_NOT_COMPLETE", `Complete ${q.target_deliveries} deliveries first`);
      const amount = Money.ofMinor(BigInt(q.bonus_minor), q.currency);
      await postJournal(sql, createJournal({
        id: jkey, idempotencyKey: jkey, description: `Quest bonus to rider ${principal.userId.slice(-6)}`, postedAt: now,
        entries: [{ account: "rider_incentive_expense", country, amount }, { account: "rider_payable", country, amount: amount.negate() }],
      }));
      await sql.query(
        "INSERT INTO dispatch.rider_bonus (country_iso2, rider_id, quest_id, amount_minor, currency, journal_key, at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [country, principal.userId, questId, q.bonus_minor, q.currency, jkey, now],
      );
      await audit(sql, { actor: principal.userId, action: "rider.quest_claimed", target: `quest:${questId}`, country, detail: { amount_minor: q.bonus_minor } });
      return { bonus: { amount_minor: q.bonus_minor, currency: q.currency }, claimed: true };
    });
  }

  /** Admin: create a rider quest. POST /v1/admin/quests */
  async createQuest(principal: Principal, country: string, input: { name?: string; target_deliveries?: number; bonus_minor?: string; days?: number }) {
    const profile = this.#profile(country);
    if (!(await this.#opsAllowed(principal, country, ["rider:manage"]))) throw forbidden("Defining rider quests needs rider management");
    const name = String(input.name ?? "").trim();
    if (!name || name.length > 80) throw badRequest("NAME_REQUIRED", "A quest needs a name of 1–80 characters");
    const target = Math.trunc(Number(input.target_deliveries));
    if (!Number.isInteger(target) || target < 1 || target > 1000) throw badRequest("TARGET_INVALID", "target_deliveries is 1–1000");
    if (!/^\d+$/.test(input.bonus_minor ?? "") || BigInt(input.bonus_minor!) <= 0n) throw badRequest("BONUS_INVALID", "bonus_minor is a positive whole number");
    const days = Math.min(Math.max(Math.trunc(Number(input.days) || 7), 1), 90);
    const ccy = profile.money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<{ id: string }>(
        "INSERT INTO dispatch.rider_quest (country_iso2, name, target_deliveries, bonus_minor, currency, ends_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [country, name, target, input.bonus_minor, ccy, new Date(this.now().getTime() + days * 86_400_000)],
      );
      await audit(sql, { actor: principal.userId, action: "rider.quest_created", target: `quest:${row?.id}`, country, detail: { name, target, bonus_minor: input.bonus_minor } });
      return { id: row?.id, name, target_deliveries: target, bonus: { amount_minor: input.bonus_minor, currency: ccy } };
    });
  }

  /** Admin: list quests. GET /v1/admin/quests */
  async listQuests(principal: Principal, country: string) {
    if (!(await this.#opsAllowed(principal, country, ["rider:manage"]))) throw forbidden("Rider quests are for operations");
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; name: string; target_deliveries: number; bonus_minor: string; currency: string; ends_at: Date; active: boolean; claims: string }>(
        `SELECT q.id, q.name, q.target_deliveries, q.bonus_minor::text, q.currency, q.ends_at, q.active,
                (SELECT count(*) FROM dispatch.rider_bonus b WHERE b.quest_id = q.id)::text AS claims
           FROM dispatch.rider_quest q WHERE q.country_iso2 = $1 ORDER BY q.created_at DESC LIMIT 100`,
        [country],
      );
      return { quests: rows.map((r) => ({ id: r.id, name: r.name, target_deliveries: r.target_deliveries, bonus: { amount_minor: r.bonus_minor, currency: r.currency }, ends_at: new Date(r.ends_at).toISOString(), active: r.active, claims: Number(r.claims) })) };
    });
  }

  /** POST /v1/rider/sos: a rider raises a safety alert; ops see it at once in the incidents queue. */
  async raiseSos(principal: Principal, country: string, input: { kind?: string; lat?: number; lng?: number; note?: string; orderId?: string }) {
    if (DispatchService.riderZones(principal).length === 0) throw forbidden("Only riders raise safety alerts");
    const kind = ["SOS", "ACCIDENT", "UNSAFE", "VEHICLE", "OTHER"].includes(input.kind ?? "") ? input.kind : "SOS";
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<{ id: string; created_at: Date }>(
        `INSERT INTO dispatch.safety_incident (country_iso2, rider_id, order_id, kind, lat, lng, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
        [country, principal.userId, input.orderId ?? null, kind, input.lat ?? null, input.lng ?? null, input.note?.slice(0, 500) ?? null],
      );
      await audit(sql, { actor: principal.userId, action: "safety.sos_raised", target: `incident:${row?.id}`, country, detail: { kind } });
      return {
        id: row?.id,
        status: "OPEN",
        message: "Help is on the way. Move to a safe place if you can. Operations has been alerted and will call you.",
      };
    });
  }

  /** GET /v1/ops/incidents: the open (and recently resolved) safety queue for operations. */
  async incidents(principal: Principal, country: string) {
    if (!(await this.#opsAllowed(principal, country, ["dispatch:manage", "exception:manage"]))) throw forbidden("The safety queue is for operations staff");
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; rider_id: string; rider: string | null; order_id: string | null; kind: string; lat: number | null; lng: number | null; note: string | null; status: string; created_at: Date; acknowledged_at: Date | null }>(
        `SELECT i.id, i.rider_id, u.display_name AS rider, i.order_id, i.kind, i.lat, i.lng, i.note, i.status, i.created_at, i.acknowledged_at
           FROM dispatch.safety_incident i LEFT JOIN identity.app_user u ON u.id = i.rider_id
          WHERE i.status <> 'RESOLVED' OR i.updated_at >= $1
          ORDER BY (i.status = 'OPEN') DESC, i.created_at DESC LIMIT 100`,
        [new Date(this.now().getTime() - 86_400_000)],
      );
      return {
        incidents: rows.map((r) => ({
          id: r.id, rider: { id: r.rider_id, name: r.rider ?? "Rider" }, order_id: r.order_id, kind: r.kind,
          location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
          note: r.note, status: r.status, created_at: new Date(r.created_at).toISOString(),
          acknowledged_at: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
        })),
      };
    });
  }

  /** POST /v1/ops/incidents/:id: operations acknowledges or resolves a safety alert. */
  async updateIncident(principal: Principal, country: string, id: string, status: string) {
    if (!["ACKNOWLEDGED", "RESOLVED"].includes(status)) throw badRequest("STATUS_INVALID", "Status is ACKNOWLEDGED or RESOLVED");
    if (!(await this.#opsAllowed(principal, country, ["dispatch:manage", "exception:manage"]))) throw forbidden("The safety queue is for operations staff");
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<{ id: string; status: string }>(
        `UPDATE dispatch.safety_incident
            SET status = $2,
                acknowledged_by = CASE WHEN $2 = 'ACKNOWLEDGED' THEN $3::uuid ELSE acknowledged_by END,
                acknowledged_at = CASE WHEN $2 = 'ACKNOWLEDGED' AND acknowledged_at IS NULL THEN $4::timestamptz ELSE acknowledged_at END,
                resolved_at = CASE WHEN $2 = 'RESOLVED' THEN $4::timestamptz ELSE resolved_at END,
                updated_at = $4::timestamptz
          WHERE id = $1 RETURNING id, status`,
        [id, status, principal.userId, this.now()],
      );
      if (!row) throw notFound("Incident");
      await audit(sql, { actor: principal.userId, action: `safety.${status.toLowerCase()}`, target: `incident:${id}`, country });
      return { id: row.id, status: row.status };
    });
  }

  async #jobDetail(sql: Sql, orderId: string) {
    const [o] = await sql.query<{
      order_id: string; state: string; type: string; payment_mode: string; total_minor: string; currency: string;
      branch_id: string; branch_name: string; commune: string | null; blat: string; blng: string; snapshot: Record<string, unknown>; customer: string | null; labels: string[] | null;
    }>(
      `SELECT o.order_id, o.state, o.type, o.payment_mode, o.total_minor::text, o.currency, b.id AS branch_id, b.name AS branch_name, b.commune,
              b.lat::text AS blat, b.lng::text AS blng, d.payload->'snapshot' AS snapshot, u.display_name AS customer,
              (SELECT array(SELECT jsonb_array_elements_text(e.payload->'evidence'->'labelIds')) FROM ordering.order_event e
                WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'READY' ORDER BY e.seq DESC LIMIT 1) AS labels
         FROM ordering.order_view o
         JOIN catalogue.branch b ON b.id = o.branch_id
         JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
         LEFT JOIN identity.app_user u ON u.id = o.customer_id
        WHERE o.order_id = $1`,
      [orderId],
    );
    if (!o) throw notFound("Order");
    const s = o.snapshot as { dropLocation?: Point; lines?: { name: string; quantity: number }[]; deliveryNote?: string; ageRestricted?: boolean; money?: { riderReceives?: { minor: string; currency: string } } };
    return {
      order_id: o.order_id,
      ref: o.order_id.slice(-5).toUpperCase(),
      state: o.state,
      type: o.type,
      pickup: { branch_id: o.branch_id, name: o.branch_name, commune: o.commune, lat: Number(o.blat), lng: Number(o.blng) },
      drop: s.dropLocation ? { lat: s.dropLocation.lat, lng: s.dropLocation.lng, note: s.deliveryNote ?? null, customer: o.customer && o.customer !== "Tunakula customer" ? o.customer.split(/\s+/)[0] : null } : null,
      items: (s.lines ?? []).reduce((n, l) => n + l.quantity, 0),
      labels: o.labels ?? [],
      // Cash the rider collects at the door (cash-on-delivery orders only).
      collect: o.payment_mode === "CASH_ON_DELIVERY" ? { amount_minor: o.total_minor, currency: o.currency } : null,
      earnings: s.money?.riderReceives ? { amount_minor: s.money.riderReceives.minor, currency: s.money.riderReceives.currency } : null,
      age_restricted: s.ageRestricted === true,
    };
  }

  /** POST /v1/rider/offers/:id/accept | /decline */
  async respond(principal: Principal, country: string, offerId: string, accept: boolean, reason?: string) {
    return this.db.tx({ country }, async (sql) => {
      const [offer] = await sql.query<{ id: string; order_id: string; rider_id: string; status: string; expires_at: Date }>(
        "SELECT id, order_id, rider_id, status, expires_at FROM dispatch.offer WHERE id = $1 FOR UPDATE",
        [offerId],
      );
      if (!offer || offer.rider_id !== principal.userId) throw notFound("Offer");
      if (offer.status !== "OFFERED") throw conflict("OFFER_CLOSED", `This offer is ${offer.status.toLowerCase()}`);
      const at = this.now();
      if (new Date(offer.expires_at) <= at) {
        await sql.query("UPDATE dispatch.offer SET status = 'EXPIRED', responded_at = $2 WHERE id = $1", [offerId, at]);
        throw conflict("OFFER_EXPIRED", "This offer ran out; the next one is on its way");
      }
      if (!accept) {
        await sql.query("UPDATE dispatch.offer SET status = 'DECLINED', responded_at = $2, decline_reason = $3 WHERE id = $1", [offerId, at, reason?.slice(0, 120) ?? null]);
        return { status: "DECLINED" };
      }
      const busy = await sql.query<{ n: string }>("SELECT count(*) AS n FROM ordering.order_view WHERE rider_id = $1 AND state = ANY($2)", [principal.userId, RIDER_ACTIVE]);
      if (Number(busy[0]?.n ?? 0) >= MAX_ACTIVE_JOBS) throw conflict("RIDER_BUSY", "Finish your current delivery first");
      await this.commerce.systemCommand(sql, country, offer.order_id, `dispatch:${offerId}`, { type: "ASSIGN_RIDER", riderId: principal.userId }, "dispatch");
      await sql.query("UPDATE dispatch.offer SET status = 'ACCEPTED', responded_at = $2 WHERE id = $1", [offerId, at]);
      await audit(sql, { actor: principal.userId, action: "dispatch.offer_accepted", target: `order:${offer.order_id}`, country, detail: { offer: offerId } });
      return { status: "ACCEPTED", job: await this.#jobDetail(sql, offer.order_id) };
    });
  }

  /**
   * One dispatcher pass for a market: expire stale offers, cancel orders no kitchen answered, and make the next
   * offer for every order that still needs a rider. Safe to run from several instances: a unique index allows
   * only one live offer per order, and order commands are idempotent per command id.
   */
  async tick(country: string): Promise<{ expired: number; cancelled: number; offered: number }> {
    this.#profile(country);
    const at = this.now();
    return this.db.tx({ country }, async (sql) => {
      const expired = await sql.query("UPDATE dispatch.offer SET status = 'EXPIRED', responded_at = $1 WHERE status = 'OFFERED' AND expires_at <= $1 RETURNING id", [at]);

      // Kitchens that never answered: cancel so the customer can order elsewhere (refund follows the cancel).
      // For a scheduled order the answer clock starts when it is released (its scheduled time minus the lead),
      // so greatest(placed, releaseTime) is the point we measure the timeout from. greatest() ignores NULLs,
      // so a normal (unscheduled) order simply measures from when it was placed.
      const stale = await sql.query<{ order_id: string }>(
        `SELECT o.order_id FROM ordering.order_view o
          WHERE o.state = 'PLACED'
            AND greatest(
                  (SELECT max(e.at) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'PLACED'),
                  (SELECT (d.payload->'snapshot'->>'scheduledFor')::timestamptz - make_interval(mins => $2)
                     FROM ordering.order_event d WHERE d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED')
                ) <= $1`,
        [new Date(at.getTime() - KITCHEN_TIMEOUT_MIN * 60_000), SCHEDULE_RELEASE_LEAD_MIN],
      );
      let cancelled = 0;
      for (const s of stale) {
        await this.commerce.systemCommand(sql, country, s.order_id, `timeout:${s.order_id}`, { type: "CANCEL", reasonCode: "KITCHEN_NO_RESPONSE" }, "dispatch");
        await sql.query("UPDATE dispatch.offer SET status = 'WITHDRAWN', responded_at = $2 WHERE order_id = $1 AND status = 'OFFERED'", [s.order_id, at]);
        cancelled++;
      }

      const waiting = await sql.query<{ order_id: string; branch_lat: string; branch_lng: string; commune: string | null; drop: Point | null; earn: string | null; currency: string }>(
        `SELECT o.order_id, b.lat::text AS branch_lat, b.lng::text AS branch_lng, b.commune,
                d.payload->'snapshot'->'dropLocation' AS drop,
                d.payload->'snapshot'->'money'->'riderReceives'->>'minor' AS earn, o.currency
           FROM ordering.order_view o
           JOIN catalogue.branch b ON b.id = o.branch_id
           JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
          WHERE o.rider_id IS NULL AND o.type = ANY($1) AND o.state = ANY($2)
            AND NOT EXISTS (SELECT 1 FROM dispatch.offer f WHERE f.order_id = o.order_id AND f.status = 'OFFERED')
            -- A scheduled order is not offered to a rider until it is released (its scheduled time minus the lead).
            AND ((d.payload->'snapshot'->>'scheduledFor') IS NULL
                 OR (d.payload->'snapshot'->>'scheduledFor')::timestamptz - make_interval(mins => $3) <= $4)
          ORDER BY o.created_at`,
        [RIDER_ORDER_TYPES, NEEDS_RIDER, SCHEDULE_RELEASE_LEAD_MIN, at],
      );
      if (!waiting.length) return { expired: expired.length, cancelled, offered: 0 };

      const riders = await sql.query<{ rider_id: string; lat: string; lng: string }>(
        `SELECT p.rider_id, p.lat::text, p.lng::text FROM dispatch.rider_presence p
          WHERE p.online AND p.lat IS NOT NULL AND p.updated_at >= $1
            AND NOT EXISTS (SELECT 1 FROM dispatch.offer f WHERE f.rider_id = p.rider_id AND f.status = 'OFFERED')
            AND (SELECT count(*) FROM ordering.order_view o WHERE o.rider_id = p.rider_id::text AND o.state = ANY($2)) < $3`,
        [new Date(at.getTime() - PRESENCE_FRESH_MS), RIDER_ACTIVE, MAX_ACTIVE_JOBS],
      );
      const principals = new Map<string, Principal>();
      for (const r of riders) principals.set(r.rider_id, await loadPrincipal(sql, r.rider_id));
      const taken = new Set<string>();
      let offered = 0;
      for (const w of waiting) {
        const branch = { lat: Number(w.branch_lat), lng: Number(w.branch_lng) };
        const asked = new Set((await sql.query<{ rider_id: string }>("SELECT rider_id FROM dispatch.offer WHERE order_id = $1", [w.order_id])).map((r) => r.rider_id));
        const best = riders
          .filter((r) => !taken.has(r.rider_id) && !asked.has(r.rider_id) && this.#canRide(principals.get(r.rider_id)!, country, w.commune))
          .map((r) => ({ r, meters: road({ lat: Number(r.lat), lng: Number(r.lng) }, branch) }))
          .sort((a, b) => a.meters - b.meters)[0];
        if (!best) continue;
        const dropMeters = w.drop ? road(branch, w.drop) : 0;
        await sql.query(
          `INSERT INTO dispatch.offer (country_iso2, order_id, rider_id, pickup_meters, drop_meters, earnings_minor, currency, offered_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
          [country, w.order_id, best.r.rider_id, best.meters, dropMeters, w.earn ?? "0", w.currency, at, new Date(at.getTime() + OFFER_SECONDS * 1000)],
        );
        taken.add(best.r.rider_id);
        offered++;
      }
      return { expired: expired.length, cancelled, offered };
    });
  }

  // ───────────────────────── Operations (dispatch:manage) ─────────────────────────

  /** Market-wide, or for any city where this market has kitchens (CITY_OPS). */
  async #opsAllowed(principal: Principal, country: string, actions: readonly Action[]): Promise<boolean> {
    const profile = this.#profile(country);
    const cities = await this.db.tx({ country }, (sql) => sql.query<{ city: string }>("SELECT DISTINCT city FROM catalogue.branch WHERE city IS NOT NULL"));
    const resources = [{ type: "order", country }, ...cities.map((c) => ({ type: "order", country, cityId: c.city }))];
    return actions.some((a) => resources.some((r) => authorize(principal, a, r, { activeCountry: country, profile }).allowed));
  }

  async #requireOps(principal: Principal, country: string) {
    if (!(await this.#opsAllowed(principal, country, ["dispatch:manage"]))) throw forbidden("The dispatch board is for operations staff");
  }

  /** GET /v1/ops/dispatch: every rider (online, busy, offline), every order that needs or has a rider, and kitchens running late. */
  async board(principal: Principal, country: string) {
    await this.#requireOps(principal, country);
    const at = this.now();
    const tz = this.#profile(country).country.timezones[0] ?? "UTC";
    return this.db.tx({ country }, async (sql) => {
      const communes = (await sql.query<{ commune: string }>("SELECT DISTINCT commune FROM catalogue.branch WHERE commune IS NOT NULL")).map((r) => r.commune);
      const riders = await sql.query<{
        id: string; name: string; phone: string | null; zones: string[]; online: boolean | null; lat: string | null; lng: string | null; vehicle: string | null; updated_at: Date | null; online_since: Date | null;
      }>(
        `SELECT u.id, u.display_name AS name, u.phone_e164 AS phone, array_agg(DISTINCT b.scope_id) AS zones,
                p.online, p.lat::text, p.lng::text, p.vehicle, p.updated_at, p.online_since
           FROM identity.role_binding b JOIN identity.app_user u ON u.id = b.user_id
           LEFT JOIN dispatch.rider_presence p ON p.rider_id = u.id
          WHERE b.role = 'RIDER' AND b.scope_type = 'ZONE' AND b.scope_id = ANY($1)
          GROUP BY u.id, u.display_name, u.phone_e164, p.online, p.lat, p.lng, p.vehicle, p.updated_at, p.online_since
          ORDER BY p.online DESC NULLS LAST, u.display_name`,
        [communes],
      );
      const jobs = await sql.query<{
        order_id: string; state: string; rider_id: string | null; created_at: Date; branch_name: string; blat: string; blng: string; drop: { lat: number; lng: number } | null;
        placed_at: Date | null; total_minor: string; currency: string; payment_mode: string; tries: string; offer_rider: string | null; offer_expires: Date | null;
      }>(
        `SELECT o.order_id, o.state, o.rider_id, o.created_at, b.name AS branch_name, b.lat::text AS blat, b.lng::text AS blng,
                d.payload->'snapshot'->'dropLocation' AS drop, o.total_minor::text, o.currency, o.payment_mode,
                (SELECT max(e.at) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'PLACED') AS placed_at,
                (SELECT count(*) FROM dispatch.offer f WHERE f.order_id = o.order_id) AS tries,
                (SELECT f.rider_id::text FROM dispatch.offer f WHERE f.order_id = o.order_id AND f.status = 'OFFERED' LIMIT 1) AS offer_rider,
                (SELECT f.expires_at FROM dispatch.offer f WHERE f.order_id = o.order_id AND f.status = 'OFFERED' LIMIT 1) AS offer_expires
           FROM ordering.order_view o
           JOIN catalogue.branch b ON b.id = o.branch_id
           JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
          WHERE o.type = ANY($1) AND o.state = ANY($2)
          ORDER BY o.created_at`,
        [RIDER_ORDER_TYPES, RIDER_ACTIVE],
      );
      const nameOf = new Map(riders.map((r) => [r.id, r.name]));
      const busy = new Map(jobs.filter((j) => j.rider_id).map((j) => [j.rider_id!, j]));
      const offered = new Map(jobs.filter((j) => j.offer_rider).map((j) => [j.offer_rider!, j]));
      const today = await sql.query<{ rider_id: string; n: string }>(
        `SELECT rider_id, count(*) AS n FROM ordering.order_view WHERE state = 'DELIVERED' AND rider_id IS NOT NULL
            AND (updated_at AT TIME ZONE $1)::date = ($2::timestamptz AT TIME ZONE $1)::date GROUP BY rider_id`,
        [tz, at],
      );
      const deliveredToday = new Map(today.map((t) => [t.rider_id, Number(t.n)]));
      const cash = new Map<string, string>();
      for (const r of riders) cash.set(r.id, (await cashInHand(sql, r.id)).cash);
      const ccy = this.#profile(country).money.settlement_currency;
      const stuck = await sql.query<{ order_id: string; amount_minor: string; currency: string; failure: string | null; attempts: number }>(
        "SELECT order_id, amount_minor::text, currency, failure, attempts FROM payments.refund WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT 50",
      );
      const minutes = (d: Date | null) => (d ? Math.max(0, Math.floor((at.getTime() - new Date(d).getTime()) / 60000)) : 0);
      const fresh = (d: Date | null) => !!d && at.getTime() - new Date(d).getTime() <= PRESENCE_FRESH_MS;
      return {
        now: at.toISOString(),
        kitchen_timeout_min: KITCHEN_TIMEOUT_MIN,
        // Refunds the provider refused: retried automatically up to five times, then a person must act.
        refunds_failing: stuck.map((r) => ({ order_id: r.order_id, ref: r.order_id.slice(-5).toUpperCase(), amount: { amount_minor: r.amount_minor, currency: r.currency }, failure: r.failure, attempts: r.attempts, given_up: r.attempts >= 5 })),
        riders: riders.map((r) => {
          const job = busy.get(r.id);
          const offer = offered.get(r.id);
          const online = !!r.online;
          return {
            id: r.id, name: r.name, phone: r.phone, zones: r.zones, vehicle: r.vehicle ?? "MOTO",
            status: job ? "BUSY" : offer ? "OFFERED" : online && fresh(r.updated_at) ? "AVAILABLE" : online ? "SIGNAL_LOST" : "OFFLINE",
            position: r.lat && r.lng ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
            last_seen: r.updated_at ? new Date(r.updated_at).toISOString() : null,
            online_minutes: online && r.online_since ? minutes(r.online_since) : 0,
            job: job ? { order_id: job.order_id, ref: job.order_id.slice(-5).toUpperCase(), state: job.state } : null,
            delivered_today: deliveredToday.get(r.id) ?? 0,
            cash_in_hand: { amount_minor: cash.get(r.id) ?? "0", currency: ccy },
          };
        }),
        orders: jobs.map((j) => ({
          order_id: j.order_id,
          ref: j.order_id.slice(-5).toUpperCase(),
          state: j.state,
          pickup: { name: j.branch_name, lat: Number(j.blat), lng: Number(j.blng) },
          drop: j.drop,
          rider: j.rider_id ? { id: j.rider_id, name: nameOf.get(j.rider_id) ?? "Rider" } : null,
          offer: j.offer_rider && j.offer_expires ? { rider_id: j.offer_rider, rider_name: nameOf.get(j.offer_rider) ?? "Rider", seconds_left: Math.max(0, Math.round((new Date(j.offer_expires).getTime() - at.getTime()) / 1000)) } : null,
          tries: Number(j.tries),
          waiting_min: minutes(j.placed_at ?? j.created_at),
          kitchen_late: j.state === "PLACED" && minutes(j.placed_at) >= Math.floor(KITCHEN_TIMEOUT_MIN / 2),
          cash: j.payment_mode === "CASH_ON_DELIVERY" ? { amount_minor: j.total_minor, currency: j.currency } : null,
        })),
      };
    });
  }

  /** POST /v1/ops/orders/:id/assign — give (or move) an order to a specific rider; any live offer is withdrawn. */
  async assign(principal: Principal, country: string, orderId: string, riderId: string, override = false) {
    await this.#requireOps(principal, country);
    if (!riderId) throw badRequest("RIDER_REQUIRED", "Choose a rider");
    return this.db.tx({ country }, async (sql) => {
      const target = await loadPrincipal(sql, riderId);
      if (DispatchService.riderZones(target).length === 0) throw unprocessableRider();
      const busy = await sql.query<{ n: string }>("SELECT count(*) AS n FROM ordering.order_view WHERE rider_id = $1 AND state = ANY($2) AND order_id <> $3", [riderId, RIDER_ACTIVE, orderId]);
      if (Number(busy[0]?.n ?? 0) >= MAX_ACTIVE_JOBS && !override) throw conflict("RIDER_BUSY", "This rider is carrying another order; confirm to give them a second one");
      const at = this.now();
      await sql.query("UPDATE dispatch.offer SET status = 'WITHDRAWN', responded_at = $2 WHERE order_id = $1 AND status = 'OFFERED'", [orderId, at]);
      const [prev] = await sql.query<{ rider_id: string | null }>("SELECT rider_id FROM ordering.order_view WHERE order_id = $1", [orderId]);
      await this.commerce.systemCommand(sql, country, orderId, `ops-assign:${orderId}:${riderId}:${at.getTime()}`, { type: "ASSIGN_RIDER", riderId }, `ops:${principal.userId}`);
      await audit(sql, { actor: principal.userId, action: prev?.rider_id ? "dispatch.reassigned" : "dispatch.assigned", target: `order:${orderId}`, country, detail: { from: prev?.rider_id ?? null, to: riderId } });
      return { order_id: orderId, rider_id: riderId };
    });
  }

  /** POST /v1/ops/riders/:id/cash-in — record cash a rider hands in at the hub (ledger: hub_cash ← cod_cash_in_transit). */
  async cashIn(principal: Principal, country: string, riderId: string, amountMinor: string, note?: string) {
    const profile = this.#profile(country);
    if (!(await this.#opsAllowed(principal, country, ["dispatch:manage", "cod_reconciliation:manage"]))) throw forbidden("Recording cash hand-ins is for hub and finance staff");
    if (!/^\d+$/.test(amountMinor ?? "") || BigInt(amountMinor) <= 0n) throw badRequest("AMOUNT_INVALID", "Send amount_minor as a positive whole number of minor units");
    const ccy = profile.money.settlement_currency;
    return this.db.tx({ country }, async (sql) => {
      const held = BigInt((await cashInHand(sql, riderId)).cash);
      if (BigInt(amountMinor) > held) throw conflict("MORE_THAN_HELD", `The rider holds ${held} minor units; record at most that`);
      const at = this.now();
      const key = `cash-in:${riderId}:${at.getTime()}`;
      const amount = Money.ofMinor(BigInt(amountMinor), ccy);
      await postJournal(sql, createJournal({
        id: key, idempotencyKey: key, description: `Cash handed in by rider ${riderId.slice(-6)}`, postedAt: at,
        entries: [{ account: "hub_cash", country, amount }, { account: "cod_cash_in_transit", country, amount: amount.negate() }],
      }));
      const [row] = await sql.query<{ id: string }>(
        "INSERT INTO dispatch.cash_remittance (country_iso2, rider_id, amount_minor, currency, received_by, note, journal_key, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [country, riderId, amountMinor, ccy, principal.userId, note?.slice(0, 200) ?? null, key, at],
      );
      await audit(sql, { actor: principal.userId, action: "cash.received", target: `rider:${riderId}`, country, detail: { amount_minor: amountMinor, currency: ccy } });
      return { id: row?.id, cash_in_hand: { amount_minor: (held - BigInt(amountMinor)).toString(), currency: ccy } };
    });
  }

  /** The rider as the customer sees them: first name, and position and distance while the order is on its way. */
  async riderForCustomer(country: string, riderId: string, state: string, drop: Point | undefined) {
    return this.db.tx({ country }, async (sql) => {
      const [u] = await sql.query<{ display_name: string | null }>("SELECT display_name FROM identity.app_user WHERE id = $1", [riderId]);
      const name = u?.display_name?.split(/\s+/)[0] ?? "Rider";
      const pos = ["READY", "PICKED_UP", "ACCEPTED", "PREPARING", "PACKED"].includes(state) ? await this.riderPosition(sql, riderId) : null;
      return { name, ...(pos ? { position: pos, ...(drop && state === "PICKED_UP" ? { meters_to_you: road(pos, drop) } : {}) } : {}) };
    });
  }

  /** Where the rider is now, for the customer's tracking (only while their order is on the way). */
  async riderPosition(sql: Sql, riderId: string): Promise<{ lat: number; lng: number; updated_at: string } | null> {
    const [p] = await sql.query<{ lat: string | null; lng: string | null; updated_at: Date; online: boolean }>(
      "SELECT lat::text, lng::text, updated_at, online FROM dispatch.rider_presence WHERE rider_id = $1",
      [riderId],
    );
    if (!p?.lat || !p.lng || this.now().getTime() - new Date(p.updated_at).getTime() > 10 * 60_000) return null;
    return { lat: Number(p.lat), lng: Number(p.lng), updated_at: new Date(p.updated_at).toISOString() };
  }
}
