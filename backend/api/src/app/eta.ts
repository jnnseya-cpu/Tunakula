/**
 * Distance and delivery-time estimates for every storefront (customer app, website, partner API).
 *
 * ETA = time until a rider leaves the kitchen + travel time + handover.
 *  - Time to pickup is learned per branch from its own orders (median minutes from PLACED to PICKED_UP over
 *    30 days), plus the kitchen's live load (orders it is preparing right now).
 *  - Travel time comes from the routing provider: live traffic when a map adapter is connected, otherwise
 *    road distance with the market's congestion profile, corrected by how long riders actually took at that
 *    hour (median actual/estimated ratio from delivered orders).
 * Distances are road distances in kilometres, rounded to 0.1 km. Nothing here is stored or logged with
 * the customer's position.
 */
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { distanceMetres } from "../modules/ordering/order-aggregate.ts";
import type { GeoPoint } from "../modules/ordering/order-types.ts";
import { deliveryFee } from "../modules/pricing/pricing.ts";
import { badRequest, notFound } from "./errors.ts";
import { DEFAULT_PICKUP_MIN, etaRange, HANDOVER_MIN, localHour, modelSeconds, ROAD_FACTOR } from "@tunakula/ts-contracts/eta-model";
import { isOpenNow, type SpecialHours, type WeeklyHours } from "../modules/catalogue/hours.ts";
import type { RoutingProvider } from "./routing.ts";

const LOOKBACK_DAYS = 30;
const MIN_BRANCH_SAMPLES = 8;
const MIN_HOUR_SAMPLES = 15;
const MIN_MARKET_SAMPLES = 20;
const LEARN_TTL_MS = 10 * 60_000;
const ACTIVE_STATES = ["PLACED", "ACCEPTED", "PREPARING", "PACKED"];

export interface Eta {
  /** Best estimate in whole minutes. */
  readonly minutes: number;
  /** Range to show ("25–35 min"). */
  readonly low: number;
  readonly high: number;
  readonly pickup_minutes: number;
  readonly travel_minutes: number;
  /** "traffic" when travel time reflects live traffic; "learned" when corrected by past deliveries; else "estimate". */
  readonly basis: "traffic" | "learned" | "estimate";
}

export interface StorefrontDistance {
  readonly id: string;
  readonly name: string;
  readonly commune: string | null;
  readonly open: boolean;
  readonly distance_meters: number;
  /** Road distance, one decimal, e.g. "2.4". */
  readonly distance_km: string;
  readonly eta: Eta;
  readonly delivery_fee: { readonly amount_minor: string; readonly currency: string };
}

interface Learned {
  readonly at: number;
  readonly pickup: Map<string, { minutes: number; samples: number }>;
  readonly hourRatio: (number | null)[];
  readonly marketRatio: number | null;
}

type BranchRow = { id: string; name: string; commune: string | null; status: string; lat: string; lng: string; active: string; hours?: WeeklyHours; special_hours?: SpecialHours };

