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
import { RIDER_ORDER_TYPES } from "../modules/ordering/order-types.ts";
import { audit } from "../persistence/identity.ts";
import type { CommerceService } from "./commerce.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { loadPrincipal } from "./principal.ts";

/** How long a rider has to answer an offer. */
export const OFFER_SECONDS = 30;
/** A rider's position older than this is not trusted for dispatch. */
const PRESENCE_FRESH_MS = 2 * 60_000;
/** Orders a rider may carry at once (one in Kinshasa traffic; raise per market later). */
const MAX_ACTIVE_JOBS = 1;
/** A kitchen that has not accepted a placed order after this long: the order is cancelled for the customer. */
export const KITCHEN_TIMEOUT_MIN = 10;
const NEEDS_RIDER = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY"];
const RIDER_ACTIVE = ["PLACED", "ACCEPTED", "PREPARING", "PACKED", "READY", "PICKED_UP"];

interface Point { lat: number; lng: number }
const road = (a: Point, b: Point) => Math.round(greatCircleMetres(a, b) * ROAD_FACTOR);

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
      const cashAll = await sql.query<{ cash: string | null; currency: string | null }>(
        "SELECT sum(total_minor)::text AS cash, min(currency) AS currency FROM ordering.order_view WHERE rider_id = $1 AND state = 'DELIVERED' AND payment_mode = 'CASH_ON_DELIVERY'",
        [principal.userId],
      );
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
        // Not yet net of hand-ins: remittance is recorded by ops (cash collection screen, next module).
        cash_in_hand: { amount_minor: cashAll[0]?.cash ?? "0", currency: ccy },
      };
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
    const s = o.snapshot as { dropLocation?: Point; lines?: { name: string; quantity: number }[]; deliveryNote?: string; money?: { riderReceives?: { minor: string; currency: string } } };
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
      const stale = await sql.query<{ order_id: string }>(
        `SELECT o.order_id FROM ordering.order_view o
          WHERE o.state = 'PLACED'
            AND (SELECT max(e.at) FROM ordering.order_event e WHERE e.order_id = o.order_id AND e.type = 'STATE_CHANGED' AND e.payload->>'to' = 'PLACED') <= $1`,
        [new Date(at.getTime() - KITCHEN_TIMEOUT_MIN * 60_000)],
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
          ORDER BY o.created_at`,
        [RIDER_ORDER_TYPES, NEEDS_RIDER],
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
