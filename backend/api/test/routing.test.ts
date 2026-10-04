import { test } from "node:test";
import assert from "node:assert/strict";
import { etaRange } from "../src/app/eta.ts";
import { cachedRouting, googleRoutesRouting, localHour, modelSeconds, osrmRouting, straightLineRouting, withFallback, type RoutingProvider } from "../src/app/routing.ts";

const GOMBE = { lat: -4.3045, lng: 15.3085 };
const LIMETE = { lat: -4.3600, lng: 15.3420 };
const AT = new Date("2026-10-05T16:30:00Z"); // 17:30 in Kinshasa: evening rush

const fakeFetch = (reply: (url: string, body: unknown) => { status?: number; json: unknown }) => {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const f = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, headers: init.headers, body });
    const r = reply(url, body);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json };
  };
  return { f, calls };
};

test("local hour follows the market time zone", () => {
  assert.equal(localHour(AT, "Africa/Kinshasa"), 17);
  assert.equal(localHour(AT, "Africa/Lubumbashi"), 18);
});

test("rush hour is slower than night for the same distance", () => {
  assert.ok(modelSeconds(5000, "MOTO", 17) > 1.8 * modelSeconds(5000, "MOTO", 2));
  assert.equal(modelSeconds(28_000, "MOTO", 2), 3600, "28 km at free-flow 28 km/h is one hour");
});

test("straight-line estimate: road factor 1.3 and the congestion profile", async () => {
  const [r] = await straightLineRouting().routes!([GOMBE], LIMETE, "MOTO", AT);
  assert.ok(r && r.meters > 9000 && r.meters < 10_500, `about 9.8 km, got ${r?.meters}`);
  assert.equal(r?.traffic, false);
  assert.equal(r?.seconds, modelSeconds(r!.meters, "MOTO", 17));
});

test("Google Routes: one matrix call, live traffic, two-wheeler, key in a header", async () => {
  const { f, calls } = fakeFetch(() => ({ json: [
    { originIndex: 1, destinationIndex: 0, distanceMeters: 4200, duration: "780s", condition: "ROUTE_EXISTS" },
    { originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
  ] }));
  const g = googleRoutesRouting({ apiKey: "k-test", fetch: f });
  const out = await g.routes!([GOMBE, LIMETE], LIMETE, "MOTO", AT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers["x-goog-api-key"], "k-test");
  const body = calls[0]!.body as { travelMode: string; routingPreference: string; origins: unknown[] };
  assert.equal(body.travelMode, "TWO_WHEELER");
  assert.equal(body.routingPreference, "TRAFFIC_AWARE");
  assert.equal(body.origins.length, 2);
  assert.equal(out[0], null);
  assert.deepEqual(out[1], { meters: 4200, seconds: 780, traffic: true, source: "google-routes" });
});

test("OSRM: table of distances; time from the congestion profile", async () => {
  const { f, calls } = fakeFetch(() => ({ json: { code: "Ok", distances: [[3100], [null]] } }));
  const o = osrmRouting({ baseUrl: "http://osrm.local/", fetch: f });
  const out = await o.routes!([GOMBE, LIMETE], LIMETE, "MOTO", AT);
  assert.match(calls[0]!.url, /^http:\/\/osrm\.local\/table\/v1\/driving\/15\.308500,-4\.304500;15\.342000,-4\.360000;15\.342000,-4\.360000\?sources=0;1&destinations=2/);
  assert.equal(out[0]?.meters, 3100);
  assert.equal(out[0]?.seconds, modelSeconds(3100, "MOTO", 17));
  assert.equal(out[1], null);
});

test("fallback: a map outage or a missing pair is answered by the estimate, never an error", async () => {
  const errors: unknown[] = [];
  const down: RoutingProvider = { id: "down", distanceMeters: async () => { throw new Error("503"); }, routes: async () => { throw new Error("503"); } };
  const r = withFallback(down, straightLineRouting(), (e) => errors.push(e));
  const [a] = await r.routes!([GOMBE], LIMETE, "MOTO", AT);
  assert.equal(a?.source, "estimate");
  assert.ok((await r.distanceMeters(GOMBE, LIMETE, "MOTO")) > 9000);
  assert.equal(errors.length, 2);

  const partial: RoutingProvider = { id: "p", distanceMeters: async () => 1, routes: async () => [{ meters: 1, seconds: 1, traffic: true, source: "p" }, null] };
  const out = await withFallback(partial, straightLineRouting()).routes!([GOMBE, LIMETE], LIMETE, "MOTO", AT);
  assert.equal(out[0]?.source, "p");
  assert.equal(out[1]?.source, "estimate");
});

test("cache: the same cell and 5-minute slot costs one map call", async () => {
  let calls = 0;
  const inner: RoutingProvider = { id: "i", distanceMeters: async () => 1, routes: async (o) => { calls += o.length; return o.map(() => ({ meters: 100, seconds: 60, traffic: true, source: "i" })); } };
  let clock = 0;
  const c = cachedRouting(inner, { now: () => clock });
  await c.routes!([GOMBE, LIMETE], LIMETE, "MOTO", AT);
  await c.routes!([{ lat: GOMBE.lat + 0.0001, lng: GOMBE.lng }], LIMETE, "MOTO", AT);
  assert.equal(calls, 2, "a point 11 m away reuses the answer");
  clock = 6 * 60_000;
  await c.routes!([GOMBE], LIMETE, "MOTO", AT);
  assert.equal(calls, 3, "answers expire after five minutes");
});

test("ETA range: rounded down to 5 minutes, 10 minutes wide, never under 10", () => {
  assert.deepEqual(etaRange(27), { low: 25, high: 35 });
  assert.deepEqual(etaRange(30), { low: 30, high: 40 });
  assert.deepEqual(etaRange(4), { low: 10, high: 20 });
});