export { etaRange };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export class EtaService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly routing: RoutingProvider;
  private readonly now: () => Date;
  readonly #learned = new Map<string, Learned>();

  constructor(db: Db, registry: CountryConfigRegistry, routing: RoutingProvider, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.routing = routing;
    this.now = now;
  }

  #profile(country: string) {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** GET /v1/branches/nearby?lat&lng[&radius_km][&limit] — nearest first. */
  async nearby(country: string, at: GeoPoint, opts: { radiusKm?: number; limit?: number } = {}): Promise<{ data: StorefrontDistance[]; routing: string }> {
    checkPoint(at);
    const radius = Math.min(Math.max(opts.radiusKm ?? 15, 0.5), 50) * 1000;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    return this.db.tx({ country }, async (sql) => {
      const rows = await branchesWithLoad(sql);
      const near = rows
        .map((b) => ({ b, straight: distanceMetres({ lat: Number(b.lat), lng: Number(b.lng) }, at) }))
        .filter((x) => x.straight * ROAD_FACTOR <= radius)
        .sort((a, b) => a.straight - b.straight)
        .slice(0, limit);
      const data = await this.#estimate(sql, country, near.map((x) => x.b), at);
      return { data: data.sort((a, b) => Number(b.open) - Number(a.open) || a.distance_meters - b.distance_meters), routing: this.routing.id };
    });
  }

  /** GET /v1/branches/:id/eta?lat&lng */
  async forBranch(country: string, branchId: string, at: GeoPoint): Promise<StorefrontDistance> {
    checkPoint(at);
    return this.db.tx({ country }, async (sql) => {
      const row = (await branchesWithLoad(sql, branchId))[0];
      if (!row) throw notFound("Branch");
      return (await this.#estimate(sql, country, [row], at))[0]!;
    });
  }

  async #estimate(sql: Sql, country: string, rows: BranchRow[], at: GeoPoint): Promise<StorefrontDistance[]> {
    if (!rows.length) return [];
    const profile = this.#profile(country);
    const tz = profile.country.timezones[0] ?? "UTC";
    const ccy = profile.money.settlement_currency;
    const departAt = this.now();
    const hour = localHour(departAt, tz);
    const learned = await this.#learn(sql, country, tz);
    const origins = rows.map((b) => ({ lat: Number(b.lat), lng: Number(b.lng) }));
    const routes = this.routing.routes
      ? await this.routing.routes(origins, at, "MOTO", departAt)
      : await Promise.all(origins.map(async (o) => {
          const meters = await this.routing.distanceMeters(o, at, "MOTO");
          return { meters, seconds: modelSeconds(meters, "MOTO", hour), traffic: false, source: this.routing.id };
        }));
    const ratio = learned.hourRatio[hour] ?? learned.marketRatio;

    return rows.map((b, i) => {
      const fallbackMeters = Math.round(distanceMetres(origins[i]!, at) * ROAD_FACTOR);
      const r = routes[i] ?? { meters: fallbackMeters, seconds: modelSeconds(fallbackMeters, "MOTO", hour), traffic: false, source: "estimate" };
      const p = learned.pickup.get(b.id);
      const base = p && p.samples >= MIN_BRANCH_SAMPLES ? p.minutes : DEFAULT_PICKUP_MIN;
      // Live kitchen load: beyond two orders in hand, each adds about two minutes.
      const pickup = Math.round(base + Math.max(0, Number(b.active) - 2) * 2);
      const corrected = !r.traffic && ratio !== null;
      const travel = Math.max(1, Math.round((r.seconds / 60) * (corrected ? ratio : 1)));
      const minutes = pickup + travel + HANDOVER_MIN;
      const fee = deliveryFee(profile.pricing, ccy, { distanceMeters: r.meters, rural: false }).fee;
      return {
        id: b.id,
        name: b.name,
        commune: b.commune,
        open: b.status === "OPEN" && isOpenNow(b.hours ?? {}, b.special_hours ?? {}, departAt, tz),
        distance_meters: r.meters,
        distance_km: (Math.round(r.meters / 100) / 10).toFixed(1),
        eta: { minutes, ...etaRange(minutes), pickup_minutes: pickup, travel_minutes: travel, basis: r.traffic ? "traffic" : corrected ? "learned" : "estimate" },
        delivery_fee: { amount_minor: fee.minor.toString(), currency: ccy },
      };
    });
  }

  /** Learned per market, refreshed every ten minutes: pickup time per branch, travel correction per hour. */
  async #learn(sql: Sql, country: string, tz: string): Promise<Learned> {
    const cached = this.#learned.get(country);
    const nowMs = this.now().getTime();
    if (cached && nowMs - cached.at < LEARN_TTL_MS) return cached;
    const since = new Date(nowMs - LOOKBACK_DAYS * 86_400_000);

    const pickupRows = await sql.query<{ branch_id: string; minutes: string; n: string }>(
      `SELECT o.branch_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (pu.at - pl.at)) / 60) AS minutes, count(*) AS n
         FROM ordering.order_view o
         JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'PLACED') pl ON true
         JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'PICKED_UP') pu ON true
        WHERE o.created_at >= $1 AND pl.at IS NOT NULL AND pu.at IS NOT NULL
        GROUP BY o.branch_id`,
      [since],
    );
    const pickup = new Map(pickupRows.map((r) => [r.branch_id, { minutes: Number(r.minutes), samples: Number(r.n) }]));

    const trips = await sql.query<{ blat: string; blng: string; dlat: string; dlng: string; picked: Date; delivered: Date }>(
      `SELECT b.lat::text AS blat, b.lng::text AS blng,
              d.payload->'snapshot'->'dropLocation'->>'lat' AS dlat, d.payload->'snapshot'->'dropLocation'->>'lng' AS dlng,
              pu.at AS picked, dl.at AS delivered
         FROM ordering.order_view o
         JOIN catalogue.branch b ON b.id = o.branch_id
         JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
         JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'PICKED_UP') pu ON true
         JOIN LATERAL (SELECT min(at) AS at FROM ordering.order_event WHERE order_id = o.order_id AND type = 'STATE_CHANGED' AND payload->>'to' = 'DELIVERED') dl ON true
        WHERE o.state = 'DELIVERED' AND o.created_at >= $1 AND pu.at IS NOT NULL AND dl.at IS NOT NULL
          AND d.payload->'snapshot'->'dropLocation' IS NOT NULL
        ORDER BY o.created_at DESC LIMIT 3000`,
      [since],
    );
    const byHour: number[][] = Array.from({ length: 24 }, () => []);
    const all: number[] = [];
    for (const t of trips) {
      const meters = distanceMetres({ lat: Number(t.blat), lng: Number(t.blng) }, { lat: Number(t.dlat), lng: Number(t.dlng) }) * ROAD_FACTOR;
      const picked = new Date(t.picked);
      const h = localHour(picked, tz);
      const est = modelSeconds(meters, "MOTO", h);
      const actual = (new Date(t.delivered).getTime() - picked.getTime()) / 1000;
      if (est < 60 || actual <= 0) continue;
      const ratio = Math.min(2.5, Math.max(0.6, actual / est));
      byHour[h]!.push(ratio);
      all.push(ratio);
    }
    const learned: Learned = {
      at: nowMs,
      pickup,
      hourRatio: byHour.map((xs) => (xs.length >= MIN_HOUR_SAMPLES ? median(xs) : null)),
      marketRatio: all.length >= MIN_MARKET_SAMPLES ? median(all) : null,
    };
    this.#learned.set(country, learned);
    return learned;
  }
}

function checkPoint(p: GeoPoint) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
    throw badRequest("LOCATION_INVALID", "Send lat and lng as decimal degrees");
  }
}

async function branchesWithLoad(sql: Sql, branchId?: string): Promise<BranchRow[]> {
  // Discovery (no branch id) lists only published branches; a direct fetch by id still works (merchant preview).
  return sql.query<BranchRow>(
    `SELECT b.id, b.name, b.commune, b.status, b.lat::text AS lat, b.lng::text AS lng, b.hours, b.special_hours,
            (SELECT count(*) FROM ordering.order_view o WHERE o.branch_id = b.id AND o.state = ANY($1)) AS active
       FROM catalogue.branch b
      WHERE ($2::uuid IS NULL OR b.id = $2::uuid)
        AND ($2::uuid IS NOT NULL OR b.published_at IS NOT NULL)`,
    [ACTIVE_STATES, branchId ?? null],
  );
}
