/**
 * RoutingProvider port (§7.3). Fees use routed travel distance (§18.3); delivery times use routed
 * travel time with live traffic when a map adapter is connected.
 *
 * Adapters:
 *  - googleRoutesRouting: Google Routes API route matrix, TRAFFIC_AWARE (live traffic).
 *  - osrmRouting: a self-hosted OSRM server (road network, no live traffic; the congestion profile is applied).
 *  - straightLineRouting: always available; great-circle distance × road factor and the congestion profile.
 * withFallback() tries the live adapter and falls back pair by pair; cachedRouting() keeps answers for minutes.
 */
import { distanceMetres } from "../modules/ordering/order-aggregate.ts";
import type { GeoPoint } from "../modules/ordering/order-types.ts";

export type Vehicle = "MOTO" | "BICYCLE" | "CAR" | "FOOT";

export interface Route {
  readonly meters: number;
  readonly seconds: number;
  /** True when the travel time reflects live traffic. */
  readonly traffic: boolean;
  /** Which adapter answered. */
  readonly source: string;
}

export interface RoutingProvider {
  readonly id: string;
  distanceMeters(from: GeoPoint, to: GeoPoint, vehicle: Vehicle): Promise<number>;
  /** One route per origin to the same destination, in order. Null where the provider has no route. */
  routes?(origins: readonly GeoPoint[], to: GeoPoint, vehicle: Vehicle, departAt: Date): Promise<(Route | null)[]>;
}

/** Free-flow speeds in km/h, before congestion. */
export const FREE_FLOW_KMH: Record<Vehicle, number> = { MOTO: 28, CAR: 24, BICYCLE: 14, FOOT: 4.5 };

/**
 * Speed multiplier by local hour (0–23) for a dense African capital: morning and evening rush,
 * a lunchtime slowdown, free flow at night. Learned per market from delivered orders (see eta.ts).
 */
export const DEFAULT_CONGESTION: readonly number[] = [
  1, 1, 1, 1, 1, 0.95, 0.8, 0.6, 0.55, 0.65, 0.75, 0.75, 0.7, 0.7, 0.75, 0.7, 0.6, 0.5, 0.5, 0.6, 0.75, 0.85, 0.95, 1,
];

export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at)) % 24;
}

/** Travel seconds for a road distance at a given local hour, using free-flow speed × congestion. */
export function modelSeconds(meters: number, vehicle: Vehicle, hour: number, congestion: readonly number[] = DEFAULT_CONGESTION): number {
  const kmh = FREE_FLOW_KMH[vehicle] * (congestion[hour] ?? 1);
  return Math.round((meters / 1000 / kmh) * 3600);
}

