/**
 * RoutingProvider port (§7.3). Fees use routed travel distance (§18.3); until a
 * map adapter with learned per-city correction is connected, the default
 * estimates it from the great-circle distance and a road-network factor.
 */
import { distanceMetres } from "../modules/ordering/order-aggregate.ts";
import type { GeoPoint } from "../modules/ordering/order-types.ts";

export interface RoutingProvider {
  readonly id: string;
  distanceMeters(from: GeoPoint, to: GeoPoint, vehicle: "MOTO" | "BICYCLE" | "CAR" | "FOOT"): Promise<number>;
}

export function straightLineRouting(roadFactor = 1.3): RoutingProvider {
  return {
    id: "straight-line-estimate",
    distanceMeters: async (from, to) => Math.round(distanceMetres(from, to) * roadFactor),
  };
}
