/**
 * The delivery-time model shared by the API (backend/api/src/app/eta.ts) and the apps, so a storefront
 * shows the same distance and time everywhere. Pure functions, no I/O.
 *
 * ETA = time to pickup (learned per branch; default below) + travel time + handover.
 * Travel time comes from live traffic when a map adapter is connected; otherwise from road distance
 * (great-circle × ROAD_FACTOR) at free-flow speed × the hour's congestion factor.
 */
export type Vehicle = "MOTO" | "BICYCLE" | "CAR" | "FOOT";

export const ROAD_FACTOR = 1.3;
export const DEFAULT_PICKUP_MIN = 18;
export const HANDOVER_MIN = 2;

/** Free-flow speeds in km/h, before congestion. */
export const FREE_FLOW_KMH: Record<Vehicle, number> = { MOTO: 28, CAR: 24, BICYCLE: 14, FOOT: 4.5 };

/**
 * Speed multiplier by local hour (0–23) for a dense African capital: morning and evening rush,
 * a lunchtime slowdown, free flow at night. The API corrects it per market from delivered orders.
 */
export const DEFAULT_CONGESTION: readonly number[] = [
  1, 1, 1, 1, 1, 0.95, 0.8, 0.6, 0.55, 0.65, 0.75, 0.75, 0.7, 0.7, 0.75, 0.7, 0.6, 0.5, 0.5, 0.6, 0.75, 0.85, 0.95, 1,
];

export interface GeoPoint { readonly lat: number; readonly lng: number }

/** Great-circle distance in metres. */
export function greatCircleMetres(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at)) % 24;
}

/** Travel seconds for a road distance at a given local hour, using free-flow speed × congestion. */
export function modelSeconds(meters: number, vehicle: Vehicle, hour: number, congestion: readonly number[] = DEFAULT_CONGESTION): number {
  const kmh = FREE_FLOW_KMH[vehicle] * (congestion[hour] ?? 1);
  return Math.round((meters / 1000 / kmh) * 3600);
}

/** Range to show: rounded down to 5 minutes, 10 minutes wide, never under 10 ("25–35 min"). */
export function etaRange(minutes: number): { low: number; high: number } {
  const low = Math.max(10, 5 * Math.floor(minutes / 5));
  return { low, high: low + 10 };
}

/** Kilometres with one decimal, e.g. "2.4". */
export const kmText = (meters: number) => (Math.round(meters / 100) / 10).toFixed(1);

/** The estimate when no live map or learned history is available (the apps' offline fallback). */
export function estimateDelivery(from: GeoPoint, to: GeoPoint, at: Date, opts: { timeZone?: string; pickupMinutes?: number } = {}) {
  const meters = Math.round(greatCircleMetres(from, to) * ROAD_FACTOR);
  const travel = Math.max(1, Math.round(modelSeconds(meters, "MOTO", localHour(at, opts.timeZone ?? "Africa/Kinshasa")) / 60));
  const minutes = (opts.pickupMinutes ?? DEFAULT_PICKUP_MIN) + travel + HANDOVER_MIN;
  return { meters, km: kmText(meters), minutes, ...etaRange(minutes), travelMinutes: travel };
}