export function straightLineRouting(roadFactor = 1.3, opts: { timeZone?: string; congestion?: readonly number[] } = {}): RoutingProvider {
  const tz = opts.timeZone ?? "Africa/Kinshasa";
  return {
    id: "straight-line-estimate",
    distanceMeters: async (from, to) => Math.round(distanceMetres(from, to) * roadFactor),
    routes: async (origins, to, vehicle, departAt) => {
      const hour = localHour(departAt, tz);
      return origins.map((o) => {
        const meters = Math.round(distanceMetres(o, to) * roadFactor);
        return { meters, seconds: modelSeconds(meters, vehicle, hour, opts.congestion), traffic: false, source: "estimate" };
      });
    },
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Google Routes API, computeRouteMatrix with TRAFFIC_AWARE routing (live and typical traffic). */
export function googleRoutesRouting(opts: { apiKey: string; fetch?: Fetch; timeoutMs?: number; twoWheeler?: boolean }): RoutingProvider {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const mode = (v: Vehicle) => (v === "FOOT" ? "WALK" : v === "BICYCLE" ? "BICYCLE" : v === "MOTO" && opts.twoWheeler !== false ? "TWO_WHEELER" : "DRIVE");
  const point = (p: GeoPoint) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  const matrix = async (origins: readonly GeoPoint[], to: GeoPoint, vehicle: Vehicle, departAt: Date): Promise<(Route | null)[]> => {
    const out: (Route | null)[] = origins.map(() => null);
    // TRAFFIC_AWARE allows up to 625 elements per request; one destination → chunks of 100 origins is safe.
    for (let start = 0; start < origins.length; start += 100) {
      const chunk = origins.slice(start, start + 100);
      const traffic = vehicle === "MOTO" || vehicle === "CAR";
      const res = await doFetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey, "x-goog-fieldmask": "originIndex,destinationIndex,distanceMeters,duration,condition" },
        body: JSON.stringify({
          origins: chunk.map(point),
          destinations: [point(to)],
          travelMode: mode(vehicle),
          ...(traffic ? { routingPreference: "TRAFFIC_AWARE", departureTime: new Date(Math.max(departAt.getTime(), Date.now() + 1000)).toISOString() } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2500),
      });
      if (!res.ok) throw new Error(`Google Routes answered ${res.status}`);
      const body = (await res.json()) as { originIndex?: number; distanceMeters?: number; duration?: string; condition?: string }[];
      for (const el of body) {
        if (el.condition !== "ROUTE_EXISTS" || el.distanceMeters === undefined || !el.duration) continue;
        out[start + (el.originIndex ?? 0)] = { meters: el.distanceMeters, seconds: Number.parseInt(el.duration, 10), traffic: traffic, source: "google-routes" };
      }
    }
    return out;
  };
  return {
    id: "google-routes",
    routes: matrix,
    distanceMeters: async (from, to, vehicle) => {
      const [r] = await matrix([from], to, vehicle, new Date());
      if (!r) throw new Error("No route");
      return r.meters;
    },
  };
}

/** Self-hosted OSRM (road network). Durations are free-flow, so the congestion profile is applied. */
export function osrmRouting(opts: { baseUrl: string; fetch?: Fetch; timeZone?: string; congestion?: readonly number[]; timeoutMs?: number }): RoutingProvider {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const tz = opts.timeZone ?? "Africa/Kinshasa";
  const base = opts.baseUrl.replace(/\/$/, "");
  const table = async (origins: readonly GeoPoint[], to: GeoPoint, vehicle: Vehicle, departAt: Date): Promise<(Route | null)[]> => {
    const coords = [...origins, to].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const sources = origins.map((_, i) => i).join(";");
    const res = await doFetch(`${base}/table/v1/driving/${coords}?sources=${sources}&destinations=${origins.length}&annotations=distance`, {
      method: "GET", headers: {}, signal: AbortSignal.timeout(opts.timeoutMs ?? 2500),
    });
    if (!res.ok) throw new Error(`OSRM answered ${res.status}`);
    const body = (await res.json()) as { code: string; distances?: (number | null)[][] };
    if (body.code !== "Ok" || !body.distances) throw new Error(`OSRM ${body.code}`);
    const hour = localHour(departAt, tz);
    return body.distances.map((row) => {
      const m = row[0];
      if (m === null || m === undefined) return null;
      const meters = Math.round(m);
      return { meters, seconds: modelSeconds(meters, vehicle, hour, opts.congestion), traffic: false, source: "osrm" };
    });
  };
  return {
    id: "osrm",
    routes: table,
    distanceMeters: async (from, to, vehicle) => {
      const [r] = await table([from], to, vehicle, new Date());
      if (!r) throw new Error("No route");
      return r.meters;
    },
  };
}

/** Try the live provider; on error or a missing pair, answer from the fallback. Never fails a quote for a map outage. */
export function withFallback(primary: RoutingProvider, fallback: RoutingProvider, onError: (e: unknown) => void = () => {}): RoutingProvider {
  const fallbackRoutes = (origins: readonly GeoPoint[], to: GeoPoint, vehicle: Vehicle, at: Date) =>
    fallback.routes ? fallback.routes(origins, to, vehicle, at) : Promise.all(origins.map(async (o) => ({ meters: await fallback.distanceMeters(o, to, vehicle), seconds: 0, traffic: false, source: fallback.id })));
  return {
    id: `${primary.id}+${fallback.id}`,
    distanceMeters: async (from, to, vehicle) => {
      try { return await primary.distanceMeters(from, to, vehicle); } catch (e) { onError(e); return fallback.distanceMeters(from, to, vehicle); }
    },
    routes: async (origins, to, vehicle, at) => {
      let live: (Route | null)[] = origins.map(() => null);
      if (primary.routes) {
        try { live = await primary.routes(origins, to, vehicle, at); } catch (e) { onError(e); }
      }
      const missing = origins.map((_, i) => i).filter((i) => !live[i]);
      if (missing.length) {
        const filled = await fallbackRoutes(missing.map((i) => origins[i]!), to, vehicle, at);
        missing.forEach((i, k) => { live[i] = filled[k] ?? null; });
      }
      return live;
    },
  };
}

/** Caches answers per ~100 m cell, vehicle and 5-minute slot, so a busy list costs one map call per cell. */
export function cachedRouting(inner: RoutingProvider, opts: { ttlMs?: number; max?: number; now?: () => number } = {}): RoutingProvider {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const max = opts.max ?? 20_000;
  const now = opts.now ?? Date.now;
  const store = new Map<string, { at: number; route: Route }>();
  const cell = (p: GeoPoint) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
  const key = (o: GeoPoint, to: GeoPoint, v: Vehicle, at: Date) => `${cell(o)}>${cell(to)}:${v}:${Math.floor(at.getTime() / 300_000)}`;
  const get = (k: string) => {
    const hit = store.get(k);
    if (!hit) return undefined;
    if (now() - hit.at > ttl) { store.delete(k); return undefined; }
    return hit.route;
  };
  const put = (k: string, route: Route) => {
    if (store.size >= max) store.delete(store.keys().next().value as string);
    store.set(k, { at: now(), route });
  };
  return {
    id: inner.id,
    distanceMeters: (from, to, vehicle) => inner.distanceMeters(from, to, vehicle),
    routes: async (origins, to, vehicle, at) => {
      const keys = origins.map((o) => key(o, to, vehicle, at));
      const out: (Route | null)[] = keys.map((k) => get(k) ?? null);
      const missing = origins.map((_, i) => i).filter((i) => !out[i]);
      if (missing.length && inner.routes) {
        const got = await inner.routes(missing.map((i) => origins[i]!), to, vehicle, at);
        missing.forEach((i, k) => { const r = got[k]; if (r) { out[i] = r; put(keys[i]!, r); } });
      }
      return out;
    },
  };
}
